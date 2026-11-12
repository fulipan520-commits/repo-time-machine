import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { gzipSync } from "node:zlib";
import { analyzeRepository } from "@rtm/analyzer";
import type { AnalysisBundle, AnalysisJob } from "@rtm/contracts";

const exec = promisify(execFile);

export interface WorkerJobStore {
  get(id: string): Promise<AnalysisJob | undefined>;
  update(id: string, patch: Partial<AnalysisJob>): Promise<AnalysisJob | undefined>;
}

export interface WorkerBundleStore {
  put(key: string, content: Buffer): Promise<void>;
}

export interface RunAnalysisJobOptions {
  job: AnalysisJob;
  jobStore: WorkerJobStore;
  bundleStore: WorkerBundleStore;
  workRoot?: string;
  cloneRepository?: (job: AnalysisJob, destination: string) => Promise<void>;
  analyze?: (job: AnalysisJob, repositoryPath: string) => Promise<AnalysisBundle>;
  now?: () => Date;
}

export type RunAnalysisJobResult = AnalysisJob;

async function cloneRepository(
  job: AnalysisJob,
  destination: string,
): Promise<void> {
  await exec(
    "git",
    [
      "clone",
      "--filter=blob:none",
      "--no-checkout",
      "--single-branch",
      "--branch",
      job.branch,
      job.repository.canonicalUrl,
      destination,
    ],
    {
      maxBuffer: 8 * 1024 * 1024,
      timeout: 5 * 60 * 1000,
    },
  );
}

async function analyze(
  job: AnalysisJob,
  repositoryPath: string,
): Promise<AnalysisBundle> {
  return analyzeRepository({
    repositoryPath,
    branch: job.branch,
    repository: {
      owner: job.repository.owner,
      name: job.repository.name,
    },
  });
}

async function canContinue(
  store: WorkerJobStore,
  jobId: string,
): Promise<boolean> {
  const current = await store.get(jobId);
  return current !== undefined && current.status !== "cancelled";
}

export async function runAnalysisJob(
  options: RunAnalysisJobOptions,
): Promise<RunAnalysisJobResult> {
  const now = options.now ?? (() => new Date());
  const workRoot = options.workRoot ?? os.tmpdir();
  const workDirectory = await mkdtemp(path.join(workRoot, "rtm-job-"));
  const update = async (patch: Partial<AnalysisJob>) =>
    options.jobStore.update(options.job.id, {
      ...patch,
      updatedAt: now().toISOString(),
    });

  try {
    await update({ status: "cloning", progress: 10 });
    await (options.cloneRepository ?? cloneRepository)(
      options.job,
      workDirectory,
    );
    if (!(await canContinue(options.jobStore, options.job.id))) {
      return (await options.jobStore.get(options.job.id)) ?? options.job;
    }

    await update({ status: "analyzing", progress: 35 });
    const bundle = await (options.analyze ?? analyze)(
      options.job,
      workDirectory,
    );
    if (!(await canContinue(options.jobStore, options.job.id))) {
      return (await options.jobStore.get(options.job.id)) ?? options.job;
    }

    await update({ status: "publishing", progress: 85 });
    const bundleKey = createHash("sha256")
      .update(options.job.repository.canonicalUrl)
      .update(options.job.branch)
      .update(bundle.repository.headSha)
      .update(bundle.analyzerVersion)
      .digest("hex")
      .slice(0, 24);
    await options.bundleStore.put(
      bundleKey,
      gzipSync(JSON.stringify(bundle)),
    );

    return (
      (await update({
        status: "ready",
        progress: 100,
        bundleKey,
      })) ?? options.job
    );
  } catch {
    return (
      (await update({
        status: "failed",
        progress: 100,
        error: {
          code: "ANALYSIS_FAILED",
          message:
            "Analysis failed. Check that the repository is public and within supported limits.",
        },
      })) ?? options.job
    );
  } finally {
    await rm(workDirectory, { recursive: true, force: true });
  }
}
