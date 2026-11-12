import { mkdtemp, rm, utimes } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { FileBundleStore } from "./server";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

it("removes stale bundle files without touching fresh snapshots", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "rtm-storage-"));
  temporaryDirectories.push(directory);
  const store = new FileBundleStore(directory);
  await store.put("old", Buffer.from("old"));
  await store.put("fresh", Buffer.from("fresh"));
  const oldPath = path.join(directory, "old.json.gz");
  await utimes(oldPath, new Date(0), new Date(0));

  await store.prune(1_000, Date.parse("2026-11-12T00:00:00.000Z"));

  await expect(store.get("old")).resolves.toBeUndefined();
  await expect(store.get("fresh")).resolves.toBeDefined();
});
