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
}

export class MemoryRunner {
  private readonly active = new Set<Promise<unknown>>();

  constructor(private readonly options: MemoryRunnerOptions) {}

  enqueue(job: AnalysisJob): void {
    const runOptions: RunAnalysisJobOptions = {
      job,
      jobStore: this.options.jobStore,
      bundleStore: this.options.bundleStore,
      ...(this.options.workRoot ? { workRoot: this.options.workRoot } : {}),
    };
    const running = (this.options.runner ?? runAnalysisJob)(runOptions).finally(
      () => {
        this.active.delete(running);
      },
    );
    this.active.add(running);
  }

  async drain(): Promise<void> {
    await Promise.all([...this.active]);
  }
}
