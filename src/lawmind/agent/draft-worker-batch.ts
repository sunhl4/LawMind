/**
 * Same-round draft_worker contract.
 * The parent model emits the briefs; this module rejects colliding sections
 * and writes a join index (gaps, each conclusion, shared citations) before
 * the next sample. It does not decide whether two conclusions conflict.
 */

import { DRAFT_WORKER_TOOL_NAME } from "./draft-worker.js";
import { stringifyToolResultForHistory } from "./tool-result-history.js";
import type { AgentMessage } from "./types.js";

export type DraftWorkerCallRef = {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
};

const EMPTY_SECTION_ERROR =
  "并行的几支必须各自写明章节名，而且不能相同。这一支没有章节名，没有执行。";

/** Section collisions only. Short tasks stay in the prompt; the engine does not keyword-reject them. */
export function draftWorkerDispatchErrors(calls: DraftWorkerCallRef[]): Map<string, string> {
  return draftWorkerSectionErrors(calls);
}

export function draftWorkerSectionErrors(calls: DraftWorkerCallRef[]): Map<string, string> {
  const workers = calls.filter((call) => call.name === DRAFT_WORKER_TOOL_NAME);
  const errors = new Map<string, string>();
  if (workers.length < 2) {
    return errors;
  }
  const seen = new Map<string, string>();
  for (const call of workers) {
    const section = sectionOf(call.arguments);
    if (!section) {
      errors.set(call.id, EMPTY_SECTION_ERROR);
      continue;
    }
    const previous = seen.get(section);
    if (previous) {
      const error = `并行的几支章节名重复：「${section}」。请改成不同的章节名后再调用。`;
      errors.set(call.id, error);
      errors.set(previous, error);
      continue;
    }
    seen.set(section, call.id);
  }
  return errors;
}

export type DraftJoinRow = {
  section: string;
  gaps: string[];
  citations: string[];
  conclusion?: string;
};

/** Short index the parent must read before stitching sections. No extra model call. */
export function buildDraftWorkerJoinIndex(rows: DraftJoinRow[]): string | undefined {
  if (rows.length < 2) {
    return undefined;
  }
  const lines = [
    "【并行写稿对照】汇总前先核对，不要把各章原文直接拼接。各支结论列在下面，是否互相矛盾由你判断。",
  ];
  for (const row of rows) {
    const gaps = row.gaps
      .map((gap) => gap.replace(/\s+/g, " ").trim())
      .filter(Boolean)
      .slice(0, 3);
    const conclusion = row.conclusion?.replace(/\s+/g, " ").trim();
    const conclusionBit = conclusion ? `；结论 ${conclusion}` : "";
    lines.push(
      `- ${row.section}：缺口 ${gaps.length > 0 ? gaps.join("；") : "无"}${conclusionBit}`,
    );
  }
  const owners = new Map<string, string[]>();
  for (const row of rows) {
    for (const raw of row.citations) {
      const cite = raw.replace(/\s+/g, " ").trim();
      if (!cite) {
        continue;
      }
      const list = owners.get(cite) ?? [];
      list.push(row.section);
      owners.set(cite, list);
    }
  }
  const shared = [...owners.entries()].filter(([, sections]) => new Set(sections).size > 1);
  if (shared.length === 0) {
    lines.push("引用：各章出处没有重复。");
  } else {
    for (const [cite, sections] of shared.slice(0, 8)) {
      lines.push(`引用重复：${cite}（${[...new Set(sections)].join("、")}）`);
    }
  }
  return lines.join("\n");
}

type JoinCarrier = {
  toolName: string;
  toolArgs: Record<string, unknown>;
  toolResponseMsg: AgentMessage;
};

/** Mutates already-pushed tool messages so the next sample sees one join index. */
export function attachDraftWorkerJoinIndex(outcomes: JoinCarrier[]): void {
  const rows: Array<DraftJoinRow & { carrier: JoinCarrier }> = [];
  for (const carrier of outcomes) {
    if (carrier.toolName !== DRAFT_WORKER_TOOL_NAME) {
      continue;
    }
    const result = carrier.toolResponseMsg.toolCallResponses?.[0]?.result;
    if (!result?.ok) {
      continue;
    }
    const data = asRecord(result.data);
    const section = sectionOf(data) || sectionOf(carrier.toolArgs);
    if (!section) {
      continue;
    }
    rows.push({
      carrier,
      section,
      gaps: stringList(data?.gaps),
      citations: stringList(data?.citations),
      conclusion: typeof data?.conclusion === "string" ? data.conclusion : undefined,
    });
  }
  const index = buildDraftWorkerJoinIndex(rows);
  if (!index) {
    return;
  }
  for (const row of rows) {
    const response = row.carrier.toolResponseMsg.toolCallResponses?.[0];
    if (!response) {
      continue;
    }
    const data = asRecord(response.result.data);
    const next = {
      ...response.result,
      joinIndex: index,
      ...(data ? { data: { ...data, joinIndex: index } } : {}),
    };
    response.result = next;
    row.carrier.toolResponseMsg.content = stringifyToolResultForHistory(next);
  }
}

function sectionOf(record: Record<string, unknown> | undefined): string {
  const raw = record?.section;
  return typeof raw === "string" ? raw.trim() : "";
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}
