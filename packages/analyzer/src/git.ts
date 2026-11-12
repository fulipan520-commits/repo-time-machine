import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);

export interface GitCommit {
  sha: string;
  authoredAt: string;
  author: string;
  title: string;
}

export interface GitChange {
  status: string;
  oldPath?: string;
  path: string;
}

export interface GitCommandOptions {
  maxBuffer?: number;
}

function toIsoDateTime(value: string): string {
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? new Date(0).toISOString() : new Date(timestamp).toISOString();
}

async function runGit(
  repositoryPath: string,
  args: readonly string[],
  options: GitCommandOptions = {},
): Promise<string> {
  const result = await exec("git", args, {
    cwd: repositoryPath,
    maxBuffer: options.maxBuffer ?? 16 * 1024 * 1024,
    encoding: "utf8",
  });
  return result.stdout;
}

export async function getHeadSha(
  repositoryPath: string,
  branch: string,
): Promise<string> {
  return (
    await runGit(repositoryPath, ["rev-parse", `${branch}^{commit}`])
  ).trim();
}

export async function getCurrentBranch(repositoryPath: string): Promise<string> {
  return (
    await runGit(repositoryPath, ["rev-parse", "--abbrev-ref", "HEAD"])
  ).trim();
}

export async function listCommits(
  repositoryPath: string,
  branch: string,
  limit: number,
): Promise<GitCommit[]> {
  const output = await runGit(repositoryPath, [
    "log",
    branch,
    "--first-parent",
    "--no-merges",
    "--reverse",
    `--max-count=${limit}`,
    "--format=%H%x1f%aI%x1f%an%x1f%s",
  ]);

  return output
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [sha, authoredAt, author, ...title] = line.split("\x1f");
      return {
        sha: sha ?? "",
        authoredAt: toIsoDateTime(authoredAt ?? ""),
        author: author ?? "",
        title: title.join("\x1f"),
      };
    })
    .filter((commit) => commit.sha);
}

export async function getChanges(
  repositoryPath: string,
  commitSha: string,
): Promise<GitChange[]> {
  const output = await runGit(repositoryPath, [
    "diff-tree",
    "--root",
    "--no-commit-id",
    "--name-status",
    "-r",
    "-M",
    commitSha,
  ]);

  const changes: GitChange[] = [];
  for (const line of output.split("\n")) {
    if (!line) {
      continue;
    }
    const [status, firstPath, secondPath] = line.split("\t");
    if (!status || !firstPath) {
      continue;
    }
    if (status.startsWith("R") || status.startsWith("C")) {
      if (secondPath) {
        changes.push({ status, oldPath: firstPath, path: secondPath });
      }
    } else {
      changes.push({ status, path: firstPath });
    }
  }
  return changes;
}

export async function readFileAtCommit(
  repositoryPath: string,
  commitSha: string,
  filePath: string,
): Promise<string> {
  return runGit(repositoryPath, ["show", `${commitSha}:${filePath}`], {
    maxBuffer: 4 * 1024 * 1024,
  });
}
