import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AnalysisBundle, AnalysisJob } from "@rtm/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { runAnalysisJob } from "./run-job";

const temporaryDirectories: string[] = [];

function fixtureJob(): AnalysisJob {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    repository: {
      owner: "acme",
      name: "widget",
      canonicalUrl: "https://github.com/acme/widget",
    },
    branch: "main",
    status: "queued",
    progress: 0,
    createdAt: "2026-11-12T00:00:00.000Z",
    updatedAt: "2026-11-12T00:00:00.000Z",
  };
}

function fixtureBundle(job: AnalysisJob): AnalysisBundle {
  return {
    schemaVersion: "1.0",
    analyzerVersion: "0.1.0",
    repository: {
      owner: job.repository.owner,
      name: job.repository.name,
      branch: job.branch,
      headSha: "a".repeat(40),
    },
    generatedAt: "2026-11-12T00:00:00.000Z",
    limits: { maxCommits: 2000, maxKeyframes: 60, maxModules: 500 },
    coverage: { sourceFiles: 0, parsedFiles: 0, excludedFiles: 0 },
    keyframes: [
      {
        id: "a".repeat(40),
        commitSha: "a".repeat(40),
        committedAt: "2026-11-12T00:00:00.000Z",
        omittedCommits: 0,
        nodes: [],
        edges: [],
        events: [],
      },
    ],
  };
}

class TestJobStore {
  private current: AnalysisJob;
  readonly statuses: AnalysisJob["status"][] = [];

  constructor(job: AnalysisJob) {
    this.current = job;
  }

  async get(): Promise<AnalysisJob | undefined> {
    return this.current;
  }

  async update(
    _id: string,
    patch: Partial<AnalysisJob>,
  ): Promise<AnalysisJob | undefined> {
    this.current = { ...this.current, ...patch };
    this.statuses.push(this.current.status);
    return this.current;
  }
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("runAnalysisJob", () => {
  it("moves through worker states and cleans the temporary checkout", async () => {
    const job = fixtureJob();
    const store = new TestJobStore(job);
    const workRoot = await mkdtemp(path.join(os.tmpdir(), "rtm-worker-"));
    temporaryDirectories.push(workRoot);
    let published: Buffer = Buffer.alloc(0);

    const result = await runAnalysisJob({
      job,
      jobStore: store,
      bundleStore: {
        put: async (_key, value) => {
          published = value;
        },
      },
      workRoot,
      cloneRepository: async (_job, destination) => {
        await import("node:fs/promises").then(({ mkdir }) =>
          mkdir(destination, { recursive: true }),
        );
      },
      analyze: async () => fixtureBundle(job),
      now: () => new Date("2026-11-12T00:00:00.000Z"),
    });

    expect(result.status).toBe("ready");
    expect(store.statuses).toEqual([
      "cloning",
      "analyzing",
      "publishing",
      "ready",
    ]);
    expect(published.byteLength).toBeGreaterThan(0);
    expect(await readdir(workRoot)).toEqual([]);
  });

  it("stores a sanitized failure without leaking the thrown stack", async () => {
    const job = fixtureJob();
    const store = new TestJobStore(job);
    const workRoot = await mkdtemp(path.join(os.tmpdir(), "rtm-worker-"));
    temporaryDirectories.push(workRoot);

    const result = await runAnalysisJob({
      job,
      jobStore: store,
      bundleStore: { put: async () => undefined },
      workRoot,
      cloneRepository: async () => undefined,
      analyze: async () => {
        throw new Error("secret internal stack");
      },
      now: () => new Date("2026-11-12T00:00:00.000Z"),
    });

    expect(result.status).toBe("failed");
    expect(result.error).toEqual({
      code: "ANALYSIS_FAILED",
      message:
        "Analysis failed. Check that the repository is public and within supported limits.",
    });
    expect(JSON.stringify(result)).not.toContain("secret internal stack");
    expect(await readdir(workRoot)).toEqual([]);
  });

  it("marks an aborted analysis as cancelled", async () => {
    const job = fixtureJob();
    const store = new TestJobStore(job);
    const workRoot = await mkdtemp(path.join(os.tmpdir(), "rtm-worker-"));
    temporaryDirectories.push(workRoot);
    const controller = new AbortController();
    let receivedSignal: AbortSignal | undefined;

    const result = await runAnalysisJob({
      job,
      jobStore: store,
      bundleStore: { put: async () => undefined },
      workRoot,
      signal: controller.signal,
      cloneRepository: async () => undefined,
      analyze: async (_job, _path, signal) => {
        receivedSignal = signal;
        controller.abort();
        return fixtureBundle(job);
      },
      now: () => new Date("2026-11-12T00:00:00.000Z"),
    });

    expect(receivedSignal).toBe(controller.signal);
    expect(result.status).toBe("cancelled");
    expect(await readdir(workRoot)).toEqual([]);
  });
});
