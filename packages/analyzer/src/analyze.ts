import { createHash } from "node:crypto";
import path from "node:path";
import type {
  AnalysisBundle,
  ArchitectureEvent,
  DependencyEdge,
  Evidence,
  ModuleNode,
  Snapshot,
} from "@rtm/contracts";
import { analysisBundleSchema } from "@rtm/contracts";
import { buildModuleGraph, type FileImport, type ModuleGraph } from "./graph";
import {
  getChanges,
  getHeadSha,
  listCommits,
  readFileAtCommit,
  type GitChange,
  type GitCommit,
} from "./git";
import { selectKeyframes, type ScoredSnapshot } from "./keyframes";
import { extractPythonImports } from "./languages/python";
import {
  extractTypeScriptImports,
  type PathAlias,
} from "./languages/typescript";

const ANALYZER_VERSION = "0.1.0";
const DEFAULT_MAX_COMMITS = 2_000;
const DEFAULT_MAX_KEYFRAMES = 60;
const DEFAULT_MAX_MODULES = 500;
const DEFAULT_MAX_FILE_SIZE = 1024 * 1024;

const ignoredSegments = new Set([
  ".git",
  ".next",
  ".venv",
  "__pycache__",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "vendor",
]);

interface AnalyzerFile {
  path: string;
  language: "python" | "typescript";
  loc: number;
  contentHash: string;
}

export interface AnalyzeRepositoryOptions {
  repositoryPath: string;
  branch?: string;
  repository: {
    owner: string;
    name: string;
  };
  maxCommits?: number;
  maxKeyframes?: number;
  maxModules?: number;
  maxFileSize?: number;
  now?: Date;
}

interface ModuleState {
  graph: ModuleGraph;
  firstSeen: Map<string, string>;
}

function sourceLanguage(filePath: string): AnalyzerFile["language"] | undefined {
  const normalized = filePath.replaceAll("\\", "/");
  if (normalized.split("/").some((segment) => ignoredSegments.has(segment))) {
    return undefined;
  }
  if (normalized.endsWith(".py")) {
    return "python";
  }
  if (/\.(?:ts|tsx|js|jsx)$/.test(normalized)) {
    return "typescript";
  }
  return undefined;
}

function lineCount(content: string): number {
  if (!content) {
    return 0;
  }
  return content.split(/\r?\n/).filter((line) => line.trim()).length;
}

function evidenceFor(commit: GitCommit, changes: readonly GitChange[]): Evidence {
  return {
    commitSha: commit.sha,
    title: commit.title,
    author: commit.author,
    authoredAt: commit.authoredAt,
    paths: changes.map((change) => change.path).slice(0, 100),
  };
}

function event(
  commit: GitCommit,
  type: ArchitectureEvent["type"],
  modules: string[],
  changes: readonly GitChange[],
): ArchitectureEvent {
  return {
    id: `${commit.sha}:${type}:${modules.join(",")}`,
    type,
    modules,
    inferred: false,
    confidence: "high",
    evidence: evidenceFor(commit, changes),
  };
}

function inferredEvent(
  commit: GitCommit,
  type: "module-split" | "module-merged",
  modules: string[],
  changes: readonly GitChange[],
): ArchitectureEvent {
  return {
    ...event(commit, type, modules, changes),
    inferred: true,
    confidence: "medium",
  };
}

function isWithin(candidate: string, parent: string): boolean {
  return candidate.startsWith(`${parent}/`);
}

function compareGraphs(
  previous: ModuleGraph,
  current: ModuleGraph,
  commit: GitCommit,
  changes: readonly GitChange[],
): { events: ArchitectureEvent[]; score: number } {
  const previousNodes = new Map(previous.nodes.map((node) => [node.id, node]));
  const currentNodes = new Map(current.nodes.map((node) => [node.id, node]));
  const addedNodes = current.nodes
    .filter((node) => !previousNodes.has(node.id))
    .map((node) => node.id);
  const removedNodes = previous.nodes
    .filter((node) => !currentNodes.has(node.id))
    .map((node) => node.id);

  const edgeKey = (edge: DependencyEdge): string =>
    `${edge.source}\0${edge.target}`;
  const previousEdges = new Map(previous.edges.map((edge) => [edgeKey(edge), edge]));
  const currentEdges = new Map(current.edges.map((edge) => [edgeKey(edge), edge]));
  const addedEdges = current.edges
    .filter((edge) => !previousEdges.has(edgeKey(edge)))
    .map(edgeKey);
  const removedEdges = previous.edges
    .filter((edge) => !currentEdges.has(edgeKey(edge)))
    .map(edgeKey);

  const events: ArchitectureEvent[] = [];
  if (
    removedNodes.length === 1 &&
    addedNodes.length >= 2 &&
    addedNodes.every((node) => isWithin(node, removedNodes[0]!))
  ) {
    events.push(
      inferredEvent(
        commit,
        "module-split",
        [removedNodes[0]!, ...addedNodes],
        changes,
      ),
    );
  }
  if (
    addedNodes.length === 1 &&
    removedNodes.length >= 2 &&
    removedNodes.every((node) => isWithin(node, addedNodes[0]!))
  ) {
    events.push(
      inferredEvent(
        commit,
        "module-merged",
        [...removedNodes, addedNodes[0]!],
        changes,
      ),
    );
  }
  if (addedNodes.length > 0) {
    events.push(event(commit, "module-added", addedNodes, changes));
  }
  if (removedNodes.length > 0) {
    events.push(event(commit, "module-removed", removedNodes, changes));
  }
  if (addedEdges.length > 0) {
    events.push(
      event(
        commit,
        "dependency-added",
        addedEdges.map((key) => key.replace("\0", " -> ")),
        changes,
      ),
    );
  }
  if (removedEdges.length > 0) {
    events.push(
      event(
        commit,
        "dependency-removed",
        removedEdges.map((key) => key.replace("\0", " -> ")),
        changes,
      ),
    );
  }

  return {
    events,
    score:
      addedNodes.length * 2 +
      removedNodes.length * 2 +
      addedEdges.length +
      removedEdges.length,
  };
}

function compareStatus(
  previous: ModuleGraph,
  current: ModuleGraph,
): {
  nodes: ModuleNode[];
  edges: DependencyEdge[];
} {
  const previousNodes = new Map(previous.nodes.map((node) => [node.id, node]));
  const currentIds = new Set(current.nodes.map((node) => node.id));
  const previousEdges = new Map(
    previous.edges.map((edge) => [`${edge.source}\0${edge.target}`, edge]),
  );
  const currentEdgeIds = new Set(
    current.edges.map((edge) => `${edge.source}\0${edge.target}`),
  );
  const currentTime = "";

  const nodes: ModuleNode[] = current.nodes.map((node) => {
    const before = previousNodes.get(node.id);
    let status: ModuleNode["status"] = "unchanged";
    if (!before) {
      status = "added";
    } else if (node.fileCount > before.fileCount || node.loc > before.loc) {
      status = "growing";
    } else if (node.fileCount < before.fileCount || node.loc < before.loc) {
      status = "shrinking";
    }
    return {
      ...node,
      firstSeen: currentTime,
      lastChanged: currentTime,
      status,
    };
  });

  for (const node of previous.nodes) {
    if (!currentIds.has(node.id)) {
      nodes.push({
        ...node,
        firstSeen: currentTime,
        lastChanged: currentTime,
        status: "removed",
      });
    }
  }

  const edges: DependencyEdge[] = current.edges.map((edge) => ({
    ...edge,
    status: previousEdges.has(`${edge.source}\0${edge.target}`)
      ? "unchanged"
      : "added",
  }));
  for (const edge of previous.edges) {
    if (!currentEdgeIds.has(`${edge.source}\0${edge.target}`)) {
      edges.push({ ...edge, status: "removed" });
    }
  }

  return { nodes, edges };
}

async function readAliases(
  repositoryPath: string,
  commitSha: string,
): Promise<PathAlias[]> {
  for (const configPath of ["tsconfig.json", "tsconfig.base.json"]) {
    try {
      const content = await readFileAtCommit(repositoryPath, commitSha, configPath);
      const config = JSON.parse(content) as {
        compilerOptions?: {
          baseUrl?: string;
          paths?: Record<string, string[]>;
        };
      };
      const baseUrl = config.compilerOptions?.baseUrl ?? ".";
      return Object.entries(config.compilerOptions?.paths ?? {}).map(
        ([pattern, targets]) => ({
          pattern,
          targets: targets.map((target) =>
            path.posix
              .join(baseUrl, target)
              .replace(/^\.\//, "")
              .replace(/\/$/, ""),
          ),
        }),
      );
    } catch {
      continue;
    }
  }
  return [];
}

function resolveImportTarget(
  candidate: string,
  files: ReadonlyMap<string, AnalyzerFile>,
): string | undefined {
  if (files.has(candidate)) {
    return candidate;
  }
  if (candidate.endsWith(".py")) {
    const packageInit = `${candidate.slice(0, -3)}/__init__.py`;
    if (files.has(packageInit)) {
      return packageInit;
    }
    return undefined;
  }

  const extensionless = candidate.replace(/\.[^.]+$/, "");
  for (const extension of [".ts", ".tsx", ".js", ".jsx"]) {
    const possible = `${extensionless}${extension}`;
    if (files.has(possible)) {
      return possible;
    }
    const indexFile = `${candidate}/index${extension}`;
    if (files.has(indexFile)) {
      return indexFile;
    }
  }
  return undefined;
}

async function parseFile(
  repositoryPath: string,
  commitSha: string,
  file: AnalyzerFile,
  source: string,
  aliases: readonly PathAlias[],
): Promise<FileImport[]> {
  if (file.language === "python") {
    return extractPythonImports(file.path, source);
  }
  return extractTypeScriptImports(file.path, source, aliases);
}

export async function analyzeRepository(
  options: AnalyzeRepositoryOptions,
): Promise<AnalysisBundle> {
  const branch = options.branch ?? "main";
  const maxCommits = options.maxCommits ?? DEFAULT_MAX_COMMITS;
  const maxKeyframes = options.maxKeyframes ?? DEFAULT_MAX_KEYFRAMES;
  const maxModules = options.maxModules ?? DEFAULT_MAX_MODULES;
  const maxFileSize = options.maxFileSize ?? DEFAULT_MAX_FILE_SIZE;
  const headSha = await getHeadSha(options.repositoryPath, branch);
  const commits = await listCommits(options.repositoryPath, branch, maxCommits);
  const aliases = await readAliases(options.repositoryPath, headSha);

  const files = new Map<string, AnalyzerFile>();
  const imports = new Map<string, FileImport[]>();
  const firstSeen = new Map<string, string>();
  const candidates: ScoredSnapshot[] = [];
  let previousGraph: ModuleGraph = { nodes: [], edges: [] };
  let excludedFiles = 0;

  for (const [commitIndex, commit] of commits.entries()) {
    const changes = await getChanges(options.repositoryPath, commit.sha);

    for (const change of changes) {
      if (change.oldPath) {
        files.delete(change.oldPath);
        imports.delete(change.oldPath);
      }

      if (change.status.startsWith("D")) {
        files.delete(change.path);
        imports.delete(change.path);
        continue;
      }

      const language = sourceLanguage(change.path);
      if (!language) {
        excludedFiles += 1;
        continue;
      }

      const source = await readFileAtCommit(
        options.repositoryPath,
        commit.sha,
        change.path,
      );
      if (Buffer.byteLength(source, "utf8") > maxFileSize) {
        files.delete(change.path);
        imports.delete(change.path);
        excludedFiles += 1;
        continue;
      }

      const file: AnalyzerFile = {
        path: change.path,
        language,
        loc: lineCount(source),
        contentHash: createHash("sha1").update(source).digest("hex"),
      };
      files.set(change.path, file);
      imports.set(
        change.path,
        await parseFile(
          options.repositoryPath,
          commit.sha,
          file,
          source,
          aliases,
        ),
      );
    }

    const resolvedImports: FileImport[] = [];
    for (const fileImports of imports.values()) {
      for (const fileImport of fileImports) {
        const target = resolveImportTarget(fileImport.targetFile, files);
        if (target) {
          resolvedImports.push({
            sourceFile: fileImport.sourceFile,
            targetFile: target,
          });
        }
      }
    }

    const graph = buildModuleGraph(
      [...files.values()],
      resolvedImports,
      { maxModules },
    );
    const comparison = compareGraphs(previousGraph, graph, commit, changes);
    const statuses = compareStatus(previousGraph, graph);

    for (const node of statuses.nodes) {
      if (!firstSeen.has(node.id)) {
        firstSeen.set(node.id, commit.authoredAt);
      }
      node.firstSeen = firstSeen.get(node.id) ?? commit.authoredAt;
      node.lastChanged = commit.authoredAt;
    }

    const snapshot: Snapshot = {
      id: commit.sha,
      commitSha: commit.sha,
      committedAt: commit.authoredAt,
      omittedCommits: 0,
      nodes: statuses.nodes.sort((left, right) => left.id.localeCompare(right.id)),
      edges: statuses.edges.sort(
        (left, right) =>
          left.source.localeCompare(right.source) ||
          left.target.localeCompare(right.target),
      ),
      events: comparison.events,
    };

    if (comparison.score > 0 || commitIndex === 0 || commitIndex === commits.length - 1) {
      candidates.push({
        snapshot,
        score: comparison.score,
        commitIndex,
      });
    }

    previousGraph = graph;
  }

  const selected = selectKeyframes(candidates, maxKeyframes);
  let previousCommitIndex = -1;
  for (const snapshot of selected) {
    const commitIndex = commits.findIndex(
      (commit) => commit.sha === snapshot.commitSha,
    );
    snapshot.omittedCommits = Math.max(0, commitIndex - previousCommitIndex - 1);
    previousCommitIndex = commitIndex;
  }

  const bundle: AnalysisBundle = {
    schemaVersion: "1.0",
    analyzerVersion: ANALYZER_VERSION,
    repository: {
      owner: options.repository.owner,
      name: options.repository.name,
      branch,
      headSha,
    },
    generatedAt: (options.now ?? new Date()).toISOString(),
    limits: {
      maxCommits,
      maxKeyframes,
      maxModules,
    },
    coverage: {
      sourceFiles: files.size,
      parsedFiles: files.size,
      excludedFiles,
    },
    keyframes: selected.length > 0 ? selected : [
      {
        id: headSha,
        commitSha: headSha,
        committedAt: new Date(0).toISOString(),
        omittedCommits: 0,
        nodes: [],
        edges: [],
        events: [],
      },
    ],
  };

  return analysisBundleSchema.parse(bundle);
}
