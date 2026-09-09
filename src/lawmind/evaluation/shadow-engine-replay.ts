/**
 * 真影子回放（engine-scripted-model 层）：脚本化模型驱动真实 runTurn 管线。
 *
 * 与 shadow-replay.ts 静态层的关系：
 *   - 静态层：runLegalLint(fixture.engineDraftText)——lint 回归 fixture，草稿不经引擎。
 *   - 本层：fixture 携带的 modelScript（cassette）由脚本化模型在真实 runTurn 中回放，
 *     草稿经真实工具（draft_document / update_draft）落盘，管线内含真实 lint、
 *     自检与门禁（澄清门禁按真实律师会话流程先答澄清再放行改稿）。报告数字从
 *     引擎真实产出并持久化的 draft 计算，允许 <1；引擎行为回归（删 lint 规则、
 *     收紧门禁）会改变本层结果——召回不再由构造保证为 1。
 *
 * 真模型通道：LAWMIND_SHADOW_REAL_MODEL=1 且配置 LAWMIND_AGENT_* 后，对投放的
 * 已结案 fixture 跑真模型单轮（不用 cassette）。CI 不设置该 env，不依赖真模型。
 */

import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { runTurn } from "../agent/runtime.js";
import { resolveGeneralOpenAICompatibleFromEnv } from "../agent/tools/engine/engine-tool-shared.js";
import { createLegalToolRegistry } from "../agent/tools/legal-tools.js";
import type { ToolRegistry } from "../agent/tools/registry.js";
import type { AgentConfig, AgentTurn } from "../agent/types.js";
import { readDraft } from "../drafts/index.js";
import { draftTextFromUnknown, runLegalLint } from "../lint/run-lint.js";
import type { BenchmarkModelMode } from "../types.js";
import {
  textOverlapRatio,
  type ShadowModelScriptStep,
  type ShadowReplayFixture,
} from "./shadow-replay.js";

/** 真模型通道开关（env/flag 门后；CI 默认关）。 */
export function isShadowRealModelEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env.LAWMIND_SHADOW_REAL_MODEL?.trim().toLowerCase() ?? "";
  return raw === "1" || raw === "true" || raw === "on";
}

export type EngineShadowDraftChannel = "persisted-draft" | "final-reply" | "none";

export type EngineShadowCaseResult = {
  id: string;
  status: "ok" | "no-script" | "error";
  error?: string;
  /** 引擎真实产出的草稿正文（persisted drafts/<taskId>.json），不是 fixture 静态串。 */
  engineDraftText: string;
  draftChannel: EngineShadowDraftChannel;
  draftTaskId?: string;
  similarity: number;
  plantedDefectRecall: number | null;
  /** 精度 = 植入命中数 / 引擎草稿真实 lint 命中总数（无命中时为 null）。 */
  defectPrecision: number | null;
  hitRuleIds: string[];
  plantedRuleIds: string[];
  lintFindingRuleIds: string[];
  toolsCalled: string[];
  toolCallsExecuted: number;
  turnsRun: number;
  clarificationTurns: number;
};

export type EngineShadowReplaySummary = {
  cases: number;
  skipped: number;
  failed: number;
  meanOverlap: number;
  defectRecall: number | null;
  defectPrecision: number | null;
  /** 草稿来源口径：脚本化模型驱动真实引擎管线产出（区别于 fixture-static）。 */
  draftSource: "engine-scripted-model";
  modelMode: BenchmarkModelMode;
  reportZh: string;
};

export type EngineShadowReplayReport = {
  results: EngineShadowCaseResult[];
  summary: EngineShadowReplaySummary;
};

export type EngineShadowReplayOptions = {
  /** 真模型模式；缺省读 env LAWMIND_SHADOW_REAL_MODEL。 */
  realModel?: boolean;
  /** 测试注入：自定义工具注册表（默认真实 createLegalToolRegistry()）。 */
  createRegistry?: () => ToolRegistry;
  /** 调试用：保留每案的临时工作区（默认回放后删除）。 */
  keepWorkspaceDir?: boolean;
};

// ─────────────────────────────────────────────
// 脚本化模型服务（VCR cassette over OpenAI-compatible HTTP）
// ─────────────────────────────────────────────

type ScriptedRound =
  | { toolCalls: Array<{ name: string; arguments: Record<string, unknown> }> }
  | { content: string };

type ScriptedModelServer = {
  url: string;
  push: (round: ScriptedRound) => void;
  close: () => Promise<void>;
};

/** taskId 运行时才生成：每次请求从对话历史最后的 draft 工具结果里解析。 */
function lastDraftTaskIdFromRequestBody(body: string): string {
  try {
    const parsed = JSON.parse(body) as { messages?: Array<{ role?: string; content?: string }> };
    for (const message of [...(parsed.messages ?? [])].toReversed()) {
      if (message.role !== "tool" || typeof message.content !== "string") {
        continue;
      }
      try {
        const content = JSON.parse(message.content) as {
          ok?: boolean;
          data?: { taskId?: unknown };
        };
        if (content.ok && typeof content.data?.taskId === "string" && content.data.taskId) {
          return content.data.taskId;
        }
      } catch {
        /* skip malformed tool message */
      }
    }
  } catch {
    /* skip malformed request */
  }
  return "";
}

function resolveRuntimeTokens(value: unknown, taskId: string): unknown {
  if (value === "$lastDraftTaskId") {
    return taskId;
  }
  if (Array.isArray(value)) {
    return value.map((item) => resolveRuntimeTokens(item, taskId));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [
        k,
        resolveRuntimeTokens(v, taskId),
      ]),
    );
  }
  return value;
}

async function startScriptedModelServer(): Promise<ScriptedModelServer> {
  const queue: ScriptedRound[] = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      const round = queue.shift();
      if (!round) {
        // 400 不可重试：cassette 耗尽是机制漂移，必须显式失败而不是静默兜底。
        res.writeHead(400).end(JSON.stringify({ error: "shadow cassette exhausted" }));
        return;
      }
      const taskId = lastDraftTaskIdFromRequestBody(body);
      const message: Record<string, unknown> =
        "content" in round
          ? { role: "assistant", content: round.content }
          : {
              role: "assistant",
              content: "",
              tool_calls: round.toolCalls.map((tc, index) => ({
                id: `shadow_call_${queue.length}_${index}`,
                type: "function",
                function: {
                  name: tc.name,
                  arguments: JSON.stringify(resolveRuntimeTokens(tc.arguments, taskId)),
                },
              })),
            };
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ choices: [{ message, finish_reason: "stop" }] }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return {
    url: `http://127.0.0.1:${port}/v1`,
    push: (round) => queue.push(round),
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}

// ─────────────────────────────────────────────
// 回放驱动
// ─────────────────────────────────────────────

const STEP_CLOSING_REPLY = "已完成本步骤。";
const CONTINUE_INSTRUCTION = "继续完善草稿。";
const CLARIFICATION_INSTRUCTION = "补充：按通用交易结构继续，无需再等我澄清。";
const CLARIFICATION_REPLY = "明白，按补充继续。";
const MAX_CLARIFICATION_TURNS = 2;

function resolveFixtureTokens(value: unknown, fixture: ShadowReplayFixture): unknown {
  if (value === "$instruction") {
    return fixture.instruction;
  }
  if (value === "$engineDraftText") {
    return fixture.engineDraftText;
  }
  if (Array.isArray(value)) {
    return value.map((item) => resolveFixtureTokens(item, fixture));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [
        k,
        resolveFixtureTokens(v, fixture),
      ]),
    );
  }
  return value;
}

function stepToolCalls(
  step: ShadowModelScriptStep,
  fixture: ShadowReplayFixture,
): Array<{ name: string; arguments: Record<string, unknown> }> {
  const args = resolveFixtureTokens(step.args ?? {}, fixture) as Record<string, unknown>;
  return [{ name: step.tool, arguments: args }];
}

/** 该步工具结果被澄清门禁拦截（ok:false 且错误指向待澄清）。 */
function stepBlockedByClarification(turn: AgentTurn): boolean {
  return turn.messages.some(
    (m) =>
      m.role === "tool" &&
      (m.toolCallResponses ?? []).some(
        (r) => !r.result.ok && typeof r.result.error === "string" && /澄清/.test(r.result.error),
      ),
  );
}

function collectTurnTools(turn: AgentTurn): { names: string[]; taskIds: string[] } {
  const names: string[] = [];
  const taskIds: string[] = [];
  for (const message of turn.messages) {
    if (message.role !== "tool") {
      continue;
    }
    for (const response of message.toolCallResponses ?? []) {
      names.push(response.name);
      const data = response.result.ok ? response.result.data : undefined;
      if (data && typeof data === "object" && !Array.isArray(data)) {
        const taskId = (data as Record<string, unknown>).taskId;
        if (typeof taskId === "string" && taskId) {
          taskIds.push(taskId);
        }
      }
    }
  }
  return { names, taskIds };
}

function emptyCaseResult(fixture: ShadowReplayFixture): EngineShadowCaseResult {
  return {
    id: fixture.id,
    status: "error",
    engineDraftText: "",
    draftChannel: "none",
    similarity: 0,
    plantedDefectRecall: null,
    defectPrecision: null,
    hitRuleIds: [],
    plantedRuleIds: fixture.plantedDefectRuleIds ?? [],
    lintFindingRuleIds: [],
    toolsCalled: [],
    toolCallsExecuted: 0,
    turnsRun: 0,
    clarificationTurns: 0,
  };
}

function prepareShadowWorkspace(): string {
  const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-shadow-engine-"));
  fs.writeFileSync(path.join(workspaceDir, "MEMORY.md"), "# 通用记忆\n", "utf8");
  fs.writeFileSync(path.join(workspaceDir, "LAWYER_PROFILE.md"), "# 律师偏好\n", "utf8");
  return workspaceDir;
}

function removeShadowWorkspace(workspaceDir: string): void {
  try {
    fs.rmSync(workspaceDir, { recursive: true, force: true, maxRetries: 8, retryDelay: 25 });
  } catch {
    // Linux CI can hit ENOTEMPTY while a handle is still closing; tmp is disposable.
  }
}

function finalizeCaseMetrics(
  base: EngineShadowCaseResult,
  fixture: ShadowReplayFixture,
): EngineShadowCaseResult {
  const lint = runLegalLint(base.engineDraftText);
  const found = new Set(lint.findings.map((f) => f.ruleId));
  const planted = fixture.plantedDefectRuleIds ?? [];
  const hitRuleIds = planted.filter((id) => found.has(id));
  return {
    ...base,
    status: "ok",
    similarity: textOverlapRatio(fixture.lawyerFinalText, base.engineDraftText),
    plantedDefectRecall: planted.length === 0 ? null : hitRuleIds.length / planted.length,
    defectPrecision: lint.findings.length === 0 ? null : hitRuleIds.length / lint.findings.length,
    hitRuleIds,
    plantedRuleIds: planted,
    lintFindingRuleIds: lint.findings.map((f) => f.ruleId),
  };
}

/** cassette 路径：逐步驱动真实 runTurn（每步一轮工具调用 + 收尾回答）。 */
async function runScriptedCase(
  fixture: ShadowReplayFixture,
  opts: EngineShadowReplayOptions,
): Promise<EngineShadowCaseResult> {
  const steps = fixture.modelScript ?? [];
  if (steps.length === 0) {
    return { ...emptyCaseResult(fixture), status: "no-script", error: "fixture 无 modelScript" };
  }
  const workspaceDir = prepareShadowWorkspace();
  const server = await startScriptedModelServer();
  const result = emptyCaseResult(fixture);
  try {
    const config: AgentConfig = {
      workspaceDir,
      maxToolCalls: 8,
      model: {
        provider: "openai-compatible",
        baseUrl: server.url,
        apiKey: "sk-shadow-scripted",
        model: "shadow-scripted-model",
        timeoutMs: 15_000,
        maxRetries: 0,
      },
    };
    const registry = opts.createRegistry?.() ?? createLegalToolRegistry();
    let sessionId: string | undefined;
    const draftTaskIds: string[] = [];
    const toolsCalled: string[] = [];
    let firstTurn = true;
    for (const step of steps) {
      let attempt = 0;
      // 澄清门禁重试一次：先按真实流程答澄清放行，再重跑被拦的本步。
      for (;;) {
        server.push({ toolCalls: stepToolCalls(step, fixture) });
        server.push({ content: STEP_CLOSING_REPLY });
        const run = await runTurn({
          config,
          registry,
          instruction: firstTurn ? fixture.instruction : CONTINUE_INSTRUCTION,
          ...(sessionId ? { sessionId } : {}),
        });
        firstTurn = false;
        sessionId = run.sessionId;
        result.turnsRun += 1;
        result.toolCallsExecuted += run.turn.toolCallsExecuted;
        const collected = collectTurnTools(run.turn);
        toolsCalled.push(...collected.names);
        draftTaskIds.push(...collected.taskIds);
        let status = run.turn.status;
        for (
          let drain = 0;
          drain < MAX_CLARIFICATION_TURNS && status === "awaiting_clarification";
          drain += 1
        ) {
          server.push({ content: CLARIFICATION_REPLY });
          const drained = await runTurn({
            config,
            registry,
            sessionId,
            instruction: CLARIFICATION_INSTRUCTION,
          });
          result.turnsRun += 1;
          result.clarificationTurns += 1;
          status = drained.turn.status;
        }
        if (stepBlockedByClarification(run.turn) && attempt === 0) {
          attempt += 1;
          continue;
        }
        break;
      }
    }
    result.toolsCalled = toolsCalled;
    const draftTaskId = draftTaskIds[draftTaskIds.length - 1];
    const draft = draftTaskId ? readDraft(workspaceDir, draftTaskId) : undefined;
    if (!draft) {
      result.status = "error";
      result.error = "引擎管线未产出持久化草稿（no-draft-produced）";
      return result;
    }
    result.draftTaskId = draftTaskId;
    result.draftChannel = "persisted-draft";
    result.engineDraftText = draftTextFromUnknown(draft);
    return finalizeCaseMetrics(result, fixture);
  } catch (err) {
    result.status = "error";
    result.error = err instanceof Error ? err.message : String(err);
    return result;
  } finally {
    await server.close();
    if (!opts.keepWorkspaceDir) {
      removeShadowWorkspace(workspaceDir);
    }
  }
}

/** 真模型路径（env 门后）：单轮真实模型，不用 cassette；草稿取持久化 draft，回退最终回复。 */
async function runRealModelCase(
  fixture: ShadowReplayFixture,
  opts: EngineShadowReplayOptions,
): Promise<EngineShadowCaseResult> {
  const result = emptyCaseResult(fixture);
  const modelEnv = resolveGeneralOpenAICompatibleFromEnv();
  if (!modelEnv) {
    result.error = "真模型回放需要 LAWMIND_AGENT_BASE_URL/API_KEY/MODEL（或 QWEN_*）环境变量";
    return result;
  }
  const workspaceDir = prepareShadowWorkspace();
  try {
    const config: AgentConfig = {
      workspaceDir,
      model: {
        provider: "openai-compatible",
        baseUrl: modelEnv.baseUrl,
        apiKey: modelEnv.apiKey,
        model: modelEnv.model,
        timeoutMs: modelEnv.timeoutMs,
      },
    };
    const registry = opts.createRegistry?.() ?? createLegalToolRegistry();
    const run = await runTurn({ config, registry, instruction: fixture.instruction });
    result.turnsRun = 1;
    result.toolCallsExecuted = run.turn.toolCallsExecuted;
    const collected = collectTurnTools(run.turn);
    result.toolsCalled = collected.names;
    const draftTaskId = collected.taskIds[collected.taskIds.length - 1];
    const draft = draftTaskId ? readDraft(workspaceDir, draftTaskId) : undefined;
    if (draft) {
      result.draftTaskId = draftTaskId;
      result.draftChannel = "persisted-draft";
      result.engineDraftText = draftTextFromUnknown(draft);
    } else if (run.reply.trim()) {
      result.draftChannel = "final-reply";
      result.engineDraftText = run.reply;
    } else {
      result.status = "error";
      result.error = "真模型未产出草稿或回复";
      return result;
    }
    return finalizeCaseMetrics(result, fixture);
  } catch (err) {
    result.status = "error";
    result.error = err instanceof Error ? err.message : String(err);
    return result;
  } finally {
    if (!opts.keepWorkspaceDir) {
      removeShadowWorkspace(workspaceDir);
    }
  }
}

export async function runEngineShadowReplayCase(
  fixture: ShadowReplayFixture,
  opts: EngineShadowReplayOptions = {},
): Promise<EngineShadowCaseResult> {
  const realModel = opts.realModel === true || isShadowRealModelEnabled();
  return realModel ? runRealModelCase(fixture, opts) : runScriptedCase(fixture, opts);
}

function buildEngineReportZh(
  results: EngineShadowCaseResult[],
  summary: Omit<EngineShadowReplaySummary, "reportZh">,
): string {
  const recallZh =
    summary.defectRecall == null ? "无植入样本" : `${(summary.defectRecall * 100).toFixed(0)}%`;
  const precisionZh =
    summary.defectPrecision == null
      ? "无 lint 命中"
      : `${(summary.defectPrecision * 100).toFixed(0)}%`;
  const lines = [
    `引擎影子回放 ${summary.cases} 件（engine-scripted-model，${summary.modelMode}）。平均重叠 ${(summary.meanOverlap * 100).toFixed(1)}%。植入缺陷召回 ${recallZh}。精度 ${precisionZh}。跳过 ${summary.skipped}，失败 ${summary.failed}。`,
    "草稿来源：engine-scripted-model（脚本化模型驱动真实 runTurn 管线产出并落盘；含真实 lint 与门禁；非 fixture 静态串）。",
  ];
  for (const row of results) {
    if (row.status !== "ok") {
      lines.push(
        `- ${row.id}：${row.status === "no-script" ? "跳过（无 modelScript）" : `失败（${row.error ?? "unknown"}）`}`,
      );
      continue;
    }
    const caseRecall =
      row.plantedDefectRecall == null ? "—" : `${(row.plantedDefectRecall * 100).toFixed(0)}%`;
    const clar = row.clarificationTurns > 0 ? `，澄清放行 ${row.clarificationTurns} 轮` : "";
    lines.push(
      `- ${row.id}：重叠 ${(row.similarity * 100).toFixed(1)}%，缺陷召回 ${caseRecall}，工具 [${row.toolsCalled.join("→")}]，轮次 ${row.turnsRun}${clar}`,
    );
  }
  return lines.join("\n");
}

/** 逐案顺序回放（每案独立临时工作区与 cassette 服务，互不污染）。 */
export async function runEngineShadowReplay(
  fixtures: ShadowReplayFixture[],
  opts: EngineShadowReplayOptions = {},
): Promise<EngineShadowReplayReport> {
  const realModel = opts.realModel === true || isShadowRealModelEnabled();
  const results: EngineShadowCaseResult[] = [];
  for (const fixture of fixtures) {
    results.push(await runEngineShadowReplayCase(fixture, { ...opts, realModel }));
  }

  const okCases = results.filter((row) => row.status === "ok");
  const cases = okCases.length;
  const meanOverlap =
    cases === 0 ? 0 : okCases.reduce((sum, row) => sum + row.similarity, 0) / cases;

  let plantedTotal = 0;
  let plantedHits = 0;
  let findingsTotal = 0;
  for (const row of okCases) {
    plantedTotal += row.plantedRuleIds.length;
    plantedHits += row.hitRuleIds.length;
    findingsTotal += row.lintFindingRuleIds.length;
  }
  const defectRecall = plantedTotal === 0 ? null : plantedHits / plantedTotal;
  const defectPrecision = findingsTotal === 0 ? null : plantedHits / findingsTotal;

  const summaryBase = {
    cases,
    skipped: results.filter((row) => row.status === "no-script").length,
    failed: results.filter((row) => row.status === "error").length,
    meanOverlap,
    defectRecall,
    defectPrecision,
    draftSource: "engine-scripted-model" as const,
    modelMode: (realModel ? "real" : "scripted") as BenchmarkModelMode,
  };
  return {
    results,
    summary: {
      ...summaryBase,
      reportZh: buildEngineReportZh(results, summaryBase),
    },
  };
}
