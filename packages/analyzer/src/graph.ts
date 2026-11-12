import path from "node:path";
import type { DependencyEdge } from "@rtm/contracts";

export interface SourceFileRecord {
  path: string;
  language: "python" | "typescript";
  loc: number;
}

export interface FileImport {
  sourceFile: string;
  targetFile: string;
}

export interface ModuleGraphNode {
  id: string;
  label: string;
  path: string;
  fileCount: number;
  loc: number;
  incoming: number;
  outgoing: number;
}

export interface ModuleGraph {
  nodes: ModuleGraphNode[];
  edges: DependencyEdge[];
}

export interface GraphOptions {
  maxModules: number;
}

function directoryOf(filePath: string): string {
  const directory = path.posix.dirname(filePath);
  return directory === "." ? "." : directory;
}

function parentOf(modulePath: string): string {
  const parent = path.posix.dirname(modulePath);
  return parent === "." || parent === modulePath ? "." : parent;
}

function collapseToBudget(
  files: readonly SourceFileRecord[],
  imports: readonly FileImport[],
  budget: number,
): { files: SourceFileRecord[]; imports: FileImport[] } {
  let currentFiles = [...files];
  let currentImports = [...imports];
  let directories = new Set(currentFiles.map((file) => directoryOf(file.path)));

  while (directories.size > budget) {
    const deepest = [...directories].sort(
      (left, right) =>
        right.split("/").length - left.split("/").length ||
        left.localeCompare(right),
    )[0];

    if (!deepest || deepest === ".") {
      break;
    }

    const next = parentOf(deepest);
    currentFiles = currentFiles.map((file) => ({
      ...file,
      path:
        directoryOf(file.path) === deepest
          ? path.posix.join(next, path.posix.basename(file.path))
          : file.path,
    }));
    currentImports = currentImports.map((entry) => ({
      sourceFile:
        directoryOf(entry.sourceFile) === deepest
          ? path.posix.join(next, path.posix.basename(entry.sourceFile))
          : entry.sourceFile,
      targetFile:
        directoryOf(entry.targetFile) === deepest
          ? path.posix.join(next, path.posix.basename(entry.targetFile))
          : entry.targetFile,
    }));
    directories = new Set(currentFiles.map((file) => directoryOf(file.path)));
  }

  return { files: currentFiles, imports: currentImports };
}

export function buildModuleGraph(
  sourceFiles: readonly SourceFileRecord[],
  fileImports: readonly FileImport[],
  options: GraphOptions = { maxModules: 500 },
): ModuleGraph {
  const { files, imports } = collapseToBudget(
    sourceFiles,
    fileImports,
    options.maxModules,
  );
  const knownFiles = new Set(files.map((file) => file.path));
  const nodeMetrics = new Map<string, { fileCount: number; loc: number }>();

  for (const file of files) {
    const moduleId = directoryOf(file.path);
    const current = nodeMetrics.get(moduleId) ?? { fileCount: 0, loc: 0 };
    current.fileCount += 1;
    current.loc += file.loc;
    nodeMetrics.set(moduleId, current);
  }

  const edgeWeights = new Map<string, number>();
  for (const fileImport of imports) {
    if (
      !knownFiles.has(fileImport.sourceFile) ||
      !knownFiles.has(fileImport.targetFile)
    ) {
      continue;
    }

    const source = directoryOf(fileImport.sourceFile);
    const target = directoryOf(fileImport.targetFile);
    if (source === target) {
      continue;
    }

    const key = `${source}\0${target}`;
    edgeWeights.set(key, (edgeWeights.get(key) ?? 0) + 1);
  }

  const edges: DependencyEdge[] = [...edgeWeights.entries()]
    .map(([key, weight]) => {
      const [source, target] = key.split("\0");
      return {
        source: source ?? "",
        target: target ?? "",
        weight,
        status: "unchanged" as const,
      };
    })
    .filter((edge) => edge.source && edge.target)
    .sort(
      (left, right) =>
        left.source.localeCompare(right.source) ||
        left.target.localeCompare(right.target),
    );

  const incoming = new Map<string, number>();
  const outgoing = new Map<string, number>();
  for (const edge of edges) {
    outgoing.set(edge.source, (outgoing.get(edge.source) ?? 0) + 1);
    incoming.set(edge.target, (incoming.get(edge.target) ?? 0) + 1);
  }

  const nodes = [...nodeMetrics.entries()]
    .map(([id, metrics]) => ({
      id,
      label: id === "." ? "repository root" : path.posix.basename(id),
      path: id,
      fileCount: metrics.fileCount,
      loc: metrics.loc,
      incoming: incoming.get(id) ?? 0,
      outgoing: outgoing.get(id) ?? 0,
    }))
    .sort((left, right) => left.id.localeCompare(right.id));

  return { nodes, edges };
}
