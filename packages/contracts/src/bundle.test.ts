import { describe, expect, it } from "vitest";
import { analysisBundleSchema } from "./bundle";

describe("analysisBundleSchema", () => {
  it("accepts a minimal deterministic bundle", () => {
    const result = analysisBundleSchema.parse({
      schemaVersion: "1.0",
      analyzerVersion: "0.1.0",
      repository: {
        owner: "acme",
        name: "widget",
        branch: "main",
        headSha: "a".repeat(40),
      },
      generatedAt: "2026-11-12T00:00:00.000Z",
      limits: {
        maxCommits: 2000,
        maxKeyframes: 60,
        maxModules: 500,
      },
      coverage: {
        sourceFiles: 2,
        parsedFiles: 2,
        excludedFiles: 0,
      },
      keyframes: [
        {
          id: "a".repeat(40),
          commitSha: "a".repeat(40),
          committedAt: "2026-11-12T00:00:00.000Z",
          omittedCommits: 0,
          nodes: [],
          edges: [],
          events: [],
        },
      ],
    });

    expect(result.keyframes[0]?.nodes).toEqual([]);
  });

  it("rejects a non-40-character commit SHA", () => {
    const result = analysisBundleSchema.safeParse({
      schemaVersion: "1.0",
      analyzerVersion: "0.1.0",
      repository: {
        owner: "acme",
        name: "widget",
        branch: "main",
        headSha: "abc",
      },
      generatedAt: "2026-11-12T00:00:00.000Z",
      limits: {
        maxCommits: 2000,
        maxKeyframes: 60,
        maxModules: 500,
      },
      coverage: {
        sourceFiles: 0,
        parsedFiles: 0,
        excludedFiles: 0,
      },
      keyframes: [],
    });

    expect(result.success).toBe(false);
  });
});
