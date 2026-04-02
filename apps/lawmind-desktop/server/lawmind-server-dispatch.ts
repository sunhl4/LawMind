import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { createLawMindAgent } from "../../../src/lawmind/agent/index.js";
import type { AgentConfig, AgentTurn } from "../../../src/lawmind/agent/types.js";
import { listAssistantPresets } from "../../../src/lawmind/agent/assistant-presets.js";
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
  listApprovalRequests,
  listWorkQueueItems,
} from "../../../src/lawmind/application/services/queue-service.js";
import {
  listDrafts,
  readDraft,
  readReasoningSnapshot,
  resolveDraftCitationIntegrity,
  type DraftCitationIntegrityView,
} from "../../../src/lawmind/drafts/index.js";
import {
  adoptLearningSuggestion,
  dismissLearningSuggestion,
  listLearningSuggestions,
} from "../../../src/lawmind/learning/suggestion-queue.js";
import { buildAgentMemorySourceReport } from "../../../src/lawmind/memory/index.js";
import { parseReviewLabels } from "../../../src/lawmind/review-labels.js";
import { serializeLegalReasoningGraph } from "../../../src/lawmind/reasoning/index.js";
import {
  deriveInstructionTitle,
  listTaskCheckpoints,
  listTaskRecords,
  readTaskRecord,
} from "../../../src/lawmind/tasks/index.js";
import { isSafeTaskIdSegment } from "./safe-task-id.js";
import { resolveLawMindWebSearchApiKey } from "../../../src/lawmind/agent/tools/lawmind-web-search.js";
import {
  appendAssistantProfileMarkdown,
  buildReviewProfileLine,
  listAssistantProfileSections,
} from "../../../src/lawmind/assistants/profile-md.js";
import { buildAuditExportMarkdown, buildComplianceAuditMarkdown, emit } from "../../../src/lawmind/audit/index.js";
import {
  appendCaseArtifact,
  appendCaseCoreIssue,
  appendCaseRiskNote,
  appendCaseTaskGoal,
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

/** 按模型实际调用顺序列出每个工具名（一步一条，同名可重复），供桌面端分步展示。 */
function toolCallSequenceFromTurn(turn: AgentTurn): string[] {
  const out: string[] = [];
  for (const m of turn.messages) {
    if (m.role !== "assistant" || !m.toolCalls?.length) {
      continue;
    }
    for (const tc of m.toolCalls) {
      out.push(tc.name);
    }
  }
  return out;
}

type MemoryAdoptionRecord = {
  target: "lawyer" | "assistant";
  stamp: string;
  body: string;
};

type MatterInteractionAction = "open_review" | "save_upgrade_suggestion" | "write_case_note";

type MatterInteractionParsed = {
  action: MatterInteractionAction | "unknown";
  surface?: string;
  label?: string;
};

function listLawyerProfileAdoptions(workspaceDir: string): MemoryAdoptionRecord[] {
  const p = path.join(workspaceDir, "LAWYER_PROFILE.md");
  try {
    const raw = fs.readFileSync(p, "utf8");
    return raw
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.includes("认知升级建议："))
      .map((line) => {
        const m = /^-\s+\[([^\]]+)\]\s+\[source:[^\]]+\]\s+(.+)$/.exec(line);
        return {
          target: "lawyer" as const,
          stamp: m?.[1]?.trim() ?? "",
          body: m?.[2]?.trim() ?? line,
        };
      });
  } catch {
    return [];
  }
}

function resolveMatterInteractionTaskId(
  workspaceDir: string,
  matterId: string,
  preferredTaskId?: string,
): string | null {
  const tasks = listTaskRecords(workspaceDir)
    .filter((task) => task.matterId === matterId)
    .toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  if (preferredTaskId && tasks.some((task) => task.taskId === preferredTaskId)) {
    return preferredTaskId;
  }
  return tasks[0]?.taskId ?? null;
}

function describeMatterInteraction(params: {
  action: MatterInteractionAction;
  surface?: string;
  label?: string;
  target?: "lawyer" | "assistant";
  variant?: "conservative" | "standard" | "assertive";
  section?: "core_issue" | "risk" | "artifact" | "task_goal";
}): string {
  const surface = params.surface?.trim() || "matter-workbench";
  const label = params.label?.trim() || "未命名动作";
  if (params.action === "open_review") {
    return `案件工作台动作：从 ${surface} 进入审核台；来源 ${label}。`;
  }
  if (params.action === "save_upgrade_suggestion") {
    const targetLabel = params.target === "assistant" ? "助手档案" : "律师档案";
    return `案件工作台动作：从 ${surface} 采纳认知升级建议并写入${targetLabel}；建议 ${label}。`;
  }
  const sectionLabel =
    params.section === "artifact"
      ? "生成产物"
      : params.section === "task_goal"
        ? "当前任务目标"
        : params.section === "core_issue"
          ? "核心争点"
          : "风险与待确认";
  const variantLabel =
    params.variant === "conservative"
      ? "保守版"
      : params.variant === "assertive"
        ? "强化版"
        : "标准版";
  return `案件工作台动作：从 ${surface} 写回 CASE 档案；section ${sectionLabel}；版本 ${variantLabel}；主题 ${label}。`;
}

function parseMatterInteractionDetail(detail?: string): MatterInteractionParsed {
  const raw = detail?.trim() ?? "";
  const reviewMatch = /^案件工作台动作：从 (.+?) 进入审核台；来源 (.+)。$/.exec(raw);
  if (reviewMatch) {
    return {
      action: "open_review",
      surface: reviewMatch[1]?.trim(),
      label: reviewMatch[2]?.trim(),
    };
  }
  const memoryMatch = /^案件工作台动作：从 (.+?) 采纳认知升级建议并写入(?:律师档案|助手档案)；建议 (.+)。$/.exec(
    raw,
  );
  if (memoryMatch) {
    return {
      action: "save_upgrade_suggestion",
      surface: memoryMatch[1]?.trim(),
      label: memoryMatch[2]?.trim(),
    };
  }
  const caseMatch = /^案件工作台动作：从 (.+?) 写回 CASE 档案；section .+?；版本 .+?；主题 (.+)。$/.exec(raw);
  if (caseMatch) {
    return {
      action: "write_case_note",
      surface: caseMatch[1]?.trim(),
      label: caseMatch[2]?.trim(),
    };
  }
  return { action: "unknown" };
}

async function buildMatterInteractionRollup(workspaceDir: string): Promise<{
  totalMatterCount: number;
  items: Array<{
    key: string;
    title: string;
    matterCount: number;
    totalEvents: number;
    latestAt?: string;
    exampleMatterIds: string[];
  }>;
}> {
  const matterIds = await listMatterIds(workspaceDir);
  const indexes = await Promise.all(matterIds.map((matterId) => buildMatterIndex(workspaceDir, matterId)));
  const buckets = new Map<
    string,
    { title: string; matterIds: Set<string>; totalEvents: number; latestAt?: string }
  >();
  for (const index of indexes) {
    const interactions = index.auditEvents
      .filter((event) => event.kind === "ui.matter_action")
      .map((event) => ({ event, parsed: parseMatterInteractionDetail(event.detail) }));
    if (interactions.length === 0) {
      continue;
    }
    const reviewOpenCount = interactions.filter((item) => item.parsed.action === "open_review").length;
    const caseWriteCount = interactions.filter((item) => item.parsed.action === "write_case_note").length;
    const memorySaveCount = interactions.filter((item) => item.parsed.action === "save_upgrade_suggestion").length;
    const surfaceCounts = new Map<string, number>();
    for (const item of interactions) {
      if (item.parsed.surface) {
        surfaceCounts.set(item.parsed.surface, (surfaceCounts.get(item.parsed.surface) ?? 0) + 1);
      }
    }
    const dominantSurface = Array.from(surfaceCounts.entries())
      .map(([surface, count]) => ({ surface, count }))
      .toSorted((a, b) => (b.count - a.count) || a.surface.localeCompare(b.surface, "zh-CN"))[0];
    const themes: Array<{ key: string; title: string; totalEvents: number }> = [];
    if (reviewOpenCount >= 3) {
      themes.push({
        key: "adapt-review-surface",
        title: "把审核决策前置到概览",
        totalEvents: reviewOpenCount,
      });
    }
    if (
      caseWriteCount >= 2 ||
      dominantSurface?.surface === "blocked-by" ||
      dominantSurface?.surface === "case-focus"
    ) {
      themes.push({
        key: "adapt-case-form",
        title: "为 CASE 补录增加结构化表单",
        totalEvents: caseWriteCount || dominantSurface?.count || 0,
      });
    }
    if (memorySaveCount >= 2) {
      themes.push({
        key: "adapt-memory-fastlane",
        title: "把认知升级做成快捷采纳通道",
        totalEvents: memorySaveCount,
      });
    }
    if (themes.length === 0 && dominantSurface && dominantSurface.count >= 3) {
      themes.push({
        key: "adapt-default-focus",
        title: "默认视图可能需要重新排序",
        totalEvents: dominantSurface.count,
      });
    }
    for (const theme of themes) {
      const current = buckets.get(theme.key) ?? {
        title: theme.title,
        matterIds: new Set<string>(),
        totalEvents: 0,
        latestAt: undefined,
      };
      current.matterIds.add(index.matterId);
      current.totalEvents += theme.totalEvents;
      const latest = interactions.map((item) => item.event.timestamp).filter(Boolean).toSorted().at(-1);
      if (latest && (!current.latestAt || latest > current.latestAt)) {
        current.latestAt = latest;
      }
      buckets.set(theme.key, current);
    }
  }
  return {
    totalMatterCount: matterIds.length,
    items: Array.from(buckets.entries())
      .map(([key, meta]) => ({
        key,
        title: meta.title,
        matterCount: meta.matterIds.size,
        totalEvents: meta.totalEvents,
        latestAt: meta.latestAt,
        exampleMatterIds: Array.from(meta.matterIds).toSorted().slice(0, 3),
      }))
      .toSorted((a, b) => (b.matterCount - a.matterCount) || (b.totalEvents - a.totalEvents) || a.title.localeCompare(b.title, "zh-CN"))
      .slice(0, 6),
  };
}

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

      if (pathname === "/api/memory/sources" && req.method === "GET") {
        const matterId = url.searchParams.get("matterId")?.trim() || undefined;
        const assistantId = url.searchParams.get("assistantId")?.trim() || undefined;
        const lawMindRoot = resolveLawMindRoot(workspaceDir, envFile);
        const memorySources = await buildAgentMemorySourceReport(workspaceDir, {
          matterId,
          assistantId,
          lawMindRoot,
        });
        sendJson(res, 200, { ok: true, memorySources }, c);
        return;
      }

      if (pathname === "/api/learning/suggestions" && req.method === "GET") {
        const filter = url.searchParams.get("filter") === "all" ? "all" : "pending";
        const suggestions = await listLearningSuggestions(workspaceDir, filter);
        sendJson(res, 200, { ok: true, suggestions }, c);
        return;
      }

      {
        const adoptMatch = pathname.match(/^\/api\/learning\/suggestions\/([^/]+)\/adopt$/);
        if (adoptMatch && req.method === "POST") {
          const id = decodeURIComponent(adoptMatch[1] ?? "");
          if (!id) {
            sendJson(res, 400, { ok: false, error: "id required" }, c);
            return;
          }
          const auditDir = path.join(workspaceDir, "audit");
          const result = await adoptLearningSuggestion(workspaceDir, auditDir, id);
          if (!result.ok) {
            sendJson(res, 400, { ok: false, error: result.error ?? "adopt failed" }, c);
            return;
          }
          sendJson(res, 200, { ok: true }, c);
          return;
        }
      }

      {
        const dismissMatch = pathname.match(/^\/api\/learning\/suggestions\/([^/]+)\/dismiss$/);
        if (dismissMatch && req.method === "POST") {
          const id = decodeURIComponent(dismissMatch[1] ?? "");
          if (!id) {
            sendJson(res, 400, { ok: false, error: "id required" }, c);
            return;
          }
          const auditDir = path.join(workspaceDir, "audit");
          const result = await dismissLearningSuggestion(workspaceDir, auditDir, id);
          if (!result.ok) {
            sendJson(res, 400, { ok: false, error: result.error ?? "dismiss failed" }, c);
            return;
          }
          sendJson(res, 200, { ok: true }, c);
          return;
        }
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

      if (pathname === "/api/assistants/profile/learning" && req.method === "POST") {
        const body = (await readJsonBody(req)) as { assistantId?: string; note?: string };
        const assistantId = typeof body.assistantId === "string" ? body.assistantId.trim() : "";
        const note = typeof body.note === "string" ? body.note.trim() : "";
        if (!assistantId) {
          sendJson(res, 400, { ok: false, error: "assistantId required" }, c);
          return;
        }
        if (!note) {
          sendJson(res, 400, { ok: false, error: "note required" }, c);
          return;
        }
        try {
          const lawMindRoot = resolveLawMindRoot(workspaceDir, envFile);
          appendAssistantProfileMarkdown(lawMindRoot, assistantId, note);
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

      if (pathname === "/api/memory/adoptions" && req.method === "GET") {
        const assistantId = url.searchParams.get("assistantId")?.trim() || "";
        const lawMindRoot = resolveLawMindRoot(workspaceDir, envFile);
        const lawyer = listLawyerProfileAdoptions(workspaceDir);
        const assistant = assistantId
          ? listAssistantProfileSections(lawMindRoot, assistantId)
              .filter((section) => section.body.includes("认知升级建议："))
              .map((section) => ({
                target: "assistant" as const,
                stamp: section.stamp,
                body: section.body,
              }))
          : [];
        const items = [...lawyer, ...assistant]
          .toSorted((a, b) => b.stamp.localeCompare(a.stamp))
          .slice(0, 40);
        sendJson(res, 200, { ok: true, items }, c);
        return;
      }

      if (pathname === "/api/matters/case-note" && req.method === "POST") {
        const body = (await readJsonBody(req)) as {
          matterId?: string;
          section?: "core_issue" | "risk" | "artifact" | "task_goal";
          note?: string;
        };
        const matterId = typeof body.matterId === "string" ? body.matterId.trim() : "";
        const section = typeof body.section === "string" ? body.section.trim() : "";
        const note = typeof body.note === "string" ? body.note.trim() : "";
        if (!isValidMatterId(matterId)) {
          sendJson(res, 400, { ok: false, error: "invalid matter id" }, c);
          return;
        }
        if (!note) {
          sendJson(res, 400, { ok: false, error: "note required" }, c);
          return;
        }
        if (!["core_issue", "risk", "artifact", "task_goal"].includes(section)) {
          sendJson(res, 400, { ok: false, error: "invalid section" }, c);
          return;
        }
        if (section === "core_issue") {
          await appendCaseCoreIssue(workspaceDir, matterId, note);
        } else if (section === "risk") {
          await appendCaseRiskNote(workspaceDir, matterId, note);
        } else if (section === "artifact") {
          await appendCaseArtifact(workspaceDir, matterId, note);
        } else {
          await appendCaseTaskGoal(workspaceDir, matterId, note);
        }
        sendJson(res, 200, { ok: true }, c);
        return;
      }

      if (pathname === "/api/matters/interaction" && req.method === "POST") {
        const body = (await readJsonBody(req)) as {
          matterId?: string;
          taskId?: string;
          action?: MatterInteractionAction;
          surface?: string;
          label?: string;
          target?: "lawyer" | "assistant";
          variant?: "conservative" | "standard" | "assertive";
          section?: "core_issue" | "risk" | "artifact" | "task_goal";
        };
        const matterId = typeof body.matterId === "string" ? body.matterId.trim() : "";
        const taskId = typeof body.taskId === "string" ? body.taskId.trim() : "";
        const action = typeof body.action === "string" ? body.action.trim() : "";
        if (!isValidMatterId(matterId)) {
          sendJson(res, 400, { ok: false, error: "invalid matter id" }, c);
          return;
        }
        if (!["open_review", "save_upgrade_suggestion", "write_case_note"].includes(action)) {
          sendJson(res, 400, { ok: false, error: "invalid action" }, c);
          return;
        }
        const resolvedTaskId = resolveMatterInteractionTaskId(workspaceDir, matterId, taskId);
        if (!resolvedTaskId) {
          sendJson(res, 400, { ok: false, error: "no task found for matter" }, c);
          return;
        }
        const event = await emit(path.join(workspaceDir, "audit"), {
          taskId: resolvedTaskId,
          kind: "ui.matter_action",
          actor: "lawyer",
          actorId: resolveDesktopActorId(),
          detail: describeMatterInteraction({
            action: action as MatterInteractionAction,
            surface: typeof body.surface === "string" ? body.surface : undefined,
            label: typeof body.label === "string" ? body.label : undefined,
            target: body.target === "assistant" ? "assistant" : body.target === "lawyer" ? "lawyer" : undefined,
            variant:
              body.variant === "conservative" || body.variant === "assertive" || body.variant === "standard"
                ? body.variant
                : undefined,
            section:
              body.section === "artifact" ||
              body.section === "core_issue" ||
              body.section === "risk" ||
              body.section === "task_goal"
                ? body.section
                : undefined,
          }),
        });
        sendJson(res, 200, { ok: true, taskId: resolvedTaskId, event }, c);
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
          const memorySources = await buildAgentMemorySourceReport(workspaceDir, {
            matterId: matterIdForChat,
            assistantId: profile.assistantId,
            lawMindRoot,
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
              toolCallSequence: toolCallSequenceFromTurn(result.turn),
              status: result.turn.status,
              taskId: result.turn.turnId,
              taskTitle: deriveInstructionTitle(message),
              memorySources,
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
            /** 结构化审核标签（与引擎一致） */
            labels?: unknown;
            /** 为 true 时标签先入学习队列，不立即写回 PROFILE（与 append* 互斥建议） */
            deferMemoryWrites?: boolean;
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
          const labels = parseReviewLabels(body.labels);
          const deferQueue = body.deferMemoryWrites === true;
          const lawMindRootForReview = resolveLawMindRoot(workspaceDir, envFile);
          const profileAssistantForEngine =
            typeof body.profileAssistantId === "string" && body.profileAssistantId.trim()
              ? body.profileAssistantId.trim()
              : DEFAULT_ASSISTANT_ID;
          const engine = getLawMindEngine(workspaceDir);
          const updated = await engine.review(draft, {
            status: st,
            note: typeof body.note === "string" ? body.note : undefined,
            actorId: resolveDesktopActorId(),
            assistantId: profileAssistantForEngine,
            ...(labels ? { labels } : {}),
            ...(deferQueue ? { deferMemoryWrites: true } : {}),
          });
          if (body.appendToProfile === true && !deferQueue) {
            const aid = profileAssistantForEngine;
            const note = typeof body.note === "string" ? body.note : undefined;
            const line = buildReviewProfileLine(raw, st, note);
            try {
              appendAssistantProfileMarkdown(lawMindRootForReview, aid, line);
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
          if (body.appendToLawyerProfile === true && !deferQueue) {
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
          const graph = readReasoningSnapshot(workspaceDir, raw);
          const reasoningMarkdown = graph ? serializeLegalReasoningGraph(graph) : null;
          const taskRec = readTaskRecord(workspaceDir, raw);
          const lawMindRoot = resolveLawMindRoot(workspaceDir, envFile);
          const memorySources = await buildAgentMemorySourceReport(workspaceDir, {
            matterId: draft.matterId,
            assistantId: taskRec?.assistantId,
            lawMindRoot,
          });
          sendJson(res, 200, {
            ok: true,
            draft,
            citationIntegrity,
            reasoningMarkdown,
            memorySources,
          }, c);
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

      if (pathname === "/api/matters/interaction-rollup" && req.method === "GET") {
        const rollup = await buildMatterInteractionRollup(workspaceDir);
        sendJson(res, 200, { ok: true, ...rollup }, c);
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
        const approvalRequests = await listApprovalRequests(workspaceDir, { matterId });
        const queueItems = await listWorkQueueItems(workspaceDir, { matterId });
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
            approvalRequests,
            queueItems,
            draftCitationIntegrity,
            auditEvents: index.auditEvents.slice(-80),
          },
          c,
        );
        return;
      }

      if (pathname === "/api/approvals" && req.method === "GET") {
        const matterId = url.searchParams.get("matterId")?.trim() || undefined;
        if (matterId && !isValidMatterId(matterId)) {
          sendJson(res, 400, { ok: false, error: "invalid matter id" }, c);
          return;
        }
        const statusRaw = url.searchParams.get("status")?.trim() || undefined;
        const status =
          statusRaw === "pending" ||
          statusRaw === "approved" ||
          statusRaw === "rejected" ||
          statusRaw === "needs_changes"
            ? statusRaw
            : undefined;
        const approvals = await listApprovalRequests(workspaceDir, { matterId, status });
        sendJson(res, 200, { ok: true, approvals }, c);
        return;
      }

      if (pathname === "/api/queues" && req.method === "GET") {
        const matterId = url.searchParams.get("matterId")?.trim() || undefined;
        if (matterId && !isValidMatterId(matterId)) {
          sendJson(res, 400, { ok: false, error: "invalid matter id" }, c);
          return;
        }
        const kind = url.searchParams.get("kind")?.trim() || undefined;
        const queueItems = await listWorkQueueItems(workspaceDir, {
          matterId,
          kind: kind as
            | "need_client_input"
            | "need_evidence"
            | "need_conflict_check"
            | "need_lawyer_review"
            | "need_partner_approval"
            | "ready_to_draft"
            | "ready_to_render"
            | "blocked_by_deadline"
            | "blocked_by_missing_strategy"
            | undefined,
        });
        sendJson(res, 200, { ok: true, queueItems }, c);
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
