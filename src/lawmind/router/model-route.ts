/**
 * Model-driven instruction routing (optional, env-gated).
 */

import { randomUUID } from "node:crypto";
import {
  completeJsonObject,
  routerLlmConfigFromEnv,
  type OpenAiJsonClientConfig,
} from "../llm/openai-json.js";
import type { RiskLevel, TaskIntent, TaskKind } from "../types.js";
import { enrichIntentWithDeliverableMeta } from "./deliverable-meta.js";
import type { RouteInput } from "./keyword-route.js";
import { route } from "./keyword-route.js";

const TASK_KINDS: TaskKind[] = [
  "research.general",
  "research.legal",
  "research.hybrid",
  "draft.word",
  "draft.ppt",
  "summarize.case",
  "analyze.contract",
  "unknown",
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

type RouterModelJson = {
  kind?: string;
  summary?: string;
  riskLevel?: RiskLevel;
  models?: ModelRole[];
  requiresConfirmation?: boolean;
  output?: TaskIntent["output"];
};

function isTaskKind(value: unknown): value is TaskKind {
  return typeof value === "string" && (TASK_KINDS as string[]).includes(value);
}

function normalizeOutput(kind: TaskKind, output: unknown): TaskIntent["output"] {
  if (output === "markdown" || output === "docx" || output === "pptx" || output === "none") {
    return output;
  }
  if (kind === "draft.ppt") {
    return "pptx";
  }
  if (kind === "agent.instruction") {
    return "none";
  }
  if (kind.startsWith("draft") || kind === "analyze.contract" || kind === "summarize.case") {
    return "docx";
  }
  return "markdown";
}

function buildSummaryFallback(params: {
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

/** LAWMIND_ROUTER_MODE=model 且具备 LLM 凭据时启用 */
export function isModelRouterEnabled(): boolean {
  const mode = (process.env.LAWMIND_ROUTER_MODE ?? "").trim().toLowerCase();
  if (mode !== "model") {
    return false;
  }
  return routerLlmConfigFromEnv() !== null;
}

export async function routeWithModel(
  input: RouteInput,
  cfg: OpenAiJsonClientConfig,
): Promise<TaskIntent | null> {
  const schema = [
    "你是法律工作流程路由器，只做分类与风险评估，不输出法律结论。",
    "只输出 JSON，不要 markdown。",
    "JSON schema:",
    '{ "kind": "research.general"|"research.legal"|"research.hybrid"|"draft.word"|"draft.ppt"|"summarize.case"|"analyze.contract"|"unknown",',
    '  "summary": "给律师看的一句任务说明（中文）",',
    '  "riskLevel": "low"|"medium"|"high",',
    '  "models": ["general"] 或 ["legal"] 或 ["general","legal"],',
    '  "requiresConfirmation": boolean,',
    '  "output": "markdown"|"docx"|"pptx"|"none"',
    "}",
  ].join("\n");

  const user = [
    `指令: ${input.instruction}`,
    input.matterId ? `案件ID: ${input.matterId}` : "",
    input.audience ? `受众: ${input.audience}` : "",
    input.templateId ? `模板: ${input.templateId}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const parsed = await completeJsonObject<RouterModelJson>(cfg, [
    { role: "system", content: schema },
    { role: "user", content: user || input.instruction },
  ]);

  if (!parsed || !isTaskKind(parsed.kind)) {
    return null;
  }

  const kind = parsed.kind;
  const output = normalizeOutput(kind, parsed.output);
  const riskLevel = parsed.riskLevel ?? inferRiskLevel(kind);
  const models =
    Array.isArray(parsed.models) && parsed.models.length > 0
      ? parsed.models.filter((m): m is ModelRole => m === "general" || m === "legal")
      : inferModels(kind);

  const requiresConfirmation =
    riskLevel === "high" ||
    kind === "unknown" ||
    (typeof parsed.requiresConfirmation === "boolean" ? parsed.requiresConfirmation : false);

  const summary =
    typeof parsed.summary === "string" && parsed.summary.trim()
      ? parsed.summary.trim()
      : buildSummaryFallback({ kind, instruction: input.instruction, output });

  return enrichIntentWithDeliverableMeta({
    taskId: randomUUID(),
    kind,
    output,
    instruction: input.instruction,
    summary,
    audience: input.audience,
    matterId: input.matterId,
    templateId: input.templateId,
    riskLevel,
    models: models.length > 0 ? models : inferModels(kind),
    requiresConfirmation,
    createdAt: new Date().toISOString(),
  });
}

/**
 * 异步路由：在启用模型路由且凭据齐全时走 LLM，否则回退关键词 route()。
 */
export async function routeAsync(input: RouteInput): Promise<TaskIntent> {
  if (isModelRouterEnabled()) {
    const cfg = routerLlmConfigFromEnv();
    if (cfg) {
      const modelIntent = await routeWithModel(input, cfg);
      if (modelIntent) {
        return modelIntent;
      }
    }
  }
  return route(input);
}
