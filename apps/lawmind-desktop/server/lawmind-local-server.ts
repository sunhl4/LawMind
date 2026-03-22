/**
 * LawMind local HTTP API for desktop shell (bind 127.0.0.1 only).
 *
 * Env:
 * - LAWMIND_WORKSPACE_DIR (required)
 * - LAWMIND_DESKTOP_PORT (required)
 * - LAWMIND_ENV_FILE (optional path to .env.lawmind)
 *
 * Run from monorepo root: node --import tsx apps/lawmind-desktop/server/lawmind-local-server.ts
 */

import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { createLawMindAgent } from "../../../src/lawmind/agent/index.js";
import type { AgentConfig } from "../../../src/lawmind/agent/types.js";
import { listSessions } from "../../../src/lawmind/agent/session.js";
import { listMatterIds } from "../../../src/lawmind/cases/index.js";
import { listDrafts } from "../../../src/lawmind/drafts/index.js";
import { deriveInstructionTitle, listTaskRecords, readTaskRecord } from "../../../src/lawmind/tasks/index.js";
import { readDraft } from "../../../src/lawmind/drafts/index.js";
import { isSafeTaskIdSegment } from "./safe-task-id.js";
import { loadLawMindEnv } from "../../../scripts/lawmind-env-loader.js";
import { listAssistantPresets } from "../../../src/lawmind/agent/assistant-presets.js";
import { resolveLawMindWebSearchApiKey } from "../../../src/lawmind/agent/tools/lawmind-web-search.js";
import {
  resolveLawMindRoot,
  loadAssistantProfiles,
  getAssistantById,
  upsertAssistant,
  deleteAssistant,
  buildRoleDirectiveFromProfile,
  bumpAssistantStats,
  loadAssistantStats,
  DEFAULT_ASSISTANT_ID,
} from "../../../src/lawmind/assistants/store.js";
import {
  createOpenSourceLegalAdaptersFromEnv,
  createPartnerLegalAdapterFromEnv,
} from "../../../src/lawmind/retrieval/providers.js";
import type { TaskRecord } from "../../../src/lawmind/types.js";

const HOST = "127.0.0.1";

function corsHeaders(origin: string | undefined): Record<string, string> {
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

function readJsonBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        if (!raw.trim()) {
          resolve({});
          return;
        }
        resolve(JSON.parse(raw) as unknown);
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

function sendJson(
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

function parsePositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) {
    return fallback;
  }
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function buildAgentConfig(workspaceDir: string): { config: AgentConfig; error?: string } {
  const defaultBaseUrl = "https://dashscope.aliyuncs.com/compatible-mode/v1";
  const modelTimeoutMs = parsePositiveIntEnv("LAWMIND_AGENT_TIMEOUT_MS", 120000);
  /** Single tool run (e.g. execute_workflow); default aligns with model HTTP timeout */
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

  if (!modelConfig.apiKey) {
    return {
      config: { workspaceDir, model: modelConfig, actorId: "lawyer" },
      error: "missing_api_key",
    };
  }

  return {
    config: {
      workspaceDir,
      model: modelConfig,
      maxToolCalls: 15,
      maxHistoryMessages: 50,
      toolExecutionTimeoutMs: toolTimeoutMs,
      actorId: "lawyer",
    },
  };
}

function isUnderWorkspace(workspaceRoot: string, candidate: string): boolean {
  const root = path.resolve(workspaceRoot);
  const abs = path.resolve(candidate);
  return abs === root || abs.startsWith(root + path.sep);
}

function safeArtifactPath(workspaceDir: string, rel: string): string | null {
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

function taskToSummary(t: TaskRecord) {
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

type TaskSummaryRow = ReturnType<typeof taskToSummary>;

function parseQueryTimeMs(value: string | null): number | null {
  if (!value?.trim()) {
    return null;
  }
  const t = Date.parse(value.trim());
  return Number.isFinite(t) ? t : null;
}

function filterTaskSummaries(
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

async function main() {
  const workspaceDir = process.env.LAWMIND_WORKSPACE_DIR?.trim();
  const portRaw = process.env.LAWMIND_DESKTOP_PORT?.trim();
  const envFileRaw = process.env.LAWMIND_ENV_FILE?.trim();
  const envFile = envFileRaw || undefined;

  if (!workspaceDir || !portRaw) {
    console.error("LAWMIND_WORKSPACE_DIR and LAWMIND_DESKTOP_PORT are required");
    process.exit(1);
  }

  const port = Number(portRaw);
  if (!Number.isFinite(port) || port < 1 || port > 65535) {
    console.error("Invalid LAWMIND_DESKTOP_PORT");
    process.exit(1);
  }

  fs.mkdirSync(workspaceDir, { recursive: true });

  const envDir = path.dirname(workspaceDir);
  const userEnvPath = envFile ? path.resolve(envFile) : path.resolve(envDir, ".env.lawmind");
  // Dev: same keys as CLI — load monorepo `.env.lawmind` first when LAWMIND_REPO_ROOT is set (Electron passes it).
  // Then load userData `LawMind/.env.lawmind` so the setup wizard / per-user file overrides repo keys.
  const repoRootRaw = process.env.LAWMIND_REPO_ROOT?.trim();
  if (repoRootRaw) {
    const repoRootAbs = path.resolve(repoRootRaw);
    const repoEnvPath = path.join(repoRootAbs, ".env.lawmind");
    if (fs.existsSync(repoEnvPath)) {
      loadLawMindEnv(repoRootAbs, undefined, { override: true });
    }
  }
  loadLawMindEnv(envDir, envFile);

  const server = http.createServer(async (req, res) => {
    const origin = req.headers.origin;
    const c = corsHeaders(typeof origin === "string" ? origin : undefined);

    if (req.method === "OPTIONS") {
      res.writeHead(204, c);
      res.end();
      return;
    }

    const url = new URL(req.url ?? "/", `http://${HOST}`);
    const pathname = url.pathname;

    try {
      if (pathname === "/api/health" && req.method === "GET") {
        const { error } = buildAgentConfig(workspaceDir);
        const repoRootRaw = process.env.LAWMIND_REPO_ROOT?.trim();
        const repoEnvPath = repoRootRaw
          ? path.join(path.resolve(repoRootRaw), ".env.lawmind")
          : "";
        const retrievalMode =
          process.env.LAWMIND_RETRIEVAL_MODE?.trim().toLowerCase() === "dual" ? "dual" : "single";
        const dualLegalConfigured =
          createOpenSourceLegalAdaptersFromEnv().length + createPartnerLegalAdapterFromEnv().length >
          0;
        const webSearchApiKeyConfigured = Boolean(resolveLawMindWebSearchApiKey());
        sendJson(
          res,
          200,
          {
            ok: true,
            workspaceDir,
            modelConfigured: !error,
            missingApiKey: error === "missing_api_key",
            retrievalMode,
            dualLegalConfigured,
            webSearchApiKeyConfigured,
            envHint: {
              userDataEnvPath: userEnvPath,
              userDataEnvExists: fs.existsSync(userEnvPath),
              repoEnvPath: repoEnvPath || null,
              repoEnvExists: repoEnvPath ? fs.existsSync(repoEnvPath) : false,
            },
          },
          c,
        );
        return;
      }

      if (pathname === "/api/chat" && req.method === "POST") {
        const body = (await readJsonBody(req)) as {
          message?: string;
          sessionId?: string;
          matterId?: string;
          assistantId?: string;
          allowWebSearch?: boolean;
        };
        const message = typeof body.message === "string" ? body.message.trim() : "";
        if (!message) {
          sendJson(res, 400, { ok: false, error: "message required" }, c);
          return;
        }

        const lawMindRoot = resolveLawMindRoot(workspaceDir, envFile);
        const assistantIdRaw = typeof body.assistantId === "string" ? body.assistantId.trim() : "";
        const assistantKey = assistantIdRaw || DEFAULT_ASSISTANT_ID;
        let profile =
          getAssistantById(lawMindRoot, assistantKey) ??
          getAssistantById(lawMindRoot, DEFAULT_ASSISTANT_ID);
        if (!profile) {
          const all = loadAssistantProfiles(lawMindRoot);
          profile = all[0];
        }
        if (!profile) {
          sendJson(res, 500, { ok: false, error: "no assistant profile" }, c);
          return;
        }

        const built = buildAgentConfig(workspaceDir);
        if (built.error === "missing_api_key") {
          sendJson(
            res,
            503,
            {
              ok: false,
              error:
                "Model API key not configured. Set LAWMIND_QWEN_API_KEY in .env.lawmind next to workspace.",
            },
            c,
          );
          return;
        }

        const role = buildRoleDirectiveFromProfile(profile);
        const allowWebSearch = body.allowWebSearch === true;
        const config: AgentConfig = {
          ...built.config,
          actorId: `assistant:${profile.assistantId}`,
          assistantId: profile.assistantId,
          roleTitle: role.roleTitle,
          roleIntroduction: role.roleIntroduction,
          roleDirective: role.roleDirective,
          allowWebSearch,
        };

        const agent = createLawMindAgent(config);
        const hadSession = Boolean(body.sessionId?.trim());
        try {
          const result = await agent.chat(message, {
            sessionId: body.sessionId,
            matterId: body.matterId,
            assistantId: profile.assistantId,
            allowWebSearch,
          });
          bumpAssistantStats(lawMindRoot, profile.assistantId, {
            newSession: !hadSession,
            turn: true,
          });
          sendJson(
            res,
            200,
            {
              ok: true,
              reply: result.reply,
              sessionId: result.sessionId,
              assistantId: profile.assistantId,
              toolCalls: result.turn.toolCallsExecuted,
              status: result.turn.status,
              taskId: result.turn.turnId,
              taskTitle: deriveInstructionTitle(message),
            },
            c,
          );
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (msg === "session_assistant_mismatch") {
            sendJson(
              res,
              409,
              {
                ok: false,
                error: "session_assistant_mismatch",
                detail: "该会话属于其他助手，请新开对话或清空会话后重试。",
              },
              c,
            );
            return;
          }
          throw err;
        }
        return;
      }

      if (pathname === "/api/assistant-presets" && req.method === "GET") {
        sendJson(res, 200, { ok: true, presets: listAssistantPresets() }, c);
        return;
      }

      if (pathname === "/api/assistants" && req.method === "GET") {
        const lawMindRoot = resolveLawMindRoot(workspaceDir, envFile);
        const profiles = loadAssistantProfiles(lawMindRoot);
        const stats = loadAssistantStats(lawMindRoot);
        const assistants = profiles.map((p) => ({
          ...p,
          stats: stats[p.assistantId] ?? {
            lastUsedAt: "",
            turnCount: 0,
            sessionCount: 0,
          },
        }));
        sendJson(res, 200, { ok: true, assistants, presets: listAssistantPresets() }, c);
        return;
      }

      if (pathname === "/api/assistants" && req.method === "POST") {
        const lawMindRoot = resolveLawMindRoot(workspaceDir, envFile);
        const body = (await readJsonBody(req)) as Record<string, unknown>;
        const assistant = upsertAssistant(lawMindRoot, {
          assistantId: typeof body.assistantId === "string" ? body.assistantId : undefined,
          displayName: typeof body.displayName === "string" ? body.displayName : undefined,
          introduction: typeof body.introduction === "string" ? body.introduction : undefined,
          presetKey: typeof body.presetKey === "string" ? body.presetKey : undefined,
          customRoleTitle: typeof body.customRoleTitle === "string" ? body.customRoleTitle : undefined,
          customRoleInstructions:
            typeof body.customRoleInstructions === "string" ? body.customRoleInstructions : undefined,
        });
        sendJson(res, 200, { ok: true, assistant }, c);
        return;
      }

      {
        const assistantPath = pathname.match(/^\/api\/assistants\/([^/]+)$/);
        if (assistantPath && req.method === "PATCH") {
          const lawMindRoot = resolveLawMindRoot(workspaceDir, envFile);
          const id = decodeURIComponent(assistantPath[1] ?? "");
          const body = (await readJsonBody(req)) as Record<string, unknown>;
          const assistant = upsertAssistant(lawMindRoot, {
            assistantId: id,
            displayName: typeof body.displayName === "string" ? body.displayName : undefined,
            introduction: typeof body.introduction === "string" ? body.introduction : undefined,
            presetKey: typeof body.presetKey === "string" ? body.presetKey : undefined,
            customRoleTitle: typeof body.customRoleTitle === "string" ? body.customRoleTitle : undefined,
            customRoleInstructions:
              typeof body.customRoleInstructions === "string" ? body.customRoleInstructions : undefined,
          });
          sendJson(res, 200, { ok: true, assistant }, c);
          return;
        }
        if (assistantPath && req.method === "DELETE") {
          const lawMindRoot = resolveLawMindRoot(workspaceDir, envFile);
          const id = decodeURIComponent(assistantPath[1] ?? "");
          const ok = deleteAssistant(lawMindRoot, id);
          if (!ok) {
            sendJson(res, 400, { ok: false, error: "cannot delete default or unknown assistant" }, c);
            return;
          }
          sendJson(res, 200, { ok: true }, c);
          return;
        }
      }

      {
        const taskDetailMatch = pathname.match(/^\/api\/tasks\/([^/]+)$/);
        if (taskDetailMatch && req.method === "GET") {
          const raw = decodeURIComponent(taskDetailMatch[1] ?? "");
          if (!isSafeTaskIdSegment(raw)) {
            sendJson(res, 400, { ok: false, error: "invalid task id" }, c);
            return;
          }
          const rec = readTaskRecord(workspaceDir, raw);
          if (!rec) {
            sendJson(res, 404, { ok: false, error: "not found" }, c);
            return;
          }
          sendJson(res, 200, { ok: true, task: rec }, c);
          return;
        }
      }

      {
        const draftDetailMatch = pathname.match(/^\/api\/drafts\/([^/]+)$/);
        if (draftDetailMatch && req.method === "GET") {
          const raw = decodeURIComponent(draftDetailMatch[1] ?? "");
          if (!isSafeTaskIdSegment(raw)) {
            sendJson(res, 400, { ok: false, error: "invalid task id" }, c);
            return;
          }
          const draft = readDraft(workspaceDir, raw);
          if (!draft) {
            sendJson(res, 404, { ok: false, error: "not found" }, c);
            return;
          }
          sendJson(res, 200, { ok: true, draft }, c);
          return;
        }
      }

      if (pathname === "/api/tasks" && req.method === "GET") {
        const q = url.searchParams.get("q") ?? "";
        const since = parseQueryTimeMs(url.searchParams.get("since"));
        const until = parseQueryTimeMs(url.searchParams.get("until"));
        const rows = listTaskRecords(workspaceDir).map(taskToSummary);
        const tasks = filterTaskSummaries(rows, q, since, until);
        sendJson(res, 200, { ok: true, tasks }, c);
        return;
      }

      if (pathname === "/api/sessions" && req.method === "GET") {
        const sessions = listSessions(workspaceDir).map((s) => ({
          sessionId: s.sessionId,
          matterId: s.matterId,
          assistantId: s.assistantId,
          createdAt: s.createdAt,
          updatedAt: s.updatedAt,
          turnCount: s.turns.length,
        }));
        sendJson(res, 200, { ok: true, sessions }, c);
        return;
      }

      if (pathname === "/api/matters" && req.method === "GET") {
        const matterIds = await listMatterIds(workspaceDir);
        sendJson(res, 200, { ok: true, matterIds }, c);
        return;
      }

      if (pathname === "/api/history" && req.method === "GET") {
        const tasks = listTaskRecords(workspaceDir);
        const drafts = listDrafts(workspaceDir);
        const items: Array<{
          kind: "task" | "draft";
          id: string;
          label: string;
          updatedAt: string;
          createdAt?: string;
          status?: string;
          outputPath?: string;
          matterId?: string;
          taskRecordKind?: string;
        }> = [];

        for (const t of tasks) {
          const display = (t.title?.trim() ? t.title : t.summary).slice(0, 120);
          items.push({
            kind: "task",
            id: t.taskId,
            label: display,
            updatedAt: t.updatedAt,
            createdAt: t.createdAt,
            status: t.status,
            outputPath: t.outputPath,
            matterId: t.matterId,
            taskRecordKind: t.kind,
          });
        }
        for (const d of drafts) {
          items.push({
            kind: "draft",
            id: d.taskId,
            label: d.title,
            updatedAt: d.createdAt,
            status: d.reviewStatus,
            outputPath: d.outputPath,
            matterId: d.matterId,
          });
        }
        items.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
        sendJson(res, 200, { ok: true, items: items.slice(0, 200) }, c);
        return;
      }

      if (pathname === "/api/artifact" && req.method === "GET") {
        const rel = url.searchParams.get("path") ?? "";
        const full = safeArtifactPath(workspaceDir, rel);
        if (!full || !fs.existsSync(full)) {
          sendJson(res, 404, { ok: false, error: "not found" }, c);
          return;
        }
        const buf = await fs.promises.readFile(full);
        res.writeHead(200, {
          "content-type": "application/octet-stream",
          "content-disposition": `inline; filename="${path.basename(full)}"`,
          ...c,
        });
        res.end(buf);
        return;
      }

      sendJson(res, 404, { ok: false, error: "not found" }, c);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      sendJson(res, 500, { ok: false, error: msg }, c);
    }
  });

  server.listen(port, HOST, () => {
    console.error(`[lawmind-local-server] http://${HOST}:${port} workspace=${workspaceDir}`);
  });
}

void main();
