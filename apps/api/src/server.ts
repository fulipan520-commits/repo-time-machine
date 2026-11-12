import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import cors from "@fastify/cors";
import type {
  AnalysisJob,
  JobStatus,
} from "@rtm/contracts";
import { analysisJobSchema } from "@rtm/contracts";
import Fastify, { type FastifyInstance } from "fastify";
import { z } from "zod";

export interface RepositoryIdentity {
  owner: string;
  name: string;
  canonicalUrl: string;
}

export type RepositoryValidation =
  | { ok: true; value: RepositoryIdentity }
  | { ok: false; message: string };

const githubName = /^[A-Za-z0-9._-]+$/;

export function validateGithubRepository(url: string): RepositoryValidation {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, message: "Enter a valid GitHub repository URL." };
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    return { ok: false, message: "Only HTTP(S) URLs are accepted." };
  }
  if (parsed.hostname.toLowerCase() !== "github.com") {
    return { ok: false, message: "Only github.com repositories are accepted." };
  }
  if (parsed.search || parsed.hash || parsed.username || parsed.password) {
    return { ok: false, message: "Remove URL queries, fragments, and credentials." };
  }

  const parts = parsed.pathname.split("/").filter(Boolean);
  if (parts.length !== 2) {
    return {
      ok: false,
      message: "Use https://github.com/owner/repository.",
    };
  }

  const owner = parts[0] ?? "";
  const rawName = parts[1] ?? "";
  const name = rawName.replace(/\.git$/, "");
  if (
    !githubName.test(owner) ||
    !githubName.test(name) ||
    owner === "." ||
    owner === ".." ||
    name === "." ||
    name === ".."
  ) {
    return { ok: false, message: "The repository owner or name is invalid." };
  }

  return {
    ok: true,
    value: {
      owner,
      name,
      canonicalUrl: `https://github.com/${owner}/${name}`,
    },
  };
}

export interface JobStore {
  create(job: AnalysisJob): Promise<void>;
  get(id: string): Promise<AnalysisJob | undefined>;
  update(id: string, patch: Partial<AnalysisJob>): Promise<AnalysisJob | undefined>;
  countOutstanding(): Promise<number>;
}

export class InMemoryJobStore implements JobStore {
  private readonly jobs = new Map<string, AnalysisJob>();

  async create(job: AnalysisJob): Promise<void> {
    this.jobs.set(job.id, structuredClone(job));
  }

  async get(id: string): Promise<AnalysisJob | undefined> {
    const job = this.jobs.get(id);
    return job ? structuredClone(job) : undefined;
  }

  async update(
    id: string,
    patch: Partial<AnalysisJob>,
  ): Promise<AnalysisJob | undefined> {
    const current = this.jobs.get(id);
    if (!current) {
      return undefined;
    }
    const next = analysisJobSchema.parse({ ...current, ...patch });
    this.jobs.set(id, next);
    return structuredClone(next);
  }

  async countOutstanding(): Promise<number> {
    return [...this.jobs.values()].filter(
      (job) => !["ready", "failed", "cancelled"].includes(job.status),
    ).length;
  }
}

export interface BundleStore {
  put(key: string, content: Buffer): Promise<void>;
  get(key: string): Promise<Buffer | undefined>;
}

export class InMemoryBundleStore implements BundleStore {
  private readonly bundles = new Map<string, Buffer>();

  async put(key: string, content: Buffer): Promise<void> {
    this.bundles.set(key, content);
  }

  async get(key: string): Promise<Buffer | undefined> {
    return this.bundles.get(key);
  }
}

export class FileBundleStore implements BundleStore {
  constructor(private readonly rootDirectory: string) {}

  private pathFor(key: string): string {
    if (!/^[A-Za-z0-9._-]+$/.test(key)) {
      throw new Error("Invalid bundle key.");
    }
    return path.join(this.rootDirectory, `${key}.json.gz`);
  }

  async put(key: string, content: Buffer): Promise<void> {
    await mkdir(this.rootDirectory, { recursive: true });
    await writeFile(this.pathFor(key), content);
  }

  async get(key: string): Promise<Buffer | undefined> {
    try {
      return await readFile(this.pathFor(key));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return undefined;
      }
      throw error;
    }
  }
}

const createAnalysisRequestSchema = z.object({
  repositoryUrl: z.string().min(1),
  branch: z.string().min(1).max(200).default("main"),
});

export interface ServerOptions {
  jobStore: JobStore;
  bundleStore: BundleStore;
  now?: () => Date;
  onJobCreated?: (job: AnalysisJob) => void;
  onJobCancelled?: (jobId: string) => void;
  admission?: AdmissionPolicy;
  allowedOrigins?: string[];
}

export interface AdmissionPolicy {
  maxRequestsPerWindow: number;
  windowMs: number;
  maxOutstandingJobs: number;
}

const defaultAdmission: AdmissionPolicy = {
  maxRequestsPerWindow: 8,
  windowMs: 60_000,
  maxOutstandingJobs: 4,
};

const terminalStatuses = new Set<JobStatus>([
  "ready",
  "failed",
  "cancelled",
]);

export function buildServer(options: ServerOptions): FastifyInstance {
  const server = Fastify({ logger: false });
  const now = options.now ?? (() => new Date());
  const admission = options.admission ?? defaultAdmission;
  const requestHistory = new Map<string, number[]>();
  if (options.allowedOrigins && options.allowedOrigins.length > 0) {
    server.register(cors, { origin: options.allowedOrigins });
  }

  server.get("/healthz", async () => ({ status: "ok" }));

  server.post("/api/analyses", async (request, reply) => {
    const parsed = createAnalysisRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: {
          code: "INVALID_REQUEST",
          message: parsed.error.issues[0]?.message ?? "Invalid request.",
        },
      });
    }

    const repository = validateGithubRepository(parsed.data.repositoryUrl);
    if (!repository.ok) {
      return reply.code(400).send({
        error: { code: "INVALID_REPOSITORY", message: repository.message },
      });
    }

    if ((await options.jobStore.countOutstanding()) >= admission.maxOutstandingJobs) {
      return reply.code(429).send({
        error: {
          code: "CAPACITY_REACHED",
          message: "The analysis queue is full. Try again later.",
        },
      });
    }

    const currentTime = now().getTime();
    const requests = (requestHistory.get(request.ip) ?? []).filter(
      (timestamp) => timestamp > currentTime - admission.windowMs,
    );
    if (requests.length >= admission.maxRequestsPerWindow) {
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil(
          ((requests[0] ?? currentTime) + admission.windowMs - currentTime) /
            1000,
        ),
      );
      requestHistory.set(request.ip, requests);
      return reply
        .code(429)
        .header("retry-after", String(retryAfterSeconds))
        .send({
          error: {
            code: "RATE_LIMITED",
            message: "Too many analyses requested. Try again later.",
          },
        });
    }
    requests.push(currentTime);
    requestHistory.set(request.ip, requests);

    const timestamp = now().toISOString();
    const job = analysisJobSchema.parse({
      id: randomUUID(),
      repository: repository.value,
      branch: parsed.data.branch,
      status: "queued",
      progress: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    await options.jobStore.create(job);
    options.onJobCreated?.(job);
    return reply.code(202).send(job);
  });

  server.get<{ Params: { id: string } }>(
    "/api/analyses/:id",
    async (request, reply) => {
      const job = await options.jobStore.get(request.params.id);
      if (!job) {
        return reply.code(404).send({
          error: { code: "NOT_FOUND", message: "Analysis job not found." },
        });
      }
      return job;
    },
  );

  server.post<{ Params: { id: string } }>(
    "/api/analyses/:id/cancel",
    async (request, reply) => {
      const job = await options.jobStore.get(request.params.id);
      if (!job) {
        return reply.code(404).send({
          error: { code: "NOT_FOUND", message: "Analysis job not found." },
        });
      }
      if (terminalStatuses.has(job.status)) {
        return reply.code(409).send({
          error: {
            code: "TERMINAL_JOB",
            message: "This analysis can no longer be cancelled.",
          },
        });
      }

      const cancelled = await options.jobStore.update(job.id, {
        status: "cancelled",
        updatedAt: now().toISOString(),
      });
      options.onJobCancelled?.(job.id);
      return reply.code(202).send(cancelled);
    },
  );

  server.get<{ Params: { id: string } }>(
    "/api/bundles/:id",
    async (request, reply) => {
      const job = await options.jobStore.get(request.params.id);
      if (!job) {
        return reply.code(404).send({
          error: { code: "NOT_FOUND", message: "Analysis job not found." },
        });
      }
      if (!job.bundleKey) {
        return reply.code(404).send({
          error: { code: "BUNDLE_NOT_READY", message: "Analysis is not ready." },
        });
      }

      const compressedBundle = await options.bundleStore.get(job.bundleKey);
      if (!compressedBundle) {
        return reply.code(404).send({
          error: { code: "BUNDLE_NOT_FOUND", message: "Bundle is unavailable." },
        });
      }
      const bundle = gunzipSync(compressedBundle).toString("utf8");
      return reply
        .header("cache-control", "public, max-age=31536000, immutable")
        .type("application/json")
        .send(bundle);
    },
  );

  return server;
}
