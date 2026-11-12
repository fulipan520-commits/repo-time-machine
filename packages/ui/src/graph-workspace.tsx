"use client";

import { useEffect, useState } from "react";
import type { AnalysisBundle } from "@rtm/contracts";
import { EvidencePanel } from "./evidence-panel";
import { GraphCanvas } from "./graph-canvas";
import { Timeline } from "./timeline";
import styles from "./workspace.module.css";

interface GraphWorkspaceProps {
  bundle: AnalysisBundle;
}

export function GraphWorkspace({ bundle }: GraphWorkspaceProps) {
  const [activeIndex, setActiveIndex] = useState(
    Math.max(0, bundle.keyframes.length - 1),
  );
  const [selectedNodeId, setSelectedNodeId] = useState<string>();
  const snapshot = bundle.keyframes[activeIndex] ?? bundle.keyframes[0];

  useEffect(() => {
    if (!snapshot) {
      return;
    }
    const stillExists = snapshot.nodes.some(
      (node) => node.id === selectedNodeId,
    );
    if (!stillExists) {
      setSelectedNodeId(snapshot.nodes[0]?.id);
    }
  }, [selectedNodeId, snapshot]);

  if (!snapshot) {
    return null;
  }

  const selectedNode = snapshot.nodes.find(
    (node) => node.id === selectedNodeId,
  );

  return (
    <div className={styles.workspace}>
      <header className={styles.workspaceHeader}>
        <div>
          <span className={styles.eyebrow}>Repo time machine / analysis</span>
          <h1>
            {bundle.repository.owner}
            <span>/</span>
            {bundle.repository.name}
          </h1>
        </div>
        <div className={styles.repoMeta}>
          <span>{bundle.repository.branch}</span>
          <code>{bundle.repository.headSha.slice(0, 8)}</code>
          <span>{bundle.keyframes.length} 个关键帧</span>
        </div>
      </header>

      <div className={styles.workspaceGrid}>
        <main className={styles.mapPanel}>
          <GraphCanvas
            snapshot={snapshot}
            selectedId={selectedNodeId}
            onSelect={setSelectedNodeId}
          />
        </main>
        <EvidencePanel snapshot={snapshot} selectedNode={selectedNode} />
      </div>

      <Timeline
        snapshots={bundle.keyframes}
        activeIndex={activeIndex}
        onChange={setActiveIndex}
      />
    </div>
  );
}
