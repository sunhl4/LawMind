import { useState } from "react";

type ProvenanceEvent = {
  type: string;
  actor: string;
  timestamp: string;
  sourceId?: string;
  userId?: string;
  reason?: string;
  comment?: string;
  diffSummary?: string;
};

type ProvenanceChain = {
  events: ProvenanceEvent[];
};

function formatTimestamp(ts: string): string {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) {
    return ts;
  }
  return d.toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function isAiGenerated(events: ProvenanceEvent[]): boolean {
  return events.some((ev) => ev.actor === "model" || ev.type === "ai_suggest");
}

function isUserModified(events: ProvenanceEvent[]): boolean {
  return events.some(
    (ev) =>
      ev.actor === "user" ||
      ev.type === "lawyer_edit" ||
      ev.type === "lawyer_accept" ||
      ev.type === "import",
  );
}

function latestEvent(
  events: ProvenanceEvent[],
  type: ProvenanceEvent["type"],
): ProvenanceEvent | undefined {
  return [...events].toReversed().find((ev) => ev.type === type);
}

/**
 * Render a provenance chain as a lawyer-friendly Chinese sentence.
 * Mirrors the server-side helper in `src/lawmind/drafts/provenance.ts` so the
 * UI can stay in plain client code without importing engine runtime.
 */
function renderProvenanceSummary(provenance: ProvenanceChain): string {
  const events = provenance.events;
  if (events.length === 0) {
    return "来源未记录。";
  }
  const first = events[0];
  const sourceName = first.comment?.trim() || first.sourceId?.trim();
  const parts: string[] = [];
  const ai = isAiGenerated(events);

  if (first.type === "upload" || first.type === "import") {
    const label = first.type === "import" ? "来自模板" : "材料来源";
    if (ai) {
      parts.push(
        sourceName
          ? `本段由 AI 建议生成（${label}：${sourceName}）`
          : `本段由 AI 建议生成（${label}已登记）`,
      );
    } else {
      parts.push(sourceName ? `${label}：${sourceName}` : `${label}已登记`);
    }
  } else if (ai) {
    parts.push("本段由 AI 建议生成");
  } else {
    parts.push("本段来源未明确标记");
  }

  const lawyerEdit = latestEvent(events, "lawyer_edit");
  const lawyerAccept = latestEvent(events, "lawyer_accept");
  if (lawyerEdit) {
    const diff = lawyerEdit.diffSummary?.trim() || lawyerEdit.comment?.trim();
    parts.push(
      `律师于 ${formatTimestamp(lawyerEdit.timestamp)} 编辑${diff ? `（${diff}）` : ""}`,
    );
  } else if (lawyerAccept) {
    const diff = lawyerAccept.diffSummary?.trim() || lawyerAccept.comment?.trim();
    parts.push(
      `律师于 ${formatTimestamp(lawyerAccept.timestamp)} 接受红线/批注${diff ? `（${diff}）` : ""}`,
    );
  }

  const selfRevise = latestEvent(events, "self_revise");
  if (selfRevise) {
    parts.push(`自检修订：${selfRevise.reason ?? "格式或机械修正"}`);
  }

  if (!isUserModified(events) && ai) {
    parts.push("未再改动");
  }

  return parts.join("；") + "。";
}

type Props = {
  provenance?: ProvenanceChain;
  /** Accessible label for the section heading. */
  headingLabel?: string;
};

export function LawmindProvenanceIndicator(props: Props) {
  const { provenance, headingLabel } = props;
  const [open, setOpen] = useState(false);
  if (!provenance?.events.length) {
    return null;
  }
  const summary = renderProvenanceSummary(provenance);
  const title = headingLabel ? `${headingLabel}：来源` : "来源";
  return (
    <div className="lm-provenance-indicator">
      <button
        type="button"
        className="lm-provenance-trigger"
        onClick={() => setOpen((v) => !v)}
        title={title}
        aria-expanded={open}
        aria-label={title}
      >
        来源
      </button>
      {open ? (
        <div className="lm-provenance-card" role="tooltip">
          <p className="lm-provenance-card-body">{summary}</p>
        </div>
      ) : null}
    </div>
  );
}
