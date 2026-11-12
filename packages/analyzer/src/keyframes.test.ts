import type { Snapshot } from "@rtm/contracts";
import { expect, it } from "vitest";
import { selectKeyframes, type ScoredSnapshot } from "./keyframes";

function candidate(index: number, score: number): ScoredSnapshot {
  return {
    snapshot: { id: String(index) } as Snapshot,
    score,
    commitIndex: index,
  };
}

it("returns only the latest keyframe when the budget is one", () => {
  const selected = selectKeyframes(
    [candidate(0, 10), candidate(1, 2), candidate(2, 5)],
    1,
  );

  expect(selected.map((snapshot) => snapshot.id)).toEqual(["2"]);
});
