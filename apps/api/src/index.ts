import { buildServer, FileBundleStore, InMemoryJobStore } from "./server";
import { MemoryRunner } from "@rtm/worker";

const port = Number(process.env.PORT ?? 3001);
const host = process.env.HOST ?? "127.0.0.1";
const jobStore = new InMemoryJobStore();
const bundleStore = new FileBundleStore(
  process.env.BUNDLE_DIRECTORY ?? ".data/bundles",
);
const runner = new MemoryRunner({ jobStore, bundleStore });
const server = buildServer({
  jobStore,
  bundleStore,
  onJobCreated: (job) => runner.enqueue(job),
  onJobCancelled: (jobId) => runner.cancel(jobId),
});

await server.listen({ port, host });
