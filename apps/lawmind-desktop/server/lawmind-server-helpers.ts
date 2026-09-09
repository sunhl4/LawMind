/**
 * Shared HTTP helpers and path utilities for the LawMind desktop local API.
 */

import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { createLawMindEngine } from "../../../src/lawmind/index.js";
import { buildLawMindRetrievalAdaptersFromEnvForTest } from "../../../src/lawmind/agent/tools/engine-tools.js";
import type { AgentConfig } from "../../../src/lawmind/agent/types.js";
import { resolveLawMindRoot } from "../../../src/lawmind/assistants/store.js";
import { readModelsStore } from "../../../src/lawmind/models/custom-store.js";
import {
  isAnyModelConfigured,
  resolveAgentModelById,
  resolveModelIdentityForPrompt,
} from "../../../src/lawmind/models/index.js";
import {
  resolveCapabilityEnvelope,
  resolveTemperatureForTask,
} from "../../../src/lawmind/models/capability-envelope.js";
import { parseToolTimeoutMsEnv } from "../../../src/lawmind/runtime/tool-timeout-env.js";
import { resolveEdition } from "../../../src/lawmind/policy/edition.js";
import type { LawMindWorkspacePolicy } from "../../../src/lawmind/policy/workspace-policy.js";
import {
  resolveAgentMaxHistoryMessages,
  resolveAgentMaxToolCallsPerTurn,
} from "../../../src/lawmind/policy/workspace-policy.js";
import { readLawMindPolicyFile } from "./lawmind-policy.js";
import type { TaskRecord } from "../../../src/lawmind/types.js";
import {
  friendlyModelErrorMessage,
  isModelProviderErrorMessage,
} from "../../../src/lawmind/agent/model-error-message.js";

export const LAWMIND_LOCAL_HOST = "127.0.0.1";
export const MAX_TEXT_READ_BYTES = 1_000_000;
export const MAX_JSON_BODY_BYTES = 256_000;

type LawMindHttpErrorCode = "body_too_large" | "invalid_json";

export type LawMindHttpError = Error & {
  code: LawMindHttpErrorCode;
  status: number;
};

function createLawMindHttpError(
  code: LawMindHttpErrorCode,
  status: number,
  message: string,
): LawMindHttpError {
  const error = new Error(message) as LawMindHttpError;
  error.code = code;
  error.status = status;
  return error;
}

export function isLawMindHttpError(error: unknown): error is LawMindHttpError {
  return (
    error instanceof Error &&
    "code" in error &&
    "status" in error &&
    typeof (error as LawMindHttpError).code === "string" &&
    typeof (error as LawMindHttpError).status === "number"
  );
}

/** Desktop operator identity for audit/review (see docs/archive/LAWMIND-ACTOR-ATTRIBUTION.md). */
export function resolveDesktopActorId(): string {
  const raw = process.env.LAWMIND_DESKTOP_ACTOR_ID?.trim();
  return raw ? raw : "lawyer:desktop";
}

export function getLawMindEngine(workspaceDir: string) {
  return createLawMindEngine({
    workspaceDir,
    adapters: buildLawMindRetrievalAdaptersFromEnvForTest(workspaceDir),
  });
}

export function corsHeaders(origin: string | undefined): Record<string, string> {
  const allow =
    origin === "null" ||
    origin?.startsWith("http://localhost:") ||
    origin?.startsWith("http://127.0.0.1:") ||
    origin?.startsWith("file://")
      ? origin ?? "null"
      : "http://127.0.0.1:5174";
  return {
    "access-control-allow-origin": allow,
    // PUT 用于 team-roster / routing defaults / plan-handoff 等路由；缺失会让浏览器预检失败。
    "access-control-allow-methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "access-control-allow-headers": "Content-Type, Authorization",
  };
}

export function readJsonBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    req.on("data", (c: Buffer) => {
      totalBytes += c.length;
      if (totalBytes > MAX_JSON_BODY_BYTES) {
        reject(createLawMindHttpError("body_too_large", 413, "request body too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        if (!raw.trim()) {
          resolve({});
          return;
        }
        resolve(JSON.parse(raw) as unknown);
      } catch (e) {
        if (e instanceof SyntaxError) {
          reject(createLawMindHttpError("invalid_json", 400, "invalid json body"));
          return;
        }
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

export function sendJson(
  res: http.ServerResponse,
  status: number,
  body: unknown,
  extraHeaders: Record<string, string> = {},
) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    ...extraHeaders,
  });
  res.end(JSON.stringify(body));
}

export function parsePositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) {
    return fallback;
  }
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

export { friendlyModelErrorMessage, isModelProviderErrorMessage };

export function resolveModelCallHttpError(err: unknown): {
  status: number;
  code: string;
  message: string;
} | null {
  const msg = err instanceof Error ? err.message : String(err);
  if (!isModelProviderErrorMessage(msg)) {
    return null;
  }
  const friendly = friendlyModelErrorMessage(msg);
  if (
    msg.includes("AbortError") ||
    /aborted/i.test(msg) ||
    /timed out/i.test(msg) ||
    msg.startsWith("Model request timed out")
  ) {
    return {
      status: 504,
      code: "model_unavailable",
      message: friendly,
    };
  }
  if (msg.startsWith("Model network error") || /fetch failed/i.test(msg)) {
    return {
      status: 502,
      code: "model_network_error",
      message: friendly,
    };
  }
  return {
    status: 502,
    code: "model_unavailable",
    message: friendly,
  };
}

export type BuildAgentConfigOptions = {
  envFile?: string;
  modelId?: string;
};

export function buildAgentConfig(
  workspaceDir: string,
  opts?: BuildAgentConfigOptions,
): { config: AgentConfig; error?: string; modelId?: string } {
  const lawMindRoot = resolveLawMindRoot(workspaceDir, opts?.envFile);
  const modelTimeoutMs = parsePositiveIntEnv("LAWMIND_AGENT_TIMEOUT_MS", 120000);
  const toolTimeoutMs = parseToolTimeoutMsEnv(0);
  const resolved = resolveAgentModelById(lawMindRoot, opts?.modelId);
  const fallbackEnvelope = resolveCapabilityEnvelope({
    contextTokens: resolved.model?.contextTokens,
    timeoutMs: modelTimeoutMs,
  });
  const modelConfig = resolved.model ?? {
    provider: "openai-compatible" as const,
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    apiKey: "",
    model: "qwen-plus",
    maxTokens: fallbackEnvelope.maxOutputTokens,
    temperature: 0.3,
    timeoutMs: fallbackEnvelope.modelTimeoutMs,
    contextTokens: fallbackEnvelope.contextTokens,
  };

  const actorId = resolveDesktopActorId();

  if (!modelConfig.apiKey) {
    const err =
      resolved.error === "missing_platform_api_key"
        ? "missing_platform_api_key"
        : resolved.error === "missing_provider_api_key"
          ? "missing_provider_api_key"
          : "missing_api_key";
    return {
      config: {
        workspaceDir,
        model: modelConfig,
        actorId,
        ...(opts?.envFile ? { envFile: opts.envFile } : {}),
      },
      error: err,
      modelId: resolved.resolvedModelId,
    };
  }

  const enableCollaboration = process.env.LAWMIND_ENABLE_COLLABORATION?.trim().toLowerCase() !== "false";
  const envelope = resolveCapabilityEnvelope({
    contextTokens: modelConfig.contextTokens,
    timeoutMs: modelConfig.timeoutMs ?? modelTimeoutMs,
    taskKind: "chat",
  });
  if (!modelConfig.contextTokens) {
    modelConfig.contextTokens = envelope.contextTokens;
  }
  if (!modelConfig.maxTokens || modelConfig.maxTokens < envelope.maxOutputTokens) {
    // Prefer envelope when legacy 4096 (or lower) slipped through.
    if (!modelConfig.maxTokens || modelConfig.maxTokens <= 4096) {
      modelConfig.maxTokens = envelope.maxOutputTokens;
    }
  }
  if (modelConfig.temperature === undefined || modelConfig.temperature === 0.3) {
    // E2: chat default 0.35 (legacy hardcoded 0.3 treated as unset).
    modelConfig.temperature = resolveTemperatureForTask("chat");
  }
  const policyState = readLawMindPolicyFile(workspaceDir);
  const policyForEdition: LawMindWorkspacePolicy | null = policyState.loaded
    ? (policyState.policy as LawMindWorkspacePolicy)
    : null;
  const explicitToolCap =
    (typeof policyForEdition?.agentMaxToolCallsPerTurn === "number" &&
      policyForEdition.agentMaxToolCallsPerTurn > 0) ||
    Boolean(process.env.LAWMIND_AGENT_MAX_TOOL_CALLS?.trim());
  const maxToolCalls = explicitToolCap
    ? resolveAgentMaxToolCallsPerTurn(workspaceDir)
    : envelope.toolCallsPerTurn;
  const edition = resolveEdition({ policy: policyForEdition });
  const allowDangerousRaw =
    process.env.LAWMIND_ALLOW_DANGEROUS_TOOLS_WITHOUT_APPROVAL?.trim().toLowerCase() ?? "";
  const allowDangerousToolsWithoutApproval =
    allowDangerousRaw === "true" || allowDangerousRaw === "1";

  const runtimeModel = resolveModelIdentityForPrompt(
    lawMindRoot,
    resolved.resolvedModelId,
    modelConfig,
  );

  // E7: optional worker (fast) model for tool rounds.
  let workerModel = undefined as typeof modelConfig | undefined;
  const workerId = readModelsStore(lawMindRoot).workerModelId?.trim();
  if (workerId && workerId !== resolved.resolvedModelId) {
    const workerResolved = resolveAgentModelById(lawMindRoot, workerId);
    if (workerResolved.model?.apiKey) {
      workerModel = workerResolved.model;
    }
  }

  return {
    config: {
      workspaceDir,
      model: modelConfig,
      runtimeModel,
      ...(workerModel ? { workerModel } : {}),
      maxToolCalls,
      maxHistoryMessages: resolveAgentMaxHistoryMessages(
        workspaceDir,
        envelope.maxHistoryMessages,
      ),
      toolExecutionTimeoutMs: toolTimeoutMs,
      actorId,
      enableCollaboration,
      allowDangerousToolsWithoutApproval,
      strictDangerousToolApproval: edition.features.strictDangerousToolApproval,
      autoApproveSandboxWorkflowSteps:
        policyForEdition?.autoApproveSandboxWorkflowSteps === true,
      ...(opts?.envFile ? { envFile: opts.envFile } : {}),
    },
    modelId: resolved.resolvedModelId,
  };
}

/** True when at least one built-in provider key or custom model key is available. */
export function isDesktopModelConfigured(workspaceDir: string, envFile?: string): boolean {
  const lawMindRoot = resolveLawMindRoot(workspaceDir, envFile);
  return isAnyModelConfigured(lawMindRoot);
}

export function isUnderWorkspace(workspaceRoot: string, candidate: string): boolean {
  const root = path.resolve(workspaceRoot);
  const abs = path.resolve(candidate);
  return abs === root || abs.startsWith(root + path.sep);
}

export function safeArtifactPath(workspaceDir: string, rel: string): string | null {
  const norm = rel.replace(/\\/g, "/").replace(/^\//, "");
  if (norm.includes("..")) {
    return null;
  }
  const full = path.resolve(workspaceDir, norm);
  if (!isUnderWorkspace(workspaceDir, full)) {
    return null;
  }
  const artifactsRoot = path.join(workspaceDir, "artifacts");
  if (!full.startsWith(artifactsRoot + path.sep) && full !== artifactsRoot) {
    return null;
  }
  return full;
}

export function normalizeRelPath(p: string): string {
  return String(p || "")
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .replace(/\/+$/, "");
}

export function resolveFsRoots(workspaceDir: string): { workspace: string; project?: string } {
  const roots: { workspace: string; project?: string } = { workspace: workspaceDir };
  const project = process.env.LAWMIND_PROJECT_DIR?.trim();
  if (project) {
    roots.project = path.resolve(project);
  }
  return roots;
}

/** Validate optional desktop project path for agent tools (must exist and be a directory). */
export function safeOptionalProjectDir(raw: unknown): string | undefined {
  if (typeof raw !== "string" || !raw.trim()) {
    return undefined;
  }
  const abs = path.resolve(raw.trim());
  try {
    const st = fs.statSync(abs);
    if (!st.isDirectory()) {
      return undefined;
    }
  } catch {
    return undefined;
  }
  return abs;
}

export function resolveFsPath(
  roots: { workspace: string; project?: string },
  rootKey: string,
  relPath: string,
): { root: string; full: string; rel: string } {
  if (rootKey !== "workspace" && rootKey !== "project") {
    throw new Error("invalid root");
  }
  const root = rootKey === "workspace" ? roots.workspace : roots.project;
  if (!root) {
    throw new Error("root not available");
  }
  const rel = normalizeRelPath(relPath);
  if (rel.includes("..")) {
    throw new Error("path traversal is not allowed");
  }
  const full = path.resolve(root, rel);
  const rootAbs = path.resolve(root);
  if (full !== rootAbs && !full.startsWith(rootAbs + path.sep)) {
    throw new Error("path escapes root");
  }
  const real = fs.existsSync(full) ? fs.realpathSync(full) : null;
  if (real && real !== rootAbs && !real.startsWith(rootAbs + path.sep)) {
    throw new Error("symlink escapes root");
  }
  return { root: rootAbs, full, rel };
}

export function isLikelyBinary(buffer: Buffer): boolean {
  const sample = buffer.subarray(0, Math.min(buffer.length, 4096));
  for (const byte of sample) {
    if (byte === 0) {
      return true;
    }
  }
  return false;
}

export function taskToSummary(t: TaskRecord) {
  return {
    taskId: t.taskId,
    instruction: t.instruction,
    summary: t.summary,
    title: t.title,
    kind: t.kind,
    status: t.status,
    output: t.output,
    riskLevel: t.riskLevel,
    requiresConfirmation: t.requiresConfirmation,
    audience: t.audience,
    matterId: t.matterId,
    deliverableType: t.deliverableType,
    acceptanceCriteria: t.acceptanceCriteria,
    reviewStatus: t.reviewStatus,
    executionPlan: t.executionPlan,
    outputPath: t.outputPath,
    assistantId: t.assistantId,
    sessionId: t.sessionId,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
  };
}

export type TaskSummaryRow = ReturnType<typeof taskToSummary>;

export function parseQueryTimeMs(value: string | null): number | null {
  if (!value?.trim()) {
    return null;
  }
  const t = Date.parse(value.trim());
  return Number.isFinite(t) ? t : null;
}

export function filterTaskSummaries(
  rows: TaskSummaryRow[],
  q: string,
  since: number | null,
  until: number | null,
): TaskSummaryRow[] {
  let list = rows;
  const needle = q.trim().toLowerCase();
  if (needle) {
    list = list.filter((t) => {
      const hay = [t.taskId, t.title ?? "", t.summary, t.kind ?? ""].join(" ").toLowerCase();
      return hay.includes(needle);
    });
  }
  if (since !== null) {
    list = list.filter((t) => Date.parse(t.updatedAt) >= since);
  }
  if (until !== null) {
    list = list.filter((t) => Date.parse(t.updatedAt) <= until);
  }
  return list.toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
