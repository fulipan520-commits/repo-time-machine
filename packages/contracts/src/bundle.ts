import { z } from "zod";

export const shaSchema = z.string().regex(/^[0-9a-f]{40}$/);
export const changeStatusSchema = z.enum([
  "added",
  "removed",
  "unchanged",
  "growing",
  "shrinking",
]);

export const moduleNodeSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  path: z.string().min(1),
  fileCount: z.number().int().nonnegative(),
  loc: z.number().int().nonnegative(),
  incoming: z.number().int().nonnegative(),
  outgoing: z.number().int().nonnegative(),
  firstSeen: z.string().datetime(),
  lastChanged: z.string().datetime(),
  status: changeStatusSchema,
});

export const dependencyEdgeSchema = z.object({
  source: z.string().min(1),
  target: z.string().min(1),
  weight: z.number().int().positive(),
  status: z.enum(["added", "removed", "unchanged"]),
});

export const evidenceSchema = z.object({
  commitSha: shaSchema,
  title: z.string(),
  author: z.string(),
  authoredAt: z.string().datetime(),
  paths: z.array(z.string()),
});

export const architectureEventSchema = z.object({
  id: z.string().min(1),
  type: z.enum([
    "module-added",
    "module-removed",
    "module-split",
    "module-merged",
    "module-moved",
    "dependency-added",
    "dependency-removed",
  ]),
  modules: z.array(z.string().min(1)),
  inferred: z.boolean(),
  confidence: z.enum(["low", "medium", "high"]),
  evidence: evidenceSchema,
});

export const snapshotSchema = z.object({
  id: z.string().min(1),
  commitSha: shaSchema,
  committedAt: z.string().datetime(),
  omittedCommits: z.number().int().nonnegative(),
  nodes: z.array(moduleNodeSchema),
  edges: z.array(dependencyEdgeSchema),
  events: z.array(architectureEventSchema),
});

export const analysisBundleSchema = z.object({
  schemaVersion: z.literal("1.0"),
  analyzerVersion: z.string().min(1),
  repository: z.object({
    owner: z.string().min(1),
    name: z.string().min(1),
    branch: z.string().min(1),
    headSha: shaSchema,
  }),
  generatedAt: z.string().datetime(),
  limits: z.object({
    maxCommits: z.number().int().positive(),
    maxKeyframes: z.number().int().positive(),
    maxModules: z.number().int().positive(),
  }),
  coverage: z.object({
    sourceFiles: z.number().int().nonnegative(),
    parsedFiles: z.number().int().nonnegative(),
    excludedFiles: z.number().int().nonnegative(),
  }),
  keyframes: z.array(snapshotSchema).min(1),
});

export type ChangeStatus = z.infer<typeof changeStatusSchema>;
export type ModuleNode = z.infer<typeof moduleNodeSchema>;
export type DependencyEdge = z.infer<typeof dependencyEdgeSchema>;
export type Evidence = z.infer<typeof evidenceSchema>;
export type ArchitectureEvent = z.infer<typeof architectureEventSchema>;
export type Snapshot = z.infer<typeof snapshotSchema>;
export type AnalysisBundle = z.infer<typeof analysisBundleSchema>;
