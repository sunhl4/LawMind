import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { createLawMindAgent } from "../../../src/lawmind/agent/index.js";
import type { AgentConfig } from "../../../src/lawmind/agent/types.js";
import { listSessions } from "../../../src/lawmind/agent/session.js";
import {
  buildMatterIndex,
  buildMatterOverview,
  createMatterIfAbsent,
  isValidMatterId,
  listMatterIds,
  listMatterOverviews,
  parseOptionalMatterId,
  searchMatterIndex,
  summarizeMatterIndex,
} from "../../../src/lawmind/cases/index.js";
import {
  listDrafts,
  readDraft,
  resolveDraftCitationIntegrity,
  type DraftCitationIntegrityView,
} from "../../../src/lawmind/drafts/index.js";
import {
  deriveInstructionTitle,
  listTaskCheckpoints,
  listTaskRecords,
  readTaskRecord,
} from "../../../src/lawmind/tasks/index.js";
import { isSafeTaskIdSegment } from "./safe-task-id.js";
import { listAssistantPresets } from "../../../src/lawmind/agent/assistant-presets.js";
import { resolveLawMindWebSearchApiKey } from "../../../src/lawmind/agent/tools/lawmind-web-search.js";
import {
  appendAssistantProfileMarkdown,
  buildReviewProfileLine,
  listAssistantProfileSections,
} from "../../../src/lawmind/assistants/profile-md.js";
import { buildAuditExportMarkdown, buildComplianceAuditMarkdown } from "../../../src/lawmind/audit/index.js";
import {
  appendLawyerProfileLearning,
  buildLawyerProfileReviewLearningLine,
} from "../../../src/lawmind/memory/index.js";
import { listBuiltInTemplates } from "../../../src/lawmind/templates/index.js";
import {
  cancelDelegation,
  getDelegation,
  listDelegations,
  readCollaborationEvents,
} from "../../../src/lawmind/agent/collaboration/index.js";
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
import { buildDoctorStats, tryReadOpenClawPackageVersion } from "./lawmind-health-payload.js";
import { sendJsonError } from "./lawmind-api-error.js";
import { isWebSearchForcedOffByPolicy, type LawMindPolicyState } from "./lawmind-policy.js";
import {
  LAWMIND_LOCAL_HOST,
  MAX_TEXT_READ_BYTES,
  buildAgentConfig,
  corsHeaders,
  filterTaskSummaries,
  getLawMindEngine,
  isLikelyBinary,
  normalizeRelPath,
  parseQueryTimeMs,
  readJsonBody,
  resolveDesktopActorId,
  resolveFsPath,
  resolveFsRoots,
  safeArtifactPath,
  safeOptionalProjectDir,
  sendJson,
  taskToSummary,
} from "./lawmind-server-helpers.js";

export type LawmindDispatchContext = {
  workspaceDir: string;
  envFile: string | undefined;
  userEnvPath: string;
  policy: LawMindPolicyState;
};

export async function lawmindHandleHttpRequest(
  ctx: LawmindDispatchContext,
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  const origin = req.headers.origin;
  const c = corsHeaders(typeof origin === "string" ? origin : undefined);

  if (req.method === "OPTIONS") {
    res.writeHead(204, c);
    res.end();
    return;
  }

  const url = new URL(req.url ?? "/", `http://${LAWMIND_LOCAL_HOST}`);
  const pathname = url.pathname;
  const { workspaceDir, envFile, userEnvPath, policy } = ctx;

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
        const lawMindRoot = resolveLawMindRoot(workspaceDir, envFile);
        const doctor = buildDoctorStats(workspaceDir);
        const openclawPackageVersion = tryReadOpenClawPackageVersion(repoRootRaw);
        sendJson(
          res,
          200,
          {
            ok: true,
            workspaceDir,
            lawMindRoot,
            modelConfigured: !error,
            missingApiKey: error === "missing_api_key",
            retrievalMode,
            dualLegalConfigured,
            webSearchApiKeyConfigured,
            doctor: {
              ...doctor,
              nodeVersion: process.version,
              openclawPackageVersion,
            },
            envHint: {
              userDataEnvPath: userEnvPath,
              userDataEnvExists: fs.existsSync(userEnvPath),
              repoEnvPath: repoEnvPath || null,
              repoEnvExists: repoEnvPath ? fs.existsSync(repoEnvPath) : false,
            },
            policy: policy.loaded
              ? {
                  loaded: true,
                  path: policy.path,
                  applied: policy.applied,
                  allowWebSearch: policy.policy.allowWebSearch ?? null,
                  retrievalMode: policy.policy.retrievalMode ?? null,
                  enableCollaboration: policy.policy.enableCollaboration ?? null,
                }
              : { loaded: false },
          },
          c,
        );
        return;
      }

      if (pathname === "/api/audit/export" && req.method === "GET") {
        const matterId = url.searchParams.get("matterId")?.trim() || undefined;
        const taskId = url.searchParams.get("taskId")?.trim() || undefined;
        const since = url.searchParams.get("since")?.trim() || undefined;
        const until = url.searchParams.get("until")?.trim() || undefined;
        if (matterId && !isValidMatterId(matterId)) {
          sendJson(res, 400, { ok: false, error: "invalid matter id" }, c);
          return;
        }
        const complianceRaw = url.searchParams.get("compliance")?.trim().toLowerCase() ?? "";
        const useCompliance = complianceRaw === "1" || complianceRaw === "true";
        const md = useCompliance
          ? await buildComplianceAuditMarkdown(workspaceDir, { matterId, taskId, since, until })
          : await buildAuditExportMarkdown(workspaceDir, { matterId, taskId, since, until });
        res.writeHead(200, {
          "content-type": "text/markdown; charset=utf-8",
          ...c,
        });
        res.end(md);
        return;
      }

      if (pathname === "/api/templates/built-in" && req.method === "GET") {
        sendJson(res, 200, { ok: true, templates: listBuiltInTemplates() }, c);
        return;
      }

      if (pathname === "/api/collaboration/summary" && req.method === "GET") {
        const collaborationEnabled =
          process.env.LAWMIND_ENABLE_COLLABORATION?.trim().toLowerCase() !== "false";
        const delegations = listDelegations();
        const events = readCollaborationEvents(workspaceDir).slice(-40);
        sendJson(
          res,
          200,
          {
            ok: true,
            collaborationEnabled,
            collaborationHint: collaborationEnabled
              ? "协作已开启：委派与事件会写入内存注册表与 workspace 审计（若存在）。"
              : "协作已关闭（LAWMIND_ENABLE_COLLABORATION=false）：不会注册多助手委派。",
            delegationCount: delegations.length,
            delegations: delegations.slice(-20).map((d) => ({
              delegationId: d.delegationId,
              fromAssistantId: d.fromAssistantId,
              toAssistantId: d.toAssistantId,
              status: d.status,
              matterId: d.matterId,
              startedAt: d.startedAt,
            })),
            recentCollaborationEvents: events,
          },
          c,
        );
        return;
      }

      if (pathname === "/api/lawyer-profile/learning" && req.method === "POST") {
        const body = (await readJsonBody(req)) as { note?: string; source?: string };
        const note = typeof body.note === "string" ? body.note.trim() : "";
        if (!note) {
          sendJson(res, 400, { ok: false, error: "note required" }, c);
          return;
        }
        const src = body.source?.trim().toLowerCase() === "manual" ? "manual" : "review";
        try {
          await appendLawyerProfileLearning(workspaceDir, note, src);
        } catch (e) {
          sendJson(
            res,
            500,
            {
              ok: false,
              error: e instanceof Error ? e.message : String(e),
            },
            c,
          );
          return;
        }
        sendJson(res, 200, { ok: true }, c);
        return;
      }

      if (pathname === "/api/chat" && req.method === "POST") {
        const body = (await readJsonBody(req)) as {
          message?: string;
          sessionId?: string;
          matterId?: string;
          assistantId?: string;
          allowWebSearch?: boolean;
          enableCollaboration?: boolean;
          /** Desktop: selected project folder (absolute path); passed to agent tools */
          projectDir?: string;
        };
        const message = typeof body.message === "string" ? body.message.trim() : "";
        if (!message) {
          sendJsonError(
            res,
            400,
            "message_required",
            "请输入对话内容后再发送。",
            c,
          );
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
          sendJsonError(
            res,
            500,
            "no_assistant_profile",
            "未找到助手配置。请在设置中创建助手或检查 LawMind 根目录下的 assistants.json。",
            c,
          );
          return;
        }

        const built = buildAgentConfig(workspaceDir);
        if (built.error === "missing_api_key") {
          sendJsonError(
            res,
            503,
            "missing_api_key",
            "未配置模型 API Key。请在用户目录 LawMind/.env.lawmind 或设置向导中填写 LAWMIND_QWEN_API_KEY 等变量。",
            c,
          );
          return;
        }

        const role = buildRoleDirectiveFromProfile(profile);
        let allowWebSearch = body.allowWebSearch === true;
        if (isWebSearchForcedOffByPolicy()) {
          allowWebSearch = false;
        }
        const enableCollaboration = body.enableCollaboration !== false && built.config.enableCollaboration !== false;
        const desktopActor = resolveDesktopActorId();
        const config: AgentConfig = {
          ...built.config,
          actorId: `${desktopActor}|asst:${profile.assistantId}`,
          assistantId: profile.assistantId,
          roleTitle: role.roleTitle,
          roleIntroduction: role.roleIntroduction,
          roleDirective: role.roleDirective,
          allowWebSearch,
          enableCollaboration,
        };

        let matterIdForChat: string | undefined;
        try {
          matterIdForChat = parseOptionalMatterId(body.matterId);
        } catch {
          sendJsonError(
            res,
            400,
            "invalid_matter_id",
            "案件 ID 格式不正确。请清空关联案件或按规则修改后再试。",
            c,
          );
          return;
        }

        const agent = createLawMindAgent(config);
        const hadSession = Boolean(body.sessionId?.trim());
        const projectDirForAgent = safeOptionalProjectDir(body.projectDir);
        try {
          const result = await agent.chat(message, {
            sessionId: body.sessionId,
            matterId: matterIdForChat,
            assistantId: profile.assistantId,
            allowWebSearch,
            projectDir: projectDirForAgent,
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
            sendJsonError(
              res,
              409,
              "session_assistant_mismatch",
              "该会话属于其他助手，请新开对话或清空会话后重试。",
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

      {
        const profileSec = pathname.match(/^\/api\/assistants\/([^/]+)\/profile-sections$/);
        if (profileSec && req.method === "GET") {
          const lawMindRoot = resolveLawMindRoot(workspaceDir, envFile);
          const id = decodeURIComponent(profileSec[1] ?? "");
          try {
            const sections = listAssistantProfileSections(lawMindRoot, id);
            sendJson(res, 200, { ok: true, assistantId: id, sections }, c);
          } catch (e) {
            if (e instanceof Error && e.message === "invalid assistant id") {
              sendJson(res, 400, { ok: false, error: "invalid assistant id" }, c);
              return;
            }
            throw e;
          }
          return;
        }
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
          sendJson(
            res,
            200,
            { ok: true, task: rec, checkpoints: listTaskCheckpoints(rec) },
            c,
          );
          return;
        }
      }

      {
        const draftReviewMatch = pathname.match(/^\/api\/drafts\/([^/]+)\/review$/);
        if (draftReviewMatch && req.method === "POST") {
          const raw = decodeURIComponent(draftReviewMatch[1] ?? "");
          if (!isSafeTaskIdSegment(raw)) {
            sendJson(res, 400, { ok: false, error: "invalid task id" }, c);
            return;
          }
          const body = (await readJsonBody(req)) as {
            status?: string;
            note?: string;
            /** 将审核说明追加到 assistants/<id>/PROFILE.md */
            appendToProfile?: boolean;
            /** 写入工作区 LAWYER_PROFILE.md「八、个人积累」 */
            appendToLawyerProfile?: boolean;
            /** 写入档案时使用的助手 ID（默认 default） */
            profileAssistantId?: string;
          };
          const st = body.status?.trim().toLowerCase();
          if (st !== "approved" && st !== "rejected" && st !== "modified") {
            sendJson(
              res,
              400,
              { ok: false, error: "status must be approved, rejected, or modified" },
              c,
            );
            return;
          }
          const draft = readDraft(workspaceDir, raw);
          if (!draft) {
            sendJson(res, 404, { ok: false, error: "not found" }, c);
            return;
          }
          const engine = getLawMindEngine(workspaceDir);
          const updated = await engine.review(draft, {
            status: st,
            note: typeof body.note === "string" ? body.note : undefined,
            actorId: resolveDesktopActorId(),
          });
          if (body.appendToProfile === true) {
            const lawMindRoot = resolveLawMindRoot(workspaceDir, envFile);
            const aid =
              typeof body.profileAssistantId === "string" && body.profileAssistantId.trim()
                ? body.profileAssistantId.trim()
                : DEFAULT_ASSISTANT_ID;
            const note = typeof body.note === "string" ? body.note : undefined;
            const line = buildReviewProfileLine(raw, st, note);
            try {
              appendAssistantProfileMarkdown(lawMindRoot, aid, line);
            } catch (e) {
              // PROFILE 写入失败不影响主流程，但让客户端知晓
              sendJson(res, 500, {
                ok: false,
                error: e instanceof Error ? e.message : String(e),
                draft: updated,
                profileAppendFailed: true,
              });
              return;
            }
          }
          if (body.appendToLawyerProfile === true) {
            const note = typeof body.note === "string" ? body.note : undefined;
            const line = buildLawyerProfileReviewLearningLine(raw, st, note);
            try {
              await appendLawyerProfileLearning(workspaceDir, line, "review");
            } catch (e) {
              sendJson(res, 500, {
                ok: false,
                error: e instanceof Error ? e.message : String(e),
                draft: updated,
                lawyerProfileAppendFailed: true,
              });
              return;
            }
          }
          sendJson(res, 200, {
            ok: true,
            draft: updated,
            citationIntegrity: resolveDraftCitationIntegrity(workspaceDir, updated),
          }, c);
          return;
        }

        const draftRenderMatch = pathname.match(/^\/api\/drafts\/([^/]+)\/render$/);
        if (draftRenderMatch && req.method === "POST") {
          const raw = decodeURIComponent(draftRenderMatch[1] ?? "");
          if (!isSafeTaskIdSegment(raw)) {
            sendJson(res, 400, { ok: false, error: "invalid task id" }, c);
            return;
          }
          const draft = readDraft(workspaceDir, raw);
          if (!draft) {
            sendJson(res, 404, { ok: false, error: "not found" }, c);
            return;
          }
          const engine = getLawMindEngine(workspaceDir);
          const result = await engine.render(draft);
          const refreshed = readDraft(workspaceDir, raw);
          const citationIntegrity = refreshed
            ? resolveDraftCitationIntegrity(workspaceDir, refreshed)
            : undefined;
          sendJson(res, result.ok ? 200 : 400, {
            ok: result.ok,
            ...result,
            ...(citationIntegrity ? { citationIntegrity } : {}),
          }, c);
          return;
        }

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
          const citationIntegrity = resolveDraftCitationIntegrity(workspaceDir, draft);
          sendJson(res, 200, { ok: true, draft, citationIntegrity }, c);
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

      if (pathname === "/api/matters/overviews" && req.method === "GET") {
        const overviews = await listMatterOverviews(workspaceDir);
        sendJson(res, 200, { ok: true, overviews }, c);
        return;
      }

      if (pathname === "/api/matters/create" && req.method === "POST") {
        const body = (await readJsonBody(req)) as { matterId?: string };
        const mid = typeof body.matterId === "string" ? body.matterId.trim() : "";
        if (!mid) {
          sendJson(res, 400, { ok: false, error: "matterId required" }, c);
          return;
        }
        try {
          const result = await createMatterIfAbsent(workspaceDir, mid);
          sendJson(res, 200, { ok: true, ...result }, c);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          sendJson(res, 400, { ok: false, error: msg }, c);
        }
        return;
      }

      if (pathname === "/api/matters/detail" && req.method === "GET") {
        const matterId = url.searchParams.get("matterId")?.trim() ?? "";
        if (!isValidMatterId(matterId)) {
          sendJson(res, 400, { ok: false, error: "invalid matter id" }, c);
          return;
        }
        const index = await buildMatterIndex(workspaceDir, matterId);
        const summary = summarizeMatterIndex(index);
        const overview = buildMatterOverview(index);
        const truncated = index.caseMemory.length > 120_000;
        const caseMemory = truncated
          ? `${index.caseMemory.slice(0, 120_000)}\n\n…[truncated]`
          : index.caseMemory;
        const draftCitationIntegrity: Record<string, DraftCitationIntegrityView> = {};
        for (const d of index.drafts) {
          draftCitationIntegrity[d.taskId] = resolveDraftCitationIntegrity(workspaceDir, d);
        }
        sendJson(
          res,
          200,
          {
            ok: true,
            matterId,
            summary,
            overview,
            caseMemory,
            caseMemoryTruncated: truncated,
            coreIssues: index.coreIssues,
            taskGoals: index.taskGoals,
            riskNotes: index.riskNotes,
            progressEntries: index.progressEntries,
            artifacts: index.artifacts,
            tasks: index.tasks,
            drafts: index.drafts,
            draftCitationIntegrity,
            auditEvents: index.auditEvents.slice(-80),
          },
          c,
        );
        return;
      }

      if (pathname === "/api/matters/search" && req.method === "GET") {
        const matterId = url.searchParams.get("matterId")?.trim() ?? "";
        const q = url.searchParams.get("q") ?? "";
        if (!isValidMatterId(matterId)) {
          sendJson(res, 400, { ok: false, error: "invalid matter id" }, c);
          return;
        }
        const index = await buildMatterIndex(workspaceDir, matterId);
        const hits = searchMatterIndex(index, q);
        sendJson(res, 200, { ok: true, matterId, query: q, hits: hits.slice(0, 60) }, c);
        return;
      }

      if (pathname === "/api/matters" && req.method === "GET") {
        const matterIds = await listMatterIds(workspaceDir);
        sendJson(res, 200, { ok: true, matterIds }, c);
        return;
      }

      if (pathname === "/api/drafts" && req.method === "GET") {
        const drafts = listDrafts(workspaceDir);
        sendJson(res, 200, { ok: true, drafts }, c);
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

      if (pathname === "/api/fs/tree" && req.method === "GET") {
        const roots = resolveFsRoots(workspaceDir);
        const root = url.searchParams.get("root") ?? "workspace";
        const relPath = url.searchParams.get("path") ?? "";
        const { full, rel } = resolveFsPath(roots, root, relPath);
        const stat = fs.statSync(full);
        if (!stat.isDirectory()) {
          sendJson(res, 400, { ok: false, error: "path is not directory" }, c);
          return;
        }
        const entries = fs
          .readdirSync(full, { withFileTypes: true })
          .map((entry) => {
            const childRel = normalizeRelPath(path.join(rel, entry.name));
            const childAbs = path.join(full, entry.name);
            const childStat = fs.statSync(childAbs);
            return {
              name: entry.name,
              path: childRel,
              kind: entry.isDirectory() ? "directory" : "file",
              size: entry.isDirectory() ? undefined : childStat.size,
              mtimeMs: childStat.mtimeMs,
            };
          })
          .toSorted((a, b) => {
            if (a.kind !== b.kind) {
              return a.kind === "directory" ? -1 : 1;
            }
            return a.name.localeCompare(b.name);
          });
        sendJson(res, 200, { ok: true, entries }, c);
        return;
      }

      if (pathname === "/api/fs/read" && req.method === "GET") {
        const roots = resolveFsRoots(workspaceDir);
        const root = url.searchParams.get("root") ?? "workspace";
        const relPath = url.searchParams.get("path") ?? "";
        const { full } = resolveFsPath(roots, root, relPath);
        const stat = fs.statSync(full);
        if (!stat.isFile()) {
          sendJson(res, 400, { ok: false, error: "path is not file" }, c);
          return;
        }
        if (stat.size > MAX_TEXT_READ_BYTES) {
          sendJson(res, 413, { ok: false, error: "file too large" }, c);
          return;
        }
        const buf = fs.readFileSync(full);
        if (isLikelyBinary(buf)) {
          sendJson(res, 415, { ok: false, error: "binary file is not supported" }, c);
          return;
        }
        sendJson(
          res,
          200,
          {
            ok: true,
            content: buf.toString("utf8"),
            size: stat.size,
            mtimeMs: stat.mtimeMs,
          },
          c,
        );
        return;
      }

      if (pathname === "/api/fs/write" && req.method === "POST") {
        const body = (await readJsonBody(req)) as {
          root?: string;
          path?: string;
          content?: string;
          expectedMtimeMs?: number;
        };
        const roots = resolveFsRoots(workspaceDir);
        const root = body.root ?? "workspace";
        const relPath = body.path ?? "";
        const content = typeof body.content === "string" ? body.content : "";
        const expectedMtimeMs =
          typeof body.expectedMtimeMs === "number" ? body.expectedMtimeMs : undefined;
        const { full } = resolveFsPath(roots, root, relPath);

        let priorMtime: number | undefined;
        if (fs.existsSync(full)) {
          const stat = fs.statSync(full);
          if (!stat.isFile()) {
            sendJson(res, 400, { ok: false, error: "path is not file" }, c);
            return;
          }
          priorMtime = stat.mtimeMs;
          if (expectedMtimeMs !== undefined && Math.abs(stat.mtimeMs - expectedMtimeMs) > 1) {
            sendJson(
              res,
              409,
              { ok: false, conflict: true, error: "file was modified externally", mtimeMs: stat.mtimeMs },
              c,
            );
            return;
          }
        } else {
          fs.mkdirSync(path.dirname(full), { recursive: true });
        }

        fs.writeFileSync(full, content, "utf8");
        const next = fs.statSync(full);
        sendJson(
          res,
          200,
          { ok: true, mtimeMs: next.mtimeMs, size: next.size, previousMtimeMs: priorMtime },
          c,
        );
        return;
      }

      // ── Collaboration endpoints ──

      if (pathname === "/api/delegations" && req.method === "GET") {
        const statusFilter = url.searchParams.get("status") ?? undefined;
        const assistantFilter = url.searchParams.get("assistantId") ?? undefined;
        const records = listDelegations({
          fromAssistantId: assistantFilter || undefined,
          status: statusFilter as "pending" | "running" | "completed" | "failed" | undefined,
        });
        sendJson(
          res,
          200,
          {
            ok: true,
            delegations: records.slice(0, 100).map((r) => ({
              delegationId: r.delegationId,
              fromAssistant: r.fromAssistantId,
              toAssistant: r.toAssistantId,
              task: r.task.slice(0, 200),
              status: r.status,
              priority: r.priority,
              result: r.result?.slice(0, 300),
              error: r.error,
              startedAt: r.startedAt,
              completedAt: r.completedAt,
            })),
            total: records.length,
          },
          c,
        );
        return;
      }

      {
        const delegationDetail = pathname.match(/^\/api\/delegations\/([^/]+)$/);
        if (delegationDetail && req.method === "GET") {
          const id = decodeURIComponent(delegationDetail[1] ?? "");
          const record = getDelegation(id);
          if (!record) {
            sendJson(res, 404, { ok: false, error: "delegation not found" }, c);
            return;
          }
          sendJson(res, 200, { ok: true, delegation: record }, c);
          return;
        }
        if (delegationDetail && req.method === "DELETE") {
          const id = decodeURIComponent(delegationDetail[1] ?? "");
          const record = cancelDelegation(workspaceDir, id);
          if (!record) {
            sendJson(res, 404, { ok: false, error: "delegation not found" }, c);
            return;
          }
          sendJson(res, 200, { ok: true, delegation: record }, c);
          return;
        }
      }

      if (pathname === "/api/collaboration-events" && req.method === "GET") {
        const since = url.searchParams.get("since") ?? undefined;
        let events = readCollaborationEvents(workspaceDir);
        if (since) {
          const sinceMs = Date.parse(since);
          if (Number.isFinite(sinceMs)) {
            events = events.filter((e) => Date.parse(e.timestamp) >= sinceMs);
          }
        }
        sendJson(
          res,
          200,
          {
            ok: true,
            events: events.slice(-200),
            total: events.length,
          },
          c,
        );
        return;
      }

      sendJson(res, 404, { ok: false, error: "not found" }, c);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    sendJson(res, 500, { ok: false, error: msg }, c);
  }
}
