"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ModuleNode, Snapshot } from "@rtm/contracts";
import Graph from "graphology";
import styles from "./workspace.module.css";

interface GraphCanvasProps {
  snapshot: Snapshot;
  selectedId?: string | undefined;
  onSelect: (id: string) => void;
}

const colors: Record<ModuleNode["status"], string> = {
  added: "#2d8b72",
  removed: "#b7563d",
  unchanged: "#295d58",
  growing: "#d39b34",
  shrinking: "#637b91",
};

export function highlightedNodeIds(
  snapshot: Snapshot,
  selectedId?: string,
): Set<string> {
  const highlighted = new Set<string>();
  if (!selectedId) {
    snapshot.nodes.forEach((node) => highlighted.add(node.id));
    return highlighted;
  }

  highlighted.add(selectedId);
  for (const edge of snapshot.edges) {
    if (edge.source === selectedId) {
      highlighted.add(edge.target);
    }
    if (edge.target === selectedId) {
      highlighted.add(edge.source);
    }
  }
  return highlighted;
}

function positionsFor(snapshot: Snapshot): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>();
  const count = Math.max(1, snapshot.nodes.length);
  for (const [index, node] of snapshot.nodes.entries()) {
    const angle = (index / count) * Math.PI * 2 - Math.PI / 2;
    const wave = 0.72 + ((index * 37) % 11) / 28;
    positions.set(node.id, {
      x: Math.cos(angle) * wave,
      y: Math.sin(angle) * wave * 0.68,
    });
  }
  return positions;
}

export function GraphCanvas({
  snapshot,
  selectedId,
  onSelect,
}: GraphCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<Graph | null>(null);
  const rendererRef = useRef<{
    kill: () => void;
    refresh: () => void;
  } | null>(null);
  const [webglReady, setWebglReady] = useState(false);
  const positions = useMemo(() => positionsFor(snapshot), [snapshot]);
  const nodeById = useMemo(
    () => new Map(snapshot.nodes.map((node) => [node.id, node])),
    [snapshot.nodes],
  );
  const selected = selectedId ? nodeById.get(selectedId) : undefined;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return undefined;
    }
    container.replaceChildren();
    let renderer:
      | {
          kill: () => void;
          refresh: () => void;
        }
      | undefined;
    let cancelled = false;

    void import("sigma")
      .then(({ default: Sigma }) => {
        if (cancelled) {
          return;
        }
        const graph = new Graph({ multi: false, type: "directed" });
        for (const node of snapshot.nodes) {
          const position = positions.get(node.id) ?? { x: 0, y: 0 };
          graph.addNode(node.id, {
            x: position.x,
            y: position.y,
            size: Math.max(5, Math.min(22, Math.sqrt(node.loc) / 3.4)),
            label: node.label,
            color: colors[node.status],
          });
        }
        for (const edge of snapshot.edges) {
          if (graph.hasNode(edge.source) && graph.hasNode(edge.target)) {
            graph.addEdge(edge.source, edge.target, {
              size: Math.max(0.7, Math.min(3, edge.weight / 2)),
              color: "rgba(28, 57, 52, 0.26)",
              type: "arrow",
            });
          }
        }
        const sigma = new Sigma(graph, container, {
          renderEdgeLabels: false,
          labelRenderedSizeThreshold: 7,
          defaultEdgeType: "arrow",
        });
        sigma.on("clickNode", ({ node }) => onSelect(node));
        renderer = sigma;
        graphRef.current = graph;
        rendererRef.current = sigma;
        setWebglReady(true);
      })
      .catch(() => {
        setWebglReady(false);
      });

    return () => {
      cancelled = true;
      renderer?.kill();
      graphRef.current = null;
      rendererRef.current = null;
      container.replaceChildren();
    };
  }, [onSelect, positions, snapshot.edges, snapshot.nodes]);

  useEffect(() => {
    const graph = graphRef.current;
    const renderer = rendererRef.current;
    if (!graph || !renderer) {
      return;
    }

    const highlighted = highlightedNodeIds(snapshot, selectedId);
    for (const node of snapshot.nodes) {
      if (!graph.hasNode(node.id)) {
        continue;
      }
      const active = highlighted.has(node.id);
      graph.setNodeAttribute(
        node.id,
        "color",
        selectedId && !active ? "#aeb9b3" : colors[node.status],
      );
      graph.setNodeAttribute(
        node.id,
        "size",
        Math.max(5, Math.min(22, Math.sqrt(node.loc) / 3.4)) *
          (node.id === selectedId ? 1.3 : 1),
      );
    }
    graph.forEachEdge((edge, _attributes, source, target) => {
      graph.setEdgeAttribute(
        edge,
        "color",
        !selectedId || (highlighted.has(source) && highlighted.has(target))
          ? "rgba(28, 57, 52, 0.26)"
          : "rgba(28, 57, 52, 0.08)",
      );
    });
    renderer.refresh();
  }, [selectedId, snapshot]);

  return (
    <div className={styles.graphFrame}>
      <div className={styles.graphLegend}>
        <span data-tone="added">新增</span>
        <span data-tone="growing">扩张</span>
        <span data-tone="unchanged">稳定</span>
        <span data-tone="removed">移除</span>
      </div>

      <div
        ref={containerRef}
        className={styles.sigmaCanvas}
        data-ready={webglReady}
        aria-hidden={webglReady}
      />

      {!webglReady ? (
        <svg
          className={styles.graphSvg}
          viewBox="-1.2 -0.95 2.4 1.9"
          role="img"
          aria-label="模块依赖图"
        >
          {snapshot.edges.map((edge) => {
            const source = positions.get(edge.source);
            const target = positions.get(edge.target);
            if (!source || !target) {
              return null;
            }
            return (
              <line
                key={`${edge.source}-${edge.target}`}
                x1={source.x}
                y1={source.y}
                x2={target.x}
                y2={target.y}
                className={styles.graphEdge}
                data-status={edge.status}
                strokeWidth={Math.min(0.014, 0.004 + edge.weight * 0.002)}
              />
            );
          })}
          {snapshot.nodes.map((node) => {
            const position = positions.get(node.id);
            if (!position) {
              return null;
            }
            const radius = Math.max(0.035, Math.min(0.095, Math.sqrt(node.loc) / 470));
            return (
              <g
                key={node.id}
                role="button"
                tabIndex={0}
                aria-label={`选择模块 ${node.path}`}
                onClick={() => onSelect(node.id)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    onSelect(node.id);
                  }
                }}
                className={styles.graphNode}
                data-selected={selectedId === node.id}
              >
                <circle
                  cx={position.x}
                  cy={position.y}
                  r={radius}
                  fill={colors[node.status]}
                />
                <text
                  x={position.x}
                  y={position.y + radius + 0.055}
                  textAnchor="middle"
                >
                  {node.label}
                </text>
              </g>
            );
          })}
        </svg>
      ) : null}

      <div className={styles.moduleRail} aria-label="模块索引">
        {snapshot.nodes.map((node) => (
          <button
            type="button"
            key={node.id}
            onClick={() => onSelect(node.id)}
            data-active={selectedId === node.id}
          >
            <span style={{ background: colors[node.status] }} />
            {node.path}
          </button>
        ))}
      </div>

      <div className={styles.graphCaption}>
        <span>{snapshot.nodes.length} 个模块</span>
        <span>{snapshot.edges.length} 条依赖</span>
        {selected ? <strong>{selected.path}</strong> : null}
      </div>
    </div>
  );
}
