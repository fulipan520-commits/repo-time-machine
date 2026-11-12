import type { AnalysisJob } from "@rtm/contracts";
import {
  runAnalysisJob,
  type RunAnalysisJobOptions,
  type WorkerBundleStore,
  type WorkerJobStore,
} from "./run-job";

export interface MemoryRunnerOptions {
  jobStore: WorkerJobStore;
  bundleStore: WorkerBundleStore;
  workRoot?: string;
  runner?: typeof runAnalysisJob;
  maxConcurrent?: number;
  maxDurationMs?: number;
}

export class MemoryRunner {
  private readonly active = new Set<Promise<unknown>>();
  private readonly controllers = new Map<string, AbortController>();
  private readonly pending: AnalysisJob[] = [];
  private readonly maxConcurrent: number;

  constructor(private readonly options: MemoryRunnerOptions) {
    this.maxConcurrent = Math.max(1, options.maxConcurrent ?? 1);
  }

  enqueue(job: AnalysisJob): void {
    this.pending.push(job);
    this.pump();
  }

  cancel(jobId: string): void {
    const pendingIndex = this.pending.findIndex((job) => job.id === jobId);
    if (pendingIndex >= 0) {
      this.pending.splice(pendingIndex, 1);
    }
    this.controllers.get(jobId)?.abort(new Error("Analysis cancelled."));
  }

  private pump(): void {
    while (
      this.active.size < this.maxConcurrent &&
      this.pending.length > 0
    ) {
      const job = this.pending.shift();
      if (!job) {
        return;
      }
      this.start(job);
    }
  }

  private start(job: AnalysisJob): void {
    const controller = new AbortController();
    this.controllers.set(job.id, controller);
    const runOptions: RunAnalysisJobOptions = {
      job,
      jobStore: this.options.jobStore,
      bundleStore: this.options.bundleStore,
      signal: controller.signal,
      ...(this.options.workRoot ? { workRoot: this.options.workRoot } : {}),
      ...(this.options.maxDurationMs
        ? { maxDurationMs: this.options.maxDurationMs }
        : {}),
    };
    const running = (this.options.runner ?? runAnalysisJob)(runOptions).finally(
      () => {
        this.active.delete(running);
        this.controllers.delete(job.id);
        this.pump();
      },
    );
    this.active.add(running);
  }

  async drain(): Promise<void> {
    while (this.active.size > 0 || this.pending.length > 0) {
      await Promise.all([...this.active]);
      this.pump();
    }
  }
}
