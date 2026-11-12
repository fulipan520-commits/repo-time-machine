import { expect, it } from "vitest";
import { buildModuleGraph } from "./graph";

it("aggregates file imports without self-directory edges", () => {
  const graph = buildModuleGraph(
    [
      { path: "src/api/a.ts", language: "typescript", loc: 10 },
      { path: "src/api/b.ts", language: "typescript", loc: 20 },
      { path: "src/db/c.ts", language: "typescript", loc: 30 },
    ],
    [
      { sourceFile: "src/api/a.ts", targetFile: "src/api/b.ts" },
      { sourceFile: "src/api/a.ts", targetFile: "src/db/c.ts" },
      { sourceFile: "src/api/b.ts", targetFile: "src/db/c.ts" },
    ],
  );

  expect(graph.nodes.map((node) => node.id)).toEqual(["src/api", "src/db"]);
  expect(graph.edges).toEqual([
    {
      source: "src/api",
      target: "src/db",
      weight: 2,
      status: "unchanged",
    },
  ]);
});

it("collapses the graph above the module budget", () => {
  const graph = buildModuleGraph(
    [
      { path: "src/a/one.ts", language: "typescript", loc: 1 },
      { path: "src/a/two.ts", language: "typescript", loc: 1 },
      { path: "src/b/one.ts", language: "typescript", loc: 1 },
    ],
    [],
    { maxModules: 1 },
  );

  expect(graph.nodes).toHaveLength(1);
  expect(graph.nodes[0]?.id).toBe("src");
});
