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
    pattern:
      /修改合同|合同改稿|改稿本合同|修改这份(?:合同|协议)|审阅痕迹|红线稿|出修订|在原(?:合同|文件|Word)/i,
    kind: "draft.word",
  },
  {
    pattern: /合同审查|审查.*(合同|协议|条款)|审阅.*(合同|协议|条款)|条款审查|review/i,
    kind: "analyze.contract",
  },
  {
    pattern: /催告函|催款函|违约通知|demand letter|(催告|催款).{0,8}(函|律师)/i,
    kind: "draft.word",
  },
  {
    pattern:
      /(写|起草|拟定|拟写|撰写|生成|制作|输出|整理|列|出具).{0,20}(法律意见书|法律意见|答辩状|代理词|辩护词|回函|答复函|回复函|会议纪要|会议记录|证据目录|证据清单|时间线|大事记|备忘录|保密协议|NDA)|(答辩状|代理词|辩护词|法律意见书|会议纪要|证据目录|证据清单)/i,
    kind: "draft.word",
  },
  {
    pattern: /(?!.*(?:催告函|催款函|demand letter|催告))(?:合同|协议|条款)/i,
    kind: "analyze.contract",
  },
  { pattern: /法律意见|法规|法条|类案|裁判|司法解释/i, kind: "research.legal" },
  { pattern: /律师函|催告函|催款|通知函|警告信|demand|回函|答复函/i, kind: "draft.word" },
  {
    pattern:
      /(起诉状|答辩状|代理词|辩护词|诉讼大纲|诉讼提纲|诉请大纲|立案材料)|(写|起草|撰写|生成).{0,12}(起诉|诉讼).{0,8}(大纲|提纲|要点)/i,
    kind: "draft.word",
  },
  { pattern: /摘要|案情|案件概述|summarize/i, kind: "summarize.case" },
  { pattern: /汇报|PPT|幻灯片|演示|slides|培训课件|CLE培训/i, kind: "draft.ppt" },
  // Deliverable-shaped research memos (before generic 检索/调研 → research.hybrid)
  {
    pattern:
      /(合规卷宗|调研简报|学习简报|合规备忘录)|(做|写|起草|撰写|生成|制作|输出).{0,24}(合规卷宗|调研简报|学习简报|合规备忘录)/i,
    kind: "draft.word",
  },
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
  /** When set (e.g. execute_workflow.deliverable_type), enrich must not re-guess. */
  deliverableType?: TaskIntent["deliverableType"];
  /** Desktop `models.json` root; enables model route when env router creds are absent. */
  lawMindRoot?: string;
};

export function route(input: RouteInput): TaskIntent {
  const { instruction, matterId, templateId, audience, deliverableType } = input;

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
    deliverableType,
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
