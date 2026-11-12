import { z } from "zod";

export const jobStatusSchema = z.enum([
  "queued",
  "cloning",
  "analyzing",
  "publishing",
  "ready",
  "failed",
  "cancelled",
]);

export const analysisJobSchema = z.object({
  id: z.string().uuid(),
  repository: z.object({
    owner: z.string().min(1),
    name: z.string().min(1),
    canonicalUrl: z.string().url(),
  }),
  branch: z.string().min(1).max(200),
  status: jobStatusSchema,
  progress: z.number().min(0).max(100),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  bundleKey: z.string().optional(),
  error: z
    .object({
      code: z.string(),
      message: z.string(),
    })
    .optional(),
});

export type JobStatus = z.infer<typeof jobStatusSchema>;
export type AnalysisJob = z.infer<typeof analysisJobSchema>;
