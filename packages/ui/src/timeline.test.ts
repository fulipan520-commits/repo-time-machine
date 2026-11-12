import type { Snapshot } from "@rtm/contracts";
import { expect, it } from "vitest";
import { timelinePercent } from "./timeline";

function snapshot(id: string, committedAt: string): Snapshot {
  return {
    id,
    commitSha: "a".repeat(40),
    committedAt,
    omittedCommits: 0,
    nodes: [],
    edges: [],
    events: [],
  };
}

it("positions keyframes by elapsed time instead of array index", () => {
  const snapshots = [
    snapshot("first", "2026-01-01T00:00:00.000Z"),
    snapshot("second", "2026-01-02T00:00:00.000Z"),
    snapshot("last", "2026-01-11T00:00:00.000Z"),
  ];

  expect(timelinePercent(snapshots, 1)).toBeCloseTo(10);
});
