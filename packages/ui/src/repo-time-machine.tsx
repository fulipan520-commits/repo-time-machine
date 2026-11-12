"use client";

import { FormEvent, useEffect, useState } from "react";
import type { AnalysisBundle, AnalysisJob } from "@rtm/contracts";
import { fixtureBundle } from "./fixture";
import { GraphWorkspace } from "./graph-workspace";
import styles from "./repo-time-machine.module.css";

const apiBase = "/api/service";

const statusCopy: Record<AnalysisJob["status"], string> = {
  queued: "任务已排队",
  cloning: "正在读取提交历史",
  analyzing: "正在重建架构切片",
  publishing: "正在发布快照",
  ready: "分析完成",
  failed: "分析失败",
  cancelled: "分析已取消",
};

export function RepoTimeMachine() {
  const [repositoryUrl, setRepositoryUrl] = useState("");
  const [branch, setBranch] = useState("main");
  const [job, setJob] = useState<AnalysisJob>();
  const [bundle, setBundle] = useState<AnalysisBundle>();
  const [requestError, setRequestError] = useState<string>();

  useEffect(() => {
    if (
      !job ||
      ["ready", "failed", "cancelled"].includes(job.status) ||
      bundle
    ) {
      return undefined;
    }

    let cancelled = false;
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(`${apiBase}/api/analyses/${job.id}`);
        const nextJob = (await response.json()) as AnalysisJob;
        if (cancelled) {
          return;
        }
        setJob(nextJob);

        if (nextJob.status === "ready" && nextJob.bundleKey) {
          const bundleResponse = await fetch(
            `${apiBase}/api/bundles/${nextJob.id}`,
          );
          if (!bundleResponse.ok) {
            throw new Error("快照已生成，但暂时无法读取。");
          }
          setBundle((await bundleResponse.json()) as AnalysisBundle);
        }
      } catch (error) {
        if (!cancelled) {
          setRequestError(
            error instanceof Error ? error.message : "无法读取分析进度。",
          );
        }
      }
    }, 900);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [bundle, job]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setRequestError(undefined);
    setBundle(undefined);

    try {
      const response = await fetch(`${apiBase}/api/analyses`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          repositoryUrl: repositoryUrl.trim(),
          branch: branch.trim() || "main",
        }),
      });
      const payload = (await response.json()) as
        | AnalysisJob
        | { error?: { message?: string } };
      if (!response.ok) {
        throw new Error(
          "error" in payload
            ? payload.error?.message ?? "无法创建分析任务。"
            : "无法创建分析任务。",
        );
      }
      setJob(payload as AnalysisJob);
    } catch (error) {
      setRequestError(
        error instanceof Error
          ? error.message
          : "分析服务当前不可用，请稍后重试。",
      );
    }
  };

  if (bundle) {
    return (
      <div className={styles.analysisView}>
        <div className={styles.analysisTopbar}>
          <a href="/" onClick={() => setBundle(undefined)}>
            ← 分析另一个仓库
          </a>
          <span>
            {bundle.coverage.parsedFiles}/{bundle.coverage.sourceFiles} 个源码文件已解析
          </span>
        </div>
        <GraphWorkspace bundle={bundle} />
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <header className={styles.nav}>
        <a className={styles.wordmark} href="/">
          <span>RTM</span>
          Repo Time Machine
        </a>
        <p>Public Git history · Python + TypeScript</p>
        <span className={styles.edition}>Build 0.1 / open source</span>
      </header>

      <main className={styles.hero}>
        <section className={styles.intro}>
          <span className={styles.kicker}>Architecture, traced through time</span>
          <h1>
            看清代码
            <br />
            是<span className={styles.accent}>怎么</span>变成
            <br />
            今天这样的。
          </h1>
          <p className={styles.lede}>
            输入一个公开 GitHub 仓库。拖动历史时间轴，看模块如何出现、迁移、
            拆分，并从提交和文件里找到每一次结构变化的证据。
          </p>

          <form className={styles.intake} onSubmit={submit}>
            <label className={styles.urlField}>
              <span>GitHub repository</span>
              <input
                value={repositoryUrl}
                onChange={(event) => setRepositoryUrl(event.target.value)}
                placeholder="https://github.com/owner/repo"
                inputMode="url"
                autoComplete="url"
                required
              />
            </label>
            <label className={styles.branchField}>
              <span>Branch</span>
              <input
                value={branch}
                onChange={(event) => setBranch(event.target.value)}
                placeholder="main"
              />
            </label>
            <button className={styles.analyzeButton} type="submit">
              开始考古
              <span aria-hidden="true">↗</span>
            </button>
          </form>

          <div className={styles.formFoot}>
            <button type="button" onClick={() => setBundle(fixtureBundle)}>
              先用示例仓库看看
            </button>
            <p>只分析公开仓库；不会检出或执行仓库代码。</p>
          </div>

          {job ? (
            <div className={styles.progress} role="status">
              <div>
                <span>{statusCopy[job.status]}</span>
                <strong>{job.progress}%</strong>
              </div>
              <div className={styles.progressTrack}>
                <span style={{ width: `${job.progress}%` }} />
              </div>
              <p>
                {job.repository.owner}/{job.repository.name} · {job.branch}
              </p>
            </div>
          ) : null}

          {requestError ? (
            <p className={styles.error} role="alert">
              {requestError}
            </p>
          ) : null}
        </section>

        <aside className={styles.specimen} aria-label="架构时间机器示意图">
          <div className={styles.specimenHead}>
            <span>Field specimen</span>
            <strong>ARCH / 04</strong>
          </div>
          <div className={styles.strata} aria-hidden="true">
            <div className={styles.orbitOne} />
            <div className={styles.orbitTwo} />
            <span className={styles.nodeOne}>app</span>
            <span className={styles.nodeTwo}>api</span>
            <span className={styles.nodeThree}>db</span>
            <span className={styles.nodeFour}>workers</span>
            <div className={styles.scanline} />
          </div>
          <div className={styles.specimenNotes}>
            <div>
              <span>读取</span>
              <strong>git history</strong>
            </div>
            <div>
              <span>识别</span>
              <strong>structure shifts</strong>
            </div>
            <div>
              <span>保留</span>
              <strong>commit evidence</strong>
            </div>
          </div>
          <p className={styles.marginNote}>
            每条边都有来源。
            <br />
            每个转折都可回查。
          </p>
        </aside>
      </main>
    </div>
  );
}
