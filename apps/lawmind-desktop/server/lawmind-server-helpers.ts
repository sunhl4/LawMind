/**
 * Shared HTTP helpers and path utilities for the LawMind desktop local API.
 */

import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { createLawMindEngine } from "../../../src/lawmind/index.js";
import { buildLawMindRetrievalAdaptersFromEnvForTest } from "../../../src/lawmind/agent/tools/engine-tools.js";
import type { AgentConfig } from "../../../src/lawmind/agent/types.js";
import { resolveEdition } from "../../../src/lawmind/policy/edition.js";
import type { LawMindWorkspacePolicy } from "../../../src/lawmind/policy/workspace-policy.js";
import { resolveAgentMaxToolCallsPerTurn } from "../../../src/lawmind/policy/workspace-policy.js";
import { readLawMindPolicyFile } from "./lawmind-policy.js";
import type { TaskRecord } from "../../../src/lawmind/types.js";

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

/** Desktop operator identity for audit/review (see docs/LAWMIND-ACTOR-ATTRIBUTION). */
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
    origin?.startsWith("http://localhost:") ||
    origin?.startsWith("http://127.0.0.1:") ||
    origin?.startsWith("file://")
      ? origin
      : "http://127.0.0.1:5174";
  return {
    "access-control-allow-origin": allow,
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "Content-Type",
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

export function buildAgentConfig(workspaceDir: string): { config: AgentConfig; error?: string } {
  const defaultBaseUrl = "https://dashscope.aliyuncs.com/compatible-mode/v1";
  const modelTimeoutMs = parsePositiveIntEnv("LAWMIND_AGENT_TIMEOUT_MS", 120000);
  const toolTimeoutMs = parsePositiveIntEnv("LAWMIND_TOOL_TIMEOUT_MS", modelTimeoutMs);
  const modelConfig = {
    provider: "openai-compatible" as const,
    baseUrl:
      process.env.LAWMIND_AGENT_BASE_URL ??
      process.env.QWEN_BASE_URL ??
      process.env.LAWMIND_QWEN_BASE_URL ??
      defaultBaseUrl,
    apiKey:
      process.env.LAWMIND_AGENT_API_KEY ??
      process.env.QWEN_API_KEY ??
      process.env.LAWMIND_QWEN_API_KEY ??
      "",
    model:
      process.env.LAWMIND_AGENT_MODEL ??
      process.env.QWEN_MODEL ??
      process.env.LAWMIND_QWEN_MODEL ??
      "qwen-plus",
    maxTokens: 4096,
    temperature: 0.3,
    timeoutMs: modelTimeoutMs,
  };

  const actorId = resolveDesktopActorId();

  if (!modelConfig.apiKey) {
    return {
      config: { workspaceDir, model: modelConfig, actorId },
      error: "missing_api_key",
    };
  }

  const enableCollaboration = process.env.LAWMIND_ENABLE_COLLABORATION?.trim().toLowerCase() !== "false";
  const maxToolCalls = resolveAgentMaxToolCallsPerTurn(workspaceDir);
  const policyState = readLawMindPolicyFile(workspaceDir);
  const policyForEdition: LawMindWorkspacePolicy | null = policyState.loaded
    ? (policyState.policy as LawMindWorkspacePolicy)
    : null;
  const edition = resolveEdition({ policy: policyForEdition });
  const allowDangerousRaw =
    process.env.LAWMIND_ALLOW_DANGEROUS_TOOLS_WITHOUT_APPROVAL?.trim().toLowerCase() ?? "";
  const allowDangerousToolsWithoutApproval =
    allowDangerousRaw === "true" || allowDangerousRaw === "1";

  return {
    config: {
      workspaceDir,
      model: modelConfig,
      maxToolCalls,
      maxHistoryMessages: 50,
      toolExecutionTimeoutMs: toolTimeoutMs,
      actorId,
      enableCollaboration,
      allowDangerousToolsWithoutApproval,
      strictDangerousToolApproval: edition.features.strictDangerousToolApproval,
    },
  };
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
    summary: t.summary,
    title: t.title,
    kind: t.kind,
    status: t.status,
    output: t.output,
    riskLevel: t.riskLevel,
    matterId: t.matterId,
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
