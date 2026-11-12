import { expect, it } from "vitest";
import { fixtureBundle } from "./fixture";
import { highlightedNodeIds } from "./graph-canvas";

it("highlights the selected module and its direct neighbors", () => {
  const snapshot = fixtureBundle.keyframes[1]!;

  expect([...highlightedNodeIds(snapshot, "src/app")]).toEqual([
    "src/app",
    "src/api",
    "src/db",
  ]);
});
