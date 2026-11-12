import { buildServer, FileBundleStore, InMemoryJobStore } from "./server";
import { MemoryRunner } from "@rtm/worker";

const port = Number(process.env.PORT ?? 3001);
const host = process.env.HOST ?? "127.0.0.1";
const positiveInteger = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};
const jobStore = new InMemoryJobStore();
const bundleStore = new FileBundleStore(
  process.env.BUNDLE_DIRECTORY ?? ".data/bundles",
);
const runner = new MemoryRunner({
  jobStore,
  bundleStore,
  maxConcurrent: positiveInteger(process.env.MAX_CONCURRENT_ANALYSES, 1),
  maxDurationMs: positiveInteger(
    process.env.MAX_ANALYSIS_DURATION_MS,
    10 * 60 * 1000,
  ),
});
void bundleStore.prune(24 * 60 * 60 * 1000);
const bundlePruneTimer = setInterval(
  () => void bundleStore.prune(24 * 60 * 60 * 1000),
  60 * 60 * 1000,
);
bundlePruneTimer.unref();
const server = buildServer({
  jobStore,
  bundleStore,
  admission: {
    maxRequestsPerWindow: positiveInteger(
      process.env.ANALYSIS_RATE_LIMIT,
      8,
    ),
    windowMs: positiveInteger(process.env.ANALYSIS_RATE_WINDOW_MS, 60_000),
    maxOutstandingJobs: positiveInteger(
      process.env.MAX_OUTSTANDING_JOBS,
      4,
    ),
  },
  onJobCreated: (job) => runner.enqueue(job),
  onJobCancelled: (jobId) => runner.cancel(jobId),
});

await server.listen({ port, host });
