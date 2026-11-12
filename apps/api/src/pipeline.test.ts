import { execFile } from "node:child_process";
import { cp, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { MemoryRunner, runAnalysisJob } from "@rtm/worker";
import { afterEach, expect, it } from "vitest";
import { buildServer, InMemoryBundleStore, InMemoryJobStore } from "./server";

const exec = promisify(execFile);
const temporaryDirectories: string[] = [];

async function git(
  cwd: string,
  args: string[],
  date: string,
): Promise<void> {
  await exec(
    "git",
    [
      "-c",
      "user.name=Pipeline Fixture",
      "-c",
      "user.email=pipeline@example.com",
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

async function createRepository(): Promise<string> {
  const repository = await mkdtemp(path.join(os.tmpdir(), "rtm-pipeline-"));
  temporaryDirectories.push(repository);
  await git(repository, ["init", "-b", "main"], "2026-01-01T00:00:00Z");
  await mkdir(path.join(repository, "src", "app"), { recursive: true });
  await writeFile(
    path.join(repository, "src", "app", "main.py"),
    "def run():\n    return 1\n",
  );
  await git(repository, ["add", "."], "2026-01-01T00:00:00Z");
  await git(
    repository,
    ["commit", "-m", "initial app"],
    "2026-01-01T00:00:00Z",
  );

  await mkdir(path.join(repository, "src", "db"), { recursive: true });
  await writeFile(
    path.join(repository, "src", "db", "store.py"),
    "def load():\n    return 1\n",
  );
  await writeFile(
    path.join(repository, "src", "app", "main.py"),
    "from db.store import load\n\ndef run():\n    return load()\n",
  );
  await git(repository, ["add", "."], "2026-01-02T00:00:00Z");
  await git(
    repository,
    ["commit", "-m", "add database"],
    "2026-01-02T00:00:00Z",
  );

  return repository;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

it("runs a queued analysis through the real worker pipeline", async () => {
  const repository = await createRepository();
  const jobStore = new InMemoryJobStore();
  const bundleStore = new InMemoryBundleStore();
  const runner = new MemoryRunner({
    jobStore,
    bundleStore,
    maxConcurrent: 1,
    runner: (options) =>
      runAnalysisJob({
        ...options,
        cloneRepository: async (_job, destination) => {
          await cp(repository, destination, { recursive: true });
        },
        maxDurationMs: 10_000,
      }),
  });
  const server = buildServer({
    jobStore,
    bundleStore,
    onJobCreated: (job) => runner.enqueue(job),
  });

  try {
    const create = await server.inject({
      method: "POST",
      url: "/api/analyses",
      payload: { repositoryUrl: "https://github.com/fixture/pipeline" },
    });
    expect(create.statusCode).toBe(202);
    await runner.drain();

    const jobId = create.json().id as string;
    const status = await server.inject({
      method: "GET",
      url: `/api/analyses/${jobId}`,
    });
    expect(status.json().status).toBe("ready");

    const bundle = await server.inject({
      method: "GET",
      url: `/api/bundles/${jobId}`,
    });
    expect(bundle.statusCode).toBe(200);
    expect(bundle.json().keyframes).toHaveLength(2);
  } finally {
    await server.close();
  }
});
