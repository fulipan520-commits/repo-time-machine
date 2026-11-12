"use client";

import { useEffect, useState } from "react";
import type { Snapshot } from "@rtm/contracts";
import styles from "./workspace.module.css";

interface TimelineProps {
  snapshots: readonly Snapshot[];
  activeIndex: number;
  onChange: (index: number) => void;
}

function shortDate(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(new Date(value));
}

export function timelinePercent(
  snapshots: readonly Snapshot[],
  index: number,
): number {
  const snapshot = snapshots[index];
  const first = snapshots[0];
  const last = snapshots[snapshots.length - 1];
  if (!snapshot || !first || !last || snapshots.length <= 1) {
    return 0;
  }

  const firstTime = Date.parse(first.committedAt);
  const lastTime = Date.parse(last.committedAt);
  const currentTime = Date.parse(snapshot.committedAt);
  if (lastTime <= firstTime) {
    return 0;
  }

  return Math.max(
    0,
    Math.min(100, ((currentTime - firstTime) / (lastTime - firstTime)) * 100),
  );
}

export function Timeline({
  snapshots,
  activeIndex,
  onChange,
}: TimelineProps) {
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    if (!playing) {
      return undefined;
    }
    const timer = window.setInterval(() => {
      if (activeIndex >= snapshots.length - 1) {
        setPlaying(false);
        return;
      }
      onChange(activeIndex + 1);
    }, 1100);
    return () => window.clearInterval(timer);
  }, [activeIndex, onChange, playing, snapshots.length]);

  const active = snapshots[activeIndex] ?? snapshots[0];
  if (!active) {
    return null;
  }

  return (
    <section className={styles.timeline} aria-label="架构时间轴">
      <div className={styles.timelineMeta}>
        <button
          className={styles.playButton}
          type="button"
          onClick={() => setPlaying((value) => !value)}
          aria-label={playing ? "暂停时间轴" : "播放时间轴"}
        >
          {playing ? "暂停" : "播放"}
        </button>
        <div>
          <span className={styles.eyebrow}>当前切片</span>
          <strong>{shortDate(active.committedAt)}</strong>
        </div>
        <p>
          {active.omittedCommits > 0
            ? `跳过 ${active.omittedCommits} 个非结构提交`
            : "历史起点"}
        </p>
      </div>

      <div className={styles.timelineTrack}>
        <input
          aria-label="选择架构时间点"
          className={styles.timelineRange}
          type="range"
          min={0}
          max={Math.max(0, snapshots.length - 1)}
          step={1}
          value={activeIndex}
          onChange={(event) => onChange(Number(event.target.value))}
        />
        <div className={styles.timelineMarkers}>
          {snapshots.map((snapshot, index) => {
            const title =
              snapshot.events[0]?.evidence.title ?? `时间切片 ${index + 1}`;
            return (
              <button
                key={snapshot.id}
                type="button"
                className={styles.timelineMarker}
                data-active={index === activeIndex}
                style={{
                  left: `${timelinePercent(snapshots, index)}%`,
                }}
                aria-label={title}
                title={title}
                onClick={() => onChange(index)}
              >
                <span />
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}
