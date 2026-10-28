/**
 * 案件成果物面板：时间线 / 大事记 / 思维导图。
 *
 * 数据只读自 `GET /api/matters/:id/artifacts`（真相源是案件根目录 JSON）。
 * 样式只复用客户端既有基元：`lm-lawyer-pane`、`lm-timeline*`、`lm-meta`、
 * `lm-scroll`；思维导图新增的几条规则也只用 token（见 styles/matter-review-workbench.css）。
 */

import { useEffect, useState, type ReactNode } from "react";
import { apiGetJson } from "./api-client";
import {
  groupTimelineByYear,
  layoutMatterMindmap,
  matterArtifactEmptyDescription,
  matterArtifactLabel,
  summarizeMatterArtifact,
  type MatterArtifact,
  type MatterArtifactEvidence,
  type MatterArtifactIssue,
  type MatterArtifactKind,
  type MatterChronologyArtifact,
  type MatterMindmapArtifact,
  type MatterTimelineArtifact,
} from "../../../../src/lawmind/deliverables/matter-artifact-model.ts";

type ArtifactResult =
  | { status: "missing" }
  | { status: "ok"; artifact: MatterArtifact; issues: MatterArtifactIssue[] }
  | { status: "invalid"; issues: MatterArtifactIssue[] };

type ArtifactsResponse = {
  ok: boolean;
  artifacts?: Record<string, ArtifactResult>;
  error?: string;
};

const ORDER: MatterArtifactKind[] = ["case-timeline", "case-chronology", "case-mindmap"];

function evidenceLine(item: MatterArtifactEvidence): string {
  const ref = item.lineRef ? `${item.filePath} · ${item.lineRef}` : item.filePath;
  return item.quote ? `${ref} · 「${item.quote}」` : ref;
}

function EvidenceList({
  evidence,
  onOpenEvidence,
}: {
  evidence: MatterArtifactEvidence[];
  onOpenEvidence?: (filePath: string, lineRef?: string) => void;
}): ReactNode {
  if (evidence.length === 0) {
    return <span className="lm-meta">未附出处，需补锚</span>;
  }
  return (
    <span className="lm-matter-artifact-evidence">
      {evidence.map((item, i) => {
        const text = evidenceLine(item);
        const key = `${item.filePath}-${i}`;
        return onOpenEvidence ? (
          <button
            type="button"
            className="lm-matter-artifact-evidence-chip is-link"
            key={key}
            title={`打开 ${item.filePath}`}
            onClick={() => onOpenEvidence(item.filePath, item.lineRef)}
          >
            {text}
          </button>
        ) : (
          <span className="lm-matter-artifact-evidence-chip" key={key}>
            {text}
          </span>
        );
      })}
    </span>
  );
}

function TimelineBody({
  artifact,
  onOpenEvidence,
}: {
  artifact: MatterTimelineArtifact | MatterChronologyArtifact;
  onOpenEvidence?: (filePath: string, lineRef?: string) => void;
}): ReactNode {
  const groups = groupTimelineByYear(artifact);
  if (groups.length === 0) {
    return <p className="lm-meta">{matterArtifactEmptyDescription(artifact.kind)}</p>;
  }
  return (
    <div className="lm-timeline lm-matter-timeline lm-scroll">
      {groups.map((group) => (
        <div key={group.year} className="lm-matter-artifact-year">
          <p className="lm-meta lm-matter-artifact-year-label">{group.year}</p>
          {group.items.map((item) => (
            <div className="lm-timeline-row" key={item.id} data-testid="lm-matter-artifact-row">
              <span className="lm-timeline-time">{item.shortDate || "—"}</span>
              <span className="lm-timeline-copy">
                <span className="lm-desk-card-title">{item.title}</span>
                {item.summary ? <span className="lm-meta">{item.summary}</span> : null}
                <EvidenceList evidence={item.evidence} onOpenEvidence={onOpenEvidence} />
              </span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function MindmapBody({ artifact }: { artifact: MatterMindmapArtifact }): ReactNode {
  const layout = layoutMatterMindmap(artifact.root);
  if (layout.nodes.length <= 1) {
    return <p className="lm-meta">{matterArtifactEmptyDescription(artifact.kind)}</p>;
  }
  const byId = new Map(layout.nodes.map((n) => [n.id, n]));
  const pad = 8;
  return (
    <>
      <div className="lm-matter-mindmap-scroll lm-scroll">
        <svg
          className="lm-matter-mindmap"
          role="img"
          aria-label={`思维导图：${artifact.root.label}，共 ${layout.nodes.length} 个节点`}
          viewBox={`0 0 ${layout.width + pad * 2} ${layout.height + pad * 2}`}
          width={layout.width + pad * 2}
          height={layout.height + pad * 2}
        >
          <title>{artifact.root.label}</title>
          <g transform={`translate(${pad}, ${pad})`}>
            {layout.edges.map((edge) => {
              const from = byId.get(edge.from);
              const to = byId.get(edge.to);
              if (!from || !to) {
                return null;
              }
              const x1 = from.x + from.width;
              const y1 = from.y + from.height / 2;
              const x2 = to.x;
              const y2 = to.y + to.height / 2;
              const mid = (x1 + x2) / 2;
              return (
                <path
                  key={`${edge.from}->${edge.to}`}
                  className="lm-matter-mindmap-edge"
                  d={`M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`}
                />
              );
            })}
            {layout.nodes.map((node) => (
              <g
                key={node.id}
                className={`lm-matter-mindmap-node${node.kind ? ` is-${node.kind}` : ""}`}
                data-testid="lm-matter-mindmap-node"
              >
                <rect
                  x={node.x}
                  y={node.y}
                  width={node.width}
                  height={node.height}
                  rx="6"
                  ry="6"
                />
                <text x={node.x + node.width / 2} y={node.y + node.height / 2} textAnchor="middle">
                  {truncateLabel(node.label, node.width)}
                </text>
              </g>
            ))}
          </g>
        </svg>
      </div>
      <details className="lm-matter-artifact-outline">
        <summary className="lm-meta">文本大纲</summary>
        <ul className="lm-matter-artifact-outline-list">
          {layout.nodes.map((node) => (
            <li key={node.id} style={{ paddingLeft: `${node.depth * 14}px` }}>
              {node.label}
            </li>
          ))}
        </ul>
      </details>
    </>
  );
}

/** 与布局同一套宽度估算，保证文字不溢出节点。 */
function truncateLabel(label: string, width: number): string {
  const budget = width - 16;
  let out = "";
  let used = 0;
  for (const ch of label) {
    const unit = /[\u3000-\u9fff\uff00-\uffef]/.test(ch) ? 12.4 : 6.2;
    if (used + unit > budget && out.length > 0) {
      return `${out}…`;
    }
    used += unit;
    out += ch;
  }
  return out;
}

function ArtifactSection({
  kind,
  result,
  onOpenEvidence,
}: {
  kind: MatterArtifactKind;
  result: ArtifactResult;
  onOpenEvidence?: (filePath: string, lineRef?: string) => void;
}): ReactNode {
  const label = matterArtifactLabel(kind);
  if (result.status === "missing") {
    return (
      <details className="lm-matter-artifact-section" data-testid={`lm-matter-artifact-${kind}`}>
        <summary className="lm-matter-artifact-summary">
          <strong>{label}</strong>
          <span className="lm-meta">未创建</span>
        </summary>
        <p className="lm-meta">{matterArtifactEmptyDescription(kind)}</p>
      </details>
    );
  }
  if (result.status === "invalid") {
    return (
      <details className="lm-matter-artifact-section" data-testid={`lm-matter-artifact-${kind}`}>
        <summary className="lm-matter-artifact-summary">
          <strong>{label}</strong>
          <span className="lm-meta lm-danger-text">文件损坏</span>
        </summary>
        <ul className="lm-matter-artifact-issues">
          {result.issues.map((issue) => (
            <li key={`${issue.path}-${issue.reasonZh}`}>{`${issue.path}：${issue.reasonZh}`}</li>
          ))}
        </ul>
      </details>
    );
  }
  const summary = summarizeMatterArtifact(result.artifact);
  const unanchored = summary.unanchoredCount;
  return (
    <details
      className="lm-matter-artifact-section"
      data-testid={`lm-matter-artifact-${kind}`}
      open={summary.itemCount > 0}
    >
      <summary className="lm-matter-artifact-summary">
        <strong>{label}</strong>
        <span className="lm-meta">
          {`${summary.itemCount} 项`}
          {summary.yearFrom ? ` · ${summary.yearFrom}–${summary.yearTo}` : ""}
          {unanchored > 0 ? ` · ${unanchored} 项待补出处` : ""}
        </span>
      </summary>
      {unanchored > 0 ? (
        <p className="lm-meta">
          没有出处的条目不会被当作已核实；请补齐材料路径与行/页锚。
        </p>
      ) : null}
      {result.artifact.kind === "case-mindmap" ? (
        <MindmapBody artifact={result.artifact} />
      ) : (
        <TimelineBody artifact={result.artifact} onOpenEvidence={onOpenEvidence} />
      )}
      {result.issues.length > 0 ? (
        <details className="lm-matter-artifact-issues-wrap">
          <summary className="lm-meta">{`${result.issues.length} 处数据问题`}</summary>
          <ul className="lm-matter-artifact-issues">
            {result.issues.map((issue) => (
              <li key={`${issue.path}-${issue.reasonZh}`}>{`${issue.path}：${issue.reasonZh}`}</li>
            ))}
          </ul>
        </details>
      ) : null}
    </details>
  );
}

export function LawmindMatterArtifactPanel({
  apiBase,
  matterId,
  onOpenEvidence,
}: {
  apiBase: string;
  matterId: string;
  /** 点证据 chip 打开材料（行锚可定位时带 line）。 */
  onOpenEvidence?: (filePath: string, lineRef?: string) => void;
}): ReactNode {
  const [results, setResults] = useState<Record<string, ArtifactResult> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const mid = matterId.trim();
    if (!mid) {
      setResults(null);
      setError(null);
      return () => {};
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    apiGetJson<ArtifactsResponse>(apiBase, `/api/matters/${encodeURIComponent(mid)}/artifacts`)
      .then((j) => {
        if (cancelled) {
          return;
        }
        if (!j.ok || !j.artifacts) {
          setError(j.error || "案件成果读取失败");
          setResults(null);
          return;
        }
        setResults(j.artifacts);
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
          setResults(null);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [apiBase, matterId]);

  return (
    <section
      className="lm-lawyer-pane lm-matter-artifact-panel"
      aria-label="案件成果"
      aria-busy={loading}
      data-testid="lm-matter-artifacts"
    >
      <h3>案件成果</h3>
      <p className="lm-meta">
        时间线、大事记与思维导图存成案件根目录的结构化文件；只按材料整理，不编造内容。
      </p>
      {loading && !results ? <p className="lm-meta">正在读取案件成果…</p> : null}
      {error ? <p className="lm-meta lm-danger-text">{`读取失败：${error}`}</p> : null}
      {results
        ? ORDER.map((kind) => (
            <ArtifactSection
              key={kind}
              kind={kind}
              result={results[kind] ?? { status: "missing" }}
              onOpenEvidence={onOpenEvidence}
            />
          ))
        : null}
    </section>
  );
}
