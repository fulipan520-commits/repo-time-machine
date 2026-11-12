import { buildServer, FileBundleStore, InMemoryJobStore } from "./server";

const port = Number(process.env.PORT ?? 3001);
const host = process.env.HOST ?? "127.0.0.1";
const server = buildServer({
  jobStore: new InMemoryJobStore(),
  bundleStore: new FileBundleStore(
    process.env.BUNDLE_DIRECTORY ?? ".data/bundles",
  ),
});

await server.listen({ port, host });
