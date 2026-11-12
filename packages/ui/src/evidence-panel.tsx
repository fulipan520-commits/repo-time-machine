import type { ModuleNode, Snapshot } from "@rtm/contracts";
import styles from "./workspace.module.css";

interface EvidencePanelProps {
  snapshot: Snapshot;
  selectedNode?: ModuleNode | undefined;
}

export function EvidencePanel({
  snapshot,
  selectedNode,
}: EvidencePanelProps) {
  return (
    <aside className={styles.evidence}>
      <div className={styles.evidenceHeading}>
        <span className={styles.eyebrow}>Evidence ledger</span>
        <h2>提交证据</h2>
      </div>

      {selectedNode ? (
        <div className={styles.nodeDossier}>
          <span className={styles.statusTag} data-status={selectedNode.status}>
            {selectedNode.status}
          </span>
          <h3>{selectedNode.label}</h3>
          <code>{selectedNode.path}</code>
          <dl>
            <div>
              <dt>文件</dt>
              <dd>{selectedNode.fileCount}</dd>
            </div>
            <div>
              <dt>有效行</dt>
              <dd>{selectedNode.loc.toLocaleString("zh-CN")}</dd>
            </div>
            <div>
              <dt>依赖</dt>
              <dd>
                {selectedNode.incoming} in / {selectedNode.outgoing} out
              </dd>
            </div>
          </dl>
        </div>
      ) : (
        <p className={styles.muted}>选择一个模块，查看它在时间切片中的位置。</p>
      )}

      <div className={styles.events}>
        <h3>本次结构变化</h3>
        {snapshot.events.length === 0 ? (
          <p className={styles.muted}>这个切片没有结构性事件。</p>
        ) : (
          snapshot.events.map((event) => (
            <article className={styles.eventCard} key={event.id}>
              <div className={styles.eventTopline}>
                <span>{event.type.replaceAll("-", " ")}</span>
                {event.inferred ? <em>推断</em> : null}
              </div>
              <h4>{event.evidence.title}</h4>
              <p>{event.modules.join(" · ")}</p>
              <div className={styles.commitLine}>
                <code>{event.evidence.commitSha.slice(0, 8)}</code>
                <span>{event.evidence.author}</span>
              </div>
              <ul>
                {event.evidence.paths.slice(0, 4).map((filePath) => (
                  <li key={filePath}>
                    <code>{filePath}</code>
                  </li>
                ))}
              </ul>
            </article>
          ))
        )}
      </div>
    </aside>
  );
}
