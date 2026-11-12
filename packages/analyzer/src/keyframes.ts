import type { Snapshot } from "@rtm/contracts";

export interface ScoredSnapshot {
  snapshot: Snapshot;
  score: number;
  commitIndex: number;
}

export function selectKeyframes(
  candidates: readonly ScoredSnapshot[],
  maxKeyframes: number,
): Snapshot[] {
  if (candidates.length <= maxKeyframes) {
    return candidates.map((candidate) => candidate.snapshot);
  }

  const selected = new Set<ScoredSnapshot>();
  selected.add(candidates[0]!);
  selected.add(candidates[candidates.length - 1]!);

  const middle = candidates
    .slice(1, -1)
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.commitIndex - right.commitIndex,
    );

  for (const candidate of middle) {
    if (selected.size >= maxKeyframes) {
      break;
    }
    selected.add(candidate);
  }

  return [...selected]
    .sort((left, right) => left.commitIndex - right.commitIndex)
    .map((candidate) => candidate.snapshot);
}
