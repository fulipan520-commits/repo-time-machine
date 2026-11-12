import type { AnalysisJob } from "@rtm/contracts";
import { expect, it, vi } from "vitest";
import { MemoryRunner } from "./memory-runner";
import type { RunAnalysisJobOptions } from "./run-job";

function job(id: string): AnalysisJob {
  return {
    id,
    repository: {
      owner: "acme",
      name: id,
      canonicalUrl: `https://github.com/acme/${id}`,
    },
    branch: "main",
    status: "queued",
    progress: 0,
    createdAt: "2026-11-12T00:00:00.000Z",
    updatedAt: "2026-11-12T00:00:00.000Z",
  };
}

it("starts queued jobs only up to the concurrency limit", async () => {
  const started: string[] = [];
  const releases: Array<() => void> = [];
  const runner = vi.fn(
    async (options: RunAnalysisJobOptions): Promise<AnalysisJob> => {
      started.push(options.job.id);
      await new Promise<void>((resolve) => releases.push(resolve));
      return options.job;
    },
  );
  const memoryRunner = new MemoryRunner({
    jobStore: {
      get: async () => undefined,
      update: async (_id, patch) => ({ ...job("unused"), ...patch }),
    },
    bundleStore: { put: async () => undefined },
    runner,
    maxConcurrent: 1,
  });

  memoryRunner.enqueue(job("first"));
  memoryRunner.enqueue(job("second"));
  await Promise.resolve();

  expect(started).toEqual(["first"]);
  releases[0]?.();
  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(started).toEqual(["first", "second"]);
  releases[1]?.();
  await memoryRunner.drain();
});
