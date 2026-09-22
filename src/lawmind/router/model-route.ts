/**
 * Model-driven instruction routing (default on when LLM credentials exist).
 */

import { randomUUID } from "node:crypto";
import fs from "node:fs";
import {
  completeJsonObject,
  type JsonResponseSchema,
  type OpenAiJsonClientConfig,
} from "../llm/openai-json.js";
import { resolveRouterLlmConfig } from "../models/router-reasoning.js";
import { runTriageRules } from "../triage/rules.js";
import type { RiskLevel, TaskIntent, TaskKind } from "../types.js";
import { enrichIntentWithDeliverableMeta } from "./deliverable-meta.js";
import type { RouteInput } from "./keyword-route.js";
import { route } from "./keyword-route.js";
import {
  buildRouteDivergenceEscalation,
  buildRouteDivergenceRecord,
  isDivergent,
  recordRouteDivergence,
  resolveRouteDivergencePosture,
  triageTierToRiskLevel,
  type RouteDivergenceEscalation,
} from "./route-divergence.js";

const TASK_KINDS = [
  "research.general",
  "research.legal",
  "research.hybrid",
  "draft.word",
  "draft.ppt",
  "summarize.case",
  "analyze.contract",
  "unknown",
] as const;

/**
 * P2.1：路由分类的 strict schema。
 *
 * 旧实现靠 `isTaskKind()` 在**返回后**校验，非法 kind 只能整包丢弃并回退关键词
 * ——即「模型编了一个 kind」与「模型没答」在行为上不可区分。给出 schema 后，
 * 支持 strict 的端点从**协议层**保证 kind 必在集合内、riskLevel 必为三档之一。
 *
 * 满足 OpenAI strict 子集要求：根为 object、全部属性列入 `required`、
 * `additionalProperties: false`。
 */
export const ROUTER_JSON_SCHEMA: JsonResponseSchema = {
  name: "lawmind_router_intent",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["kind", "summary", "riskLevel", "models", "requiresConfirmation", "output"],
    properties: {
      kind: { type: "string", enum: [...TASK_KINDS] },
      summary: { type: "string" },
      riskLevel: { type: "string", enum: ["low", "medium", "high"] },
      models: {
        type: "array",
        items: { type: "string", enum: ["general", "legal"] },
      },
      requiresConfirmation: { type: "boolean" },
      output: { type: "string", enum: ["markdown", "docx", "pptx", "none"] },
    },
  },
};

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
  return typeof value === "string" && (TASK_KINDS as readonly string[]).includes(value);
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

export { effectiveRouterMode, isModelRouterEnabled } from "../models/router-reasoning.js";

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

  const parsed = await completeJsonObject<RouterModelJson>(
    cfg,
    [
      { role: "system", content: schema },
      { role: "user", content: user || input.instruction },
    ],
    { schema: ROUTER_JSON_SCHEMA },
  );

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
    deliverableType: input.deliverableType,
    riskLevel,
    models: models.length > 0 ? models : inferModels(kind),
    requiresConfirmation,
    createdAt: new Date().toISOString(),
  });
}

/**
 * 异步路由：有凭据时走 LLM 分类，失败或未配置则回退关键词 route()。
 *
 * P2.3/P2.4：在**不改变返回结果**的前提下，顺带记录三条路径的分歧。
 * 关键点是零额外成本——关键词 `route()` 是同步纯函数，本来就该算（旧实现只在
 * 模型失败时才算）；`runTriageRules` 同样是同步正则。所以三条意见都是白拿的。
 *
 * 三种姿态（`resolveRouteDivergencePosture`）：
 *   - `off`：不记录
 *   - `shadow`（默认）：只记录
 *   - `escalate`：记录并把分歧**升级**（此时才真的改行为，见下）
 *
 * `escalate` 下用**既有**的 `requiresConfirmation` 通道升级，而不是新造一种卡片：
 * 该字段已经是「这件的办理口径需要律师确认」的既有表达，且已贯通到 UI。
 * 理由见 `buildRouteDivergenceEscalation` 的注释——分歧要的是「别替律师选路」，
 * 而 `requiresConfirmation` 的语义正是这个。
 */
export async function routeAsync(input: RouteInput): Promise<TaskIntent> {
  const cfg = resolveRouterLlmConfig(input.lawMindRoot);
  const keywordIntent = route(input);
  let modelIntent: TaskIntent | null = null;
  if (cfg) {
    modelIntent = await routeWithModel(input, cfg);
  }
  const resolved = modelIntent ?? keywordIntent;

  const divergence = maybeRecordRouteDivergence({
    input,
    keywordIntent,
    modelIntent,
    resolved,
  });
  if (divergence.escalation) {
    return { ...resolved, requiresConfirmation: true };
  }
  return resolved;
}

/**
 * 分歧记录 + （按姿态）升级。**永不抛**：路由可靠性不得被观测设施拖垮。
 *
 * 升级只通过返回值暴露（`escalation`），由调用方决定是否挂到 turn 上——
 * 本函数不直接改 turn，避免路由层反向依赖 agent 层。
 */
export function maybeRecordRouteDivergence(args: {
  input: RouteInput;
  keywordIntent: TaskIntent;
  modelIntent: TaskIntent | null;
  resolved: TaskIntent;
}): { divergent: boolean; escalation?: RouteDivergenceEscalation } {
  try {
    const posture = resolveRouteDivergencePosture();
    if (posture === "off") {
      return { divergent: false };
    }
    const workspaceDir = resolveWorkspaceDirForDivergence(args.input.lawMindRoot);
    if (!workspaceDir) {
      return { divergent: false };
    }
    const triage: ReturnType<typeof runTriageRules> | undefined = safeTriage(
      args.input.instruction,
    );
    const record = buildRouteDivergenceRecord({
      instruction: args.input.instruction,
      ...(args.input.matterId ? { matterId: args.input.matterId } : {}),
      opinions: [
        { path: "keyword", kind: args.keywordIntent.kind, riskLevel: args.keywordIntent.riskLevel },
        ...(args.modelIntent
          ? [
              {
                path: "model" as const,
                kind: args.modelIntent.kind,
                riskLevel: args.modelIntent.riskLevel,
              },
            ]
          : []),
        ...(triage
          ? [{ path: "triage" as const, riskLevel: triageTierToRiskLevel(triage.tier) }]
          : []),
      ],
    });
    if (!record) {
      return { divergent: false };
    }
    recordRouteDivergence(workspaceDir, record);
    const escalation = buildRouteDivergenceEscalation(record);
    if (posture !== "escalate") {
      // shadow：算出来了但不交出去（记录里已含 divergenceKey，可事后聚合）。
      return { divergent: isDivergent(record) };
    }
    return { divergent: isDivergent(record), ...(escalation ? { escalation } : {}) };
  } catch {
    return { divergent: false };
  }
}

function safeTriage(instruction: string): ReturnType<typeof runTriageRules> | undefined {
  try {
    return runTriageRules({ text: instruction });
  } catch {
    return undefined;
  }
}

/**
 * 分歧记录落在工作区，而路由只拿得到 `lawMindRoot`（models.json 所在目录）。
 * 两者在桌面部署里是同一个工作区根；解析不到就不记（宁可少记，不要写错地方）。
 */
function resolveWorkspaceDirForDivergence(lawMindRoot?: string): string | undefined {
  const root = lawMindRoot?.trim();
  if (!root) {
    return undefined;
  }
  try {
    return fs.existsSync(root) ? root : undefined;
  } catch {
    return undefined;
  }
}
