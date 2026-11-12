import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { analyzeRepository } from "./analyze";

const exec = promisify(execFile);
const temporaryDirectories: string[] = [];

async function git(cwd: string, args: string[], date: string): Promise<void> {
  await exec(
    "git",
    [
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.com",
      ...args,
    ],
    {
      cwd,
      env: {
        ...process.env,
        GIT_AUTHOR_DATE: date,
        GIT_COMMITTER_DATE: date,
      },
    },
  );
}

async function createFixtureRepository(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "rtm-analyzer-"));
  temporaryDirectories.push(directory);
  await git(directory, ["init", "-b", "main"], "2026-01-01T00:00:00Z");
  await mkdir(path.join(directory, "src", "app"), { recursive: true });
  await writeFile(
    path.join(directory, "src", "app", "main.py"),
    "def run():\n    return 1\n",
  );
  await git(directory, ["add", "."], "2026-01-01T00:00:00Z");
  await git(
    directory,
    ["commit", "-m", "add initial app"],
    "2026-01-01T00:00:00Z",
  );

  await mkdir(path.join(directory, "src", "db"), { recursive: true });
  await writeFile(
    path.join(directory, "src", "db", "store.py"),
    "def load():\n    return 2\n",
  );
  await writeFile(
    path.join(directory, "src", "app", "main.py"),
    "from db.store import load\n\ndef run():\n    return load()\n",
  );
  await git(directory, ["add", "."], "2026-01-02T00:00:00Z");
  await git(
    directory,
    ["commit", "-m", "add database module"],
    "2026-01-02T00:00:00Z",
  );

  await writeFile(
    path.join(directory, "src", "db", "store.py"),
    "def load():\n    value = 2\n    return value\n",
  );
  await git(directory, ["add", "."], "2026-01-03T00:00:00Z");
  await git(
    directory,
    ["commit", "-m", "refine database implementation"],
    "2026-01-03T00:00:00Z",
  );

  await git(
    directory,
    ["mv", "src/db", "src/storage"],
    "2026-01-04T00:00:00Z",
  );
  await git(directory, ["add", "."], "2026-01-04T00:00:00Z");
  await git(
    directory,
    ["commit", "-m", "rename database to storage"],
    "2026-01-04T00:00:00Z",
  );

  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("analyzeRepository", () => {
  it("emits architecture keyframes with commit evidence", async () => {
    const repositoryPath = await createFixtureRepository();
    const bundle = await analyzeRepository({
      repositoryPath,
      branch: "main",
      repository: { owner: "fixture", name: "example" },
      now: new Date("2026-11-12T00:00:00.000Z"),
    });

    expect(bundle.keyframes).toHaveLength(3);
    expect(bundle.keyframes[1]?.nodes.map((node) => node.id)).toContain(
      "src/db",
    );
    expect(bundle.keyframes[1]?.events[0]?.evidence.paths.length).toBeGreaterThan(
      0,
    );
    expect(bundle.keyframes[2]?.nodes.map((node) => node.id)).toContain(
      "src/storage",
    );
    expect(bundle.keyframes[2]?.events.map((event) => event.type)).toContain(
      "module-added",
    );
    expect(
      bundle.keyframes[2]?.nodes.find((node) => node.id === "src/app")
        ?.lastChanged,
    ).toBe("2026-01-02T00:00:00.000Z");
  });

  it("stops before reading history when aborted", async () => {
    const repositoryPath = await createFixtureRepository();
    const controller = new AbortController();
    controller.abort();

    await expect(
      analyzeRepository({
        repositoryPath,
        branch: "main",
        repository: { owner: "fixture", name: "example" },
        signal: controller.signal,
      }),
    ).rejects.toThrow("Analysis cancelled");
  });

  it("enforces the source-file limit", async () => {
    const repositoryPath = await createFixtureRepository();

    await expect(
      analyzeRepository({
        repositoryPath,
        branch: "main",
        repository: { owner: "fixture", name: "example" },
        maxSourceFiles: 1,
      }),
    ).rejects.toThrow("Source file limit exceeded");
  });

  it("reports final-file coverage instead of cumulative skipped changes", async () => {
    const repositoryPath = await createFixtureRepository();
    const bundle = await analyzeRepository({
      repositoryPath,
      branch: "main",
      repository: { owner: "fixture", name: "example" },
      maxFileSize: 1,
    });

    expect(bundle.coverage).toEqual({
      sourceFiles: 2,
      parsedFiles: 0,
      excludedFiles: 2,
    });
  });
});
