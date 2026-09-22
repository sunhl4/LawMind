/**
 * Lightweight data provenance for ArtifactDraft sections.
 *
 * Each section carries a chain of events describing how it arrived at its
 * current text: uploaded material → extraction → model suggestion → lawyer edit
 * → accepted redline → exported document. The chain is serializable JSON and is
 * surfaced to lawyers in the review UI and optionally in Word comments.
 */

export type ProvenanceEventType =
  | "upload"
  | "extraction"
  | "ai_suggest"
  | "lawyer_edit"
  | "lawyer_accept"
  | "self_revise"
  | "import"
  | "export";

export type ProvenanceActor = "user" | "model" | "system";

export type ProvenanceEvent = {
  type: ProvenanceEventType;
  actor: ProvenanceActor;
  /** ISO 8601 timestamp. */
  timestamp: string;
  /** Material id, source id, tool call id, model message id, session id, etc. */
  sourceId?: string;
  /** Lawyer / actor id when known. */
  userId?: string;
  /** Short rule id or rationale (e.g. self_revise ruleId). */
  reason?: string;
  /** Human-readable note. */
  comment?: string;
  /** One-line diff summary for lawyer edits. */
  diffSummary?: string;
};

export type ProvenanceChain = {
  events: ProvenanceEvent[];
};

export function createProvenanceEvent(
  type: ProvenanceEventType,
  actor: ProvenanceActor,
  opts?: Omit<ProvenanceEvent, "type" | "actor" | "timestamp"> & { timestamp?: string },
): ProvenanceEvent {
  return {
    type,
    actor,
    timestamp: opts?.timestamp ?? new Date().toISOString(),
    ...(opts?.sourceId !== undefined ? { sourceId: opts.sourceId } : {}),
    ...(opts?.userId !== undefined ? { userId: opts.userId } : {}),
    ...(opts?.reason !== undefined ? { reason: opts.reason } : {}),
    ...(opts?.comment !== undefined ? { comment: opts.comment } : {}),
    ...(opts?.diffSummary !== undefined ? { diffSummary: opts.diffSummary } : {}),
  };
}

export function appendProvenanceEvent(
  chain: ProvenanceChain | undefined,
  event: ProvenanceEvent,
): ProvenanceChain {
  return {
    events: [...(chain?.events ?? []), event],
  };
}

export function findLatestProvenanceEvent(
  chain: ProvenanceChain | undefined,
  type?: ProvenanceEventType,
): ProvenanceEvent | undefined {
  if (!chain?.events.length) {
    return undefined;
  }
  const events = chain.events;
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i];
    if (!type || ev.type === type) {
      return ev;
    }
  }
  return undefined;
}

export function findProvenanceBySource(
  chain: ProvenanceChain | undefined,
  sourceId: string,
): ProvenanceEvent[] {
  if (!chain?.events.length) {
    return [];
  }
  return chain.events.filter((ev) => ev.sourceId === sourceId);
}

export function isUserModifiedProvenance(chain: ProvenanceChain | undefined): boolean {
  if (!chain?.events.length) {
    return false;
  }
  return chain.events.some(
    (ev) =>
      ev.actor === "user" ||
      ev.type === "lawyer_edit" ||
      ev.type === "lawyer_accept" ||
      ev.type === "import",
  );
}

export function isAiGeneratedProvenance(chain: ProvenanceChain | undefined): boolean {
  if (!chain?.events.length) {
    return false;
  }
  return chain.events.some((ev) => ev.actor === "model" || ev.type === "ai_suggest");
}

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

export function actorLabel(ev: ProvenanceEvent): string {
  if (ev.type === "lawyer_edit" || ev.type === "lawyer_accept") {
    return "律师";
  }
  if (ev.type === "upload" || ev.type === "import") {
    return "材料来源";
  }
  if (ev.type === "ai_suggest") {
    return "AI 建议";
  }
  if (ev.type === "self_revise") {
    return "自检修订";
  }
  if (ev.type === "export") {
    return "导出";
  }
  if (ev.actor === "model") {
    return "AI 建议";
  }
  if (ev.actor === "user") {
    return "律师";
  }
  return "系统";
}

function summarizeDiff(diffSummary?: string): string {
  if (!diffSummary?.trim()) {
    return "";
  }
  const s = diffSummary.trim();
  return s.length > 40 ? `${s.slice(0, 40)}…` : s;
}

/**
 * Render a provenance chain as a lawyer-friendly Chinese sentence.
 * Never exposes raw sourceId / model ids; only role and time.
 */
export function renderProvenanceAsFootnote(chain: ProvenanceChain | undefined): string {
  if (!chain?.events.length) {
    return "来源未记录。";
  }
  const events = chain.events;
  const first = events[0];
  const parts: string[] = [];

  const sourceName = first.comment?.trim() || first.sourceId?.trim();
  if (first.type === "upload" || first.type === "import") {
    const label = first.type === "import" ? "来自模板" : "材料来源";
    if (isAiGeneratedProvenance(chain)) {
      parts.push(
        sourceName
          ? `本段由 AI 建议生成（${label}：${sourceName}）`
          : `本段由 AI 建议生成（${label}已登记）`,
      );
    } else {
      parts.push(sourceName ? `${label}：${sourceName}` : `${label}已登记`);
    }
  } else if (isAiGeneratedProvenance(chain)) {
    parts.push("本段由 AI 建议生成");
  } else {
    parts.push("本段来源未明确标记");
  }

  const lawyerEdit = findLatestProvenanceEvent(chain, "lawyer_edit");
  const lawyerAccept = findLatestProvenanceEvent(chain, "lawyer_accept");
  if (lawyerEdit) {
    const diff = summarizeDiff(lawyerEdit.diffSummary);
    parts.push(`律师于 ${formatTimestamp(lawyerEdit.timestamp)} 编辑${diff ? `（${diff}）` : ""}`);
  } else if (lawyerAccept) {
    parts.push(`律师于 ${formatTimestamp(lawyerAccept.timestamp)} 接受红线/批注`);
  }

  const selfRevise = findLatestProvenanceEvent(chain, "self_revise");
  if (selfRevise) {
    parts.push(`自检修订：${selfRevise.reason ?? "格式或机械修正"}`);
  }

  if (!isUserModifiedProvenance(chain) && isAiGeneratedProvenance(chain)) {
    parts.push("未再改动");
  }

  return parts.join("；") + "。";
}

export function diffSummary(before: string, after: string): string {
  if (before === after) {
    return "无变化";
  }
  const max = 80;
  const prefix = before.slice(0, max);
  const suffix = after.slice(0, max);
  if (prefix === suffix) {
    return "字符级微调";
  }
  const summary = `由「${prefix}」改为「${suffix}」`;
  return summary.length > max ? `${summary.slice(0, max)}…` : summary;
}
