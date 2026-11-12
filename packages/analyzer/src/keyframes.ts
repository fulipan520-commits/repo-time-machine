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
  const limit = Math.max(0, Math.floor(maxKeyframes));
  if (limit === 0) {
    return [];
  }
  if (candidates.length <= limit) {
    return candidates.map((candidate) => candidate.snapshot);
  }

  const selected = new Set<ScoredSnapshot>();
  selected.add(candidates[candidates.length - 1]!);
  if (limit > 1) {
    selected.add(candidates[0]!);
  }

  const middle = candidates
    .slice(1, -1)
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.commitIndex - right.commitIndex,
    );

  for (const candidate of middle) {
    if (selected.size >= limit) {
      break;
    }
    selected.add(candidate);
  }

  return [...selected]
    .sort((left, right) => left.commitIndex - right.commitIndex)
    .map((candidate) => candidate.snapshot);
}
