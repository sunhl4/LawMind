/**
 * Shared HTTP helpers and path utilities for the LawMind desktop local API.
 */

import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { createLawMindEngine } from "../../../src/lawmind/index.js";
import { MOUNT_WRITE_REFUSAL } from "../../../src/lawmind/host-access/access-broker.js";
import { buildLawMindRetrievalAdaptersFromEnvForTest } from "../../../src/lawmind/agent/tools/engine-tools.js";
import {
  contextTokensForConversation,
  resolveConversationLength,
} from "../../../src/lawmind/agent/context-preset.js";
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
/**
 * 回环的 IPv6 面。`localhost` 在 macOS 上**同时**解析到 `::1` 与 `127.0.0.1`，
 * 而 WebKit（Word 任务窗格、Safari）通常先试 `::1`：只绑 127.0.0.1 时，
 * 用 `http://localhost:<port>` 取页面的客户端会直接连不上——在 Word 里就表现为
 * 「很抱歉，无法加载该加载项。请确保您具有网络和/或 Internet 连接」。
 * 所以 loopback 要两个协议族都听。仍是**回环**，不对局域网暴露。
 */
export const LAWMIND_LOCAL_HOST_V6 = "::1";
export const MAX_TEXT_READ_BYTES = 1_000_000;
export const MAX_JSON_BODY_BYTES = 256_000;

/**
 * 从请求自带的 `Host` 还原回环基址（`http://localhost:52100`）。
 *
 * 端口是动态的、且必须按**请求实际用的那个**来（侧载清单里的地址、页面里的 base、
 * Word 的 `Origin` 三者必须一致，否则混合内容 / CORS 会拦）。宿主名只认回环三种写法，
 * 其余一律回落到 `localhost` —— 绝不把请求头里的任意主机名回显给客户端。
 * 走 https 监听（配了本地证书）时 scheme 跟着升，否则任务窗格会因混合内容拿不到 API。
 */
export function loopbackBaseFromRequest(req: http.IncomingMessage): string {
  const raw = req.headers.host;
  const host = Array.isArray(raw) ? raw[0] : raw;
  const clean =
    typeof host === "string" && /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(host.trim())
      ? host.trim()
      : "localhost";
  // `encrypted` 是 TLS socket 才有的字段，不在 `net.Socket` 的类型上。
  // 这里按运行时真实存在的形状收窄（本地服务只监听回环，但同一段代码
  // 也要能在开发者自签 https 前置下如实给出 base URL）。
  const socket = req.socket as (typeof req.socket & { encrypted?: boolean }) | undefined;
  const scheme = socket?.encrypted ? "https" : "http";
  return `${scheme}://${clean}`;
}

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

export function getLawMindEngine(workspaceDir: string, projectDir?: string) {
  return createLawMindEngine({
    workspaceDir,
    adapters: buildLawMindRetrievalAdaptersFromEnvForTest(workspaceDir),
    projectDir,
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
    baseUrl: "https://api.deepseek.com/v1",
    apiKey: "",
    model: "deepseek-flash",
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
  const policyState = readLawMindPolicyFile(workspaceDir);
  const policyForEdition: LawMindWorkspacePolicy | null = policyState.loaded
    ? (policyState.policy as LawMindWorkspacePolicy)
    : null;
  const conversationLength = resolveConversationLength(policyForEdition?.conversationLength);
  modelConfig.contextTokens = contextTokensForConversation(
    modelConfig.contextTokens,
    conversationLength,
  );
  const envelope = resolveCapabilityEnvelope({
    contextTokens: modelConfig.contextTokens,
    timeoutMs: modelConfig.timeoutMs ?? modelTimeoutMs,
    taskKind: "chat",
  });
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

  // Optional faster model for review and mid-turn summaries (not the tool loop).
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
  if (norm.includes("..") || norm.includes("\0")) {
    return null;
  }
  const full = path.resolve(workspaceDir, norm);
  if (!isUnderWorkspace(workspaceDir, full)) {
    return null;
  }
  const artifactsRoot = path.join(workspaceDir, "artifacts");
  if (full === artifactsRoot || full.startsWith(artifactsRoot + path.sep)) {
    return full;
  }
  const matterArtifacts = path.sep + "artifacts" + path.sep;
  const casesRoot = path.join(workspaceDir, "cases") + path.sep;
  if (full.startsWith(casesRoot) && full.includes(matterArtifacts)) {
    const afterCases = full.slice(casesRoot.length);
    const segs = afterCases.split(path.sep);
    if (segs.length >= 3 && segs[1] === "artifacts" && segs[0] && !segs[0].includes("..")) {
      return full;
    }
  }
  return null;
}

export function normalizeRelPath(p: string): string {
  return (p || "")
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .replace(/\/+$/, "");
}

/**
 * 可写根白名单（fail-closed）。
 *
 * 用白名单而不是「root 是否以 mount: 开头」的否定式判断：新增根种类默认只读，
 * 必须显式加入这里才能写，避免默默开出一个新写入口。
 * 镜像：apps/lawmind-desktop/electron/fs-bridge.mjs 的 WRITABLE_ROOT_KEYS。
 */
export const WRITABLE_FS_ROOTS = new Set(["workspace", "project"]);

/** 机器可读的拒写原因。渲染进程与测试都按 code 判断，不依赖文案。 */
export const FS_ROOT_NOT_WRITABLE_CODE = "root_not_writable";

/** resolveFsPath 的写门禁抛出这个类型，调用方据此回 403 而不是 500。 */
export class FsWriteNotAllowedError extends Error {
  readonly code = FS_ROOT_NOT_WRITABLE_CODE;
}

export type FsAccess = "read" | "write";

export function isWritableFsRoot(rootKey: string): boolean {
  return WRITABLE_FS_ROOTS.has(rootKey);
}

function rootNotWritableError(rootKey: string): FsWriteNotAllowedError {
  return new FsWriteNotAllowedError(
    typeof rootKey === "string" && rootKey.startsWith("mount:")
      ? MOUNT_WRITE_REFUSAL
      : `不可写的根：${rootKey ?? "(未指定)"}`,
  );
}

export function resolveFsRoots(workspaceDir: string): Record<string, string> {
  const roots: Record<string, string> = { workspace: workspaceDir };
  const project = process.env.LAWMIND_PROJECT_DIR?.trim();
  if (project) {
    roots.project = path.resolve(project);
  }
  try {
    const file = process.env.LAWMIND_HOST_ACCESS_FILE?.trim();
    if (file && fs.existsSync(file)) {
      const raw = JSON.parse(fs.readFileSync(file, "utf8")) as {
        mounts?: Array<{ id?: string; absPath?: string }>;
      };
      for (const mount of raw.mounts ?? []) {
        if (mount?.id && mount.absPath) {
          roots[`mount:${mount.id}`] = path.resolve(mount.absPath);
        }
      }
    }
  } catch {
    /* ignore */
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

/**
 * 解析工作区/项目/挂载点内的相对路径。
 *
 * `access` 是**必填**的：调用点必须显式声明这次是读还是写。写操作会先过可写根
 * 白名单（挂载点只读），这样新增写入口不会因为「忘了加校验」而默认放行——
 * 缺参数的调用在类型检查或运行期直接失败。
 */
export function resolveFsPath(
  roots: Record<string, string>,
  rootKey: string,
  relPath: string,
  opts: { access: FsAccess; mustExist?: boolean; allowRoot?: boolean },
): { root: string; full: string; rel: string } {
  if (opts?.access !== "read" && opts?.access !== "write") {
    throw new Error("internal: resolveFsPath requires access: read|write");
  }
  if (opts.access === "write" && !isWritableFsRoot(rootKey)) {
    throw rootNotWritableError(rootKey);
  }
  const allowed =
    rootKey === "workspace" || rootKey === "project" || rootKey.startsWith("mount:");
  if (!allowed) {
    throw new Error("invalid root");
  }
  const root = roots[rootKey];
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
