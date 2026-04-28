/**
 * Keyword-based instruction router (sync, deterministic fallback).
 */

import { randomUUID } from "node:crypto";
import type { TaskIntent, TaskKind, RiskLevel } from "../types.js";
import { enrichIntentWithDeliverableMeta } from "./deliverable-meta.js";

const TASK_KIND_PATTERNS: Array<{ pattern: RegExp; kind: TaskKind }> = [
  {
    pattern:
      /(起草|拟定|拟写|撰写|生成|制作|输出).*(合同|协议|补充协议|保密协议|授权书|条款)|(合同|协议).*(起草|拟定|拟写|撰写|生成|制作|输出)/i,
    kind: "draft.word",
  },
  {
    pattern: /合同审查|审查.*(合同|协议|条款)|审阅.*(合同|协议|条款)|条款审查|review/i,
    kind: "analyze.contract",
  },
  { pattern: /合同|协议|条款/i, kind: "analyze.contract" },
  { pattern: /法律意见|法规|法条|类案|裁判|司法解释/i, kind: "research.legal" },
  { pattern: /律师函|催款|通知函|警告信|demand/i, kind: "draft.word" },
  { pattern: /摘要|案情|案件概述|summarize/i, kind: "summarize.case" },
  { pattern: /汇报|PPT|幻灯片|演示|slides/i, kind: "draft.ppt" },
  { pattern: /检索|调研|整理|背景|研究/i, kind: "research.hybrid" },
  { pattern: /文件|文书|报告|word|docx/i, kind: "draft.word" },
];

const HIGH_RISK_KINDS = new Set<TaskKind>(["draft.word", "draft.ppt"]);
const MEDIUM_RISK_KINDS = new Set<TaskKind>([
  "analyze.contract",
  "research.legal",
  "summarize.case",
]);

function inferRiskLevel(kind: TaskKind): RiskLevel {
  if (HIGH_RISK_KINDS.has(kind)) {
    return "high";
  }
  if (MEDIUM_RISK_KINDS.has(kind)) {
    return "medium";
  }
  return "low";
}

type ModelRole = "general" | "legal";

function inferModels(kind: TaskKind): ModelRole[] {
  if (kind === "research.general") {
    return ["general"];
  }
  if (kind === "research.legal") {
    return ["legal"];
  }
  if (kind === "draft.ppt") {
    return ["general"];
  }
  return ["general", "legal"];
}

export type RouteInput = {
  instruction: string;
  matterId?: string;
  templateId?: string;
  audience?: string;
};

export function route(input: RouteInput): TaskIntent {
  const { instruction, matterId, templateId, audience } = input;

  const matched = TASK_KIND_PATTERNS.find((p) => p.pattern.test(instruction));
  const kind: TaskKind = matched?.kind ?? "unknown";
  const riskLevel = inferRiskLevel(kind);
  const models = inferModels(kind);

  const output =
    kind === "draft.ppt"
      ? "pptx"
      : kind.startsWith("draft") || kind === "analyze.contract" || kind === "summarize.case"
        ? "docx"
        : "markdown";

  const requiresConfirmation = riskLevel === "high" || kind === "unknown";

  const summary = buildSummary({ kind, instruction, output });

  return enrichIntentWithDeliverableMeta({
    taskId: randomUUID(),
    kind,
    output,
    instruction,
    summary,
    audience,
    matterId,
    templateId,
    riskLevel,
    models,
    requiresConfirmation,
    createdAt: new Date().toISOString(),
  });
}

function buildSummary(params: {
  kind: TaskKind;
  instruction: string;
  output: TaskIntent["output"];
}): string {
  const { kind, instruction, output } = params;
  const outputLabel =
    output === "docx" ? "Word 文书" : output === "pptx" ? "PPT 汇报" : "Markdown 草稿";
  const kindLabel: Record<TaskKind, string> = {
    "research.general": "通用检索整理",
    "research.legal": "法律专项检索",
    "research.hybrid": "联合检索整理",
    "draft.word": "生成" + outputLabel,
    "draft.ppt": "生成" + outputLabel,
    "summarize.case": "案件摘要",
    "analyze.contract": "合同审查",
    "agent.instruction": "对话指令",
    unknown: "任务类型未识别，需人工确认",
  };

  return `任务类型：${kindLabel[kind]}。原始指令：「${instruction.slice(0, 60)}${instruction.length > 60 ? "…" : ""}」`;
}
