import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
  listApprovalRequests,
  listWorkQueueItems,
} from "../../../src/lawmind/application/services/queue-service.js";
import {
  listQueueItemsForMatter,
  openQueueItem,
  transitionQueueItem,
} from "../../../src/lawmind/application/services/queue-write-service.js";
import { updateMatterProfile } from "../../../src/lawmind/application/services/matter-write-service.js";
import {
  buildMatterProfileView,
  parseMatterCaseProfileFields,
} from "../../../src/lawmind/cases/matter-profile.js";
import {
  buildMatterIndex,
  buildMatterOverview,
  createMatterIfAbsent,
  isValidMatterId,
  listMatterIds,
  listMatterOverviews,
  readCaseSubdirRole,
  readTeamMeetingWindow,
  searchMatterIndex,
  summarizeMatterIndex,
  TEAM_MEETING_TAIL_LIMIT_CAP,
  TEAM_MEETING_TAIL_LIMIT_DEFAULT,
  writeCaseSubdirRole,
  type CaseSubdirRole,
} from "../../../src/lawmind/cases/index.js";
import { readTeamRoster, writeTeamRoster } from "../../../src/lawmind/cases/team-roster.js";
import { isAdhocMeetingMatterId } from "../../../src/lawmind/cases/team-meeting-ids.js";
import type { DraftCitationIntegrityView } from "../../../src/lawmind/drafts/index.js";
import { resolveDraftCitationIntegrity } from "../../../src/lawmind/drafts/index.js";
import { emit, readRecentAuditLogs } from "../../../src/lawmind/audit/index.js";
import {
  buildMatterReviewMatrix,
  exportReviewMatrixCsv,
} from "../../../src/lawmind/matter/review-matrix.js";
import {
  appendCaseArtifact,
  appendCaseCoreIssue,
  appendCaseRiskNote,
  appendCaseTaskGoal,
  upsertMatterDisplayName,
} from "../../../src/lawmind/memory/index.js";
import { loadMatter, saveMatter } from "../../../src/lawmind/adapters/matter-storage/index.js";
import { repairMatterProjections } from "../../../src/lawmind/application/matter-consistency.js";
import { isProductInsightsCollectionEnabled } from "../../../src/lawmind/policy/edition.js";
import type { LawMindWorkspacePolicy } from "../../../src/lawmind/policy/workspace-policy.js";
import { buildMatterSessionTimeline } from "../../../src/lawmind/insights/session-timeline.js";
import { listTaskRecords } from "../../../src/lawmind/tasks/index.js";
import { isInvalidRequestBodyError, parseJsonBodyZod } from "./lawmind-api-parse.js";
import {
  matterCaseNoteRequestSchema,
  matterCreatePostSchema,
  matterDeletePostSchema,
  matterDisplayNamePostSchema,
  matterInteractionRequestSchema,
  matterProfilePostSchema,
  matterRolePostSchema,
} from "./lawmind-api-schemas.js";
import type { LawmindRouteContext } from "./lawmind-server-route-types.js";
import { resolveDesktopActorId, sendJson } from "./lawmind-server-helpers.js";

const teamRosterPutSchema = z.object({
  matterId: z.string().min(1),
  participantAssistantIds: z.array(z.string()),
  synthesizerAssistantId: z.string().nullable().optional(),
});

function matterGovernanceLabel(record: ReturnType<typeof loadMatter>): string {
  if (!record) {
    return "";
  }
  const status =
    record.status === "intake"
      ? "接洽中"
      : record.status === "active"
        ? "办理中"
        : record.status === "under_review"
          ? "审核中"
          : record.status === "delivered"
            ? "已交付"
            : record.status === "closed"
              ? "已结案"
              : record.status === "waiting_on_client"
                ? "等待客户"
                : "等待团队";
  const sensitivity =
    record.sensitivity === "restricted"
      ? "严格隔离"
      : record.sensitivity === "high"
        ? "高度敏感"
        : "普通保密";
  return `${status} · ${sensitivity}`;
}

/** 解析 `<workspace>/cases/<matterId>` 并防止穿越 `cases` 根目录。 */
function resolvedMatterCaseDir(workspaceDir: string, matterId: string): string {
  const casesRoot = path.resolve(workspaceDir, "cases");
  const target = path.resolve(casesRoot, matterId);
  const rel = path.relative(casesRoot, target);
  if (rel.startsWith("..") || path.isAbsolute(rel) || rel === "") {
    throw new Error("invalid matter path");
  }
  return target;
}

type MatterInteractionAction = "open_review" | "save_upgrade_suggestion" | "write_case_note";
type MatterInteractionParsed = {
  action: MatterInteractionAction | "unknown";
  surface?: string;
  label?: string;
};

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
    return `案件工作台动作：从 ${surface} 打开改稿；来源 ${label}。`;
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
  const reviewMatch = /^案件工作台动作：从 (.+?) (?:打开改稿(?:预览)?|进入(?:审核台|文书台|改稿))；来源 (.+)。$/.exec(raw);
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
  const taskToMatter = new Map(
    listTaskRecords(workspaceDir)
      .filter((t) => t.matterId)
      .map((t) => [t.taskId, t.matterId as string]),
  );
  // 一次读近期 audit，再按 matter 分桶——避免 N× buildMatterIndex 全量扫盘
  const recentAudit = await readRecentAuditLogs(`${workspaceDir}/audit`, {
    maxDays: 180,
    maxEvents: 20_000,
  });
  const byMatter = new Map<string, typeof recentAudit>();
  for (const event of recentAudit) {
    const mid = taskToMatter.get(event.taskId);
    if (!mid) {
      continue;
    }
    const list = byMatter.get(mid) ?? [];
    list.push(event);
    byMatter.set(mid, list);
  }
  const buckets = new Map<
    string,
    { title: string; matterIds: Set<string>; totalEvents: number; latestAt?: string }
  >();
  for (const matterId of matterIds) {
    const auditEvents = byMatter.get(matterId) ?? [];
    // W10：兼容新旧 kind；同 taskId+detail+timestamp 视为重复，仅取一条。
    const seen = new Set<string>();
    const interactions = auditEvents
      .filter((event) => event.kind === "ui.matter_action" || event.kind === "ux.matter_action")
      .filter((event) => {
        const sig = `${event.taskId ?? ""}|${event.timestamp ?? ""}|${event.detail ?? ""}`;
        if (seen.has(sig)) {return false;}
        seen.add(sig);
        return true;
      })
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
      current.matterIds.add(matterId);
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
      .toSorted(
        (a, b) =>
          b.matterCount - a.matterCount ||
          b.totalEvents - a.totalEvents ||
          a.title.localeCompare(b.title, "zh-CN"),
      )
      .slice(0, 6),
  };
}

export async function handleMatterRoutes({
  ctx,
  pathname,
  req,
  res,
  url,
  c,
}: LawmindRouteContext): Promise<boolean> {
  const { workspaceDir } = ctx;

  {
    const opsMatch = pathname.match(/^\/api\/matters\/([^/]+)\/ops$/);
    if (opsMatch) {
      const matterId = decodeURIComponent(opsMatch[1] ?? "");
      if (!isValidMatterId(matterId)) {
        sendJson(res, 400, { ok: false, error: "invalid matter id" }, c);
        return true;
      }
      const {
        appendMatterRaid,
        readMatterOpsSummary,
        writeMatterOpsPlan,
        writeMatterOpsScope,
      } = await import("../../../src/lawmind/matter-ops/index.js");
      if (req.method === "GET") {
        sendJson(res, 200, { ok: true, ops: readMatterOpsSummary(workspaceDir, matterId) }, c);
        return true;
      }
      if (req.method === "PATCH" || req.method === "POST") {
        const { parseJsonBodyZod, isInvalidRequestBodyError } = await import("./lawmind-api-parse.js");
        const { z } = await import("zod");
        const schema = z.object({
          baseline: z.string().optional(),
          plan: z
            .object({
              phases: z.array(
                z.object({
                  id: z.string(),
                  title: z.string(),
                  owner: z.string().optional(),
                  dueAt: z.string().optional(),
                }),
              ),
              milestones: z.array(
                z.object({
                  id: z.string(),
                  title: z.string(),
                  dueAt: z.string().optional(),
                }),
              ),
            })
            .optional(),
          raid: z
            .object({
              kind: z.enum(["risk", "assumption", "issue", "decision"]),
              text: z.string().min(1),
              status: z.enum(["open", "closed"]).optional(),
            })
            .optional(),
        });
        try {
          const body = await parseJsonBodyZod(req, schema);
          if (body.baseline != null) {
            writeMatterOpsScope(workspaceDir, matterId, body.baseline);
          }
          if (body.plan) {
            writeMatterOpsPlan(workspaceDir, matterId, body.plan);
          }
          if (body.raid) {
            appendMatterRaid(workspaceDir, matterId, body.raid);
          }
          sendJson(res, 200, { ok: true, ops: readMatterOpsSummary(workspaceDir, matterId) }, c);
        } catch (err) {
          if (isInvalidRequestBodyError(err)) {
            sendJson(res, 400, { ok: false, error: "invalid ops body" }, c);
            return true;
          }
          throw err;
        }
        return true;
      }
    }
  }

  {
    const theoryMatch = pathname.match(/^\/api\/matters\/([^/]+)\/theory$/);
    if (theoryMatch) {
      const matterId = decodeURIComponent(theoryMatch[1] ?? "");
      if (!isValidMatterId(matterId)) {
        sendJson(res, 400, { ok: false, error: "invalid matter id" }, c);
        return true;
      }
      const { readMatterTheoryLite, writeMatterTheoryLite } = await import(
        "../../../src/lawmind/matter-ops/index.js"
      );
      if (req.method === "GET") {
        sendJson(res, 200, { ok: true, theory: readMatterTheoryLite(workspaceDir, matterId) }, c);
        return true;
      }
      if (req.method === "PUT" || req.method === "POST") {
        const { parseJsonBodyZod, isInvalidRequestBodyError } = await import("./lawmind-api-parse.js");
        const { z } = await import("zod");
        try {
          const body = await parseJsonBodyZod(
            req,
            z.object({
              issues: z.string(),
              authorities: z.string(),
              openQuestions: z.string(),
              anchored: z.boolean().optional(),
            }),
          );
          const theory = writeMatterTheoryLite(workspaceDir, matterId, {
            issues: body.issues,
            authorities: body.authorities,
            openQuestions: body.openQuestions,
            anchored: body.anchored ?? false,
          });
          sendJson(res, 200, { ok: true, theory }, c);
        } catch (err) {
          if (isInvalidRequestBodyError(err)) {
            sendJson(res, 400, { ok: false, error: "invalid theory body" }, c);
            return true;
          }
          throw err;
        }
        return true;
      }
    }
  }

  if (pathname === "/api/matters/team-roster" && req.method === "GET") {
    const matterId = url.searchParams.get("matterId")?.trim() ?? "";
    if (!isValidMatterId(matterId)) {
      sendJson(res, 400, { ok: false, error: "invalid matter id" }, c);
      return true;
    }
    if (isAdhocMeetingMatterId(matterId)) {
      sendJson(res, 200, { ok: true, roster: null, adhoc: true }, c);
      return true;
    }
    const roster = readTeamRoster(workspaceDir, matterId);
    sendJson(res, 200, { ok: true, roster }, c);
    return true;
  }

  if (pathname === "/api/matters/team-roster" && req.method === "PUT") {
    let body;
    try {
      body = await parseJsonBodyZod(req, teamRosterPutSchema);
    } catch (err) {
      if (isInvalidRequestBodyError(err)) {
        sendJson(res, 400, { ok: false, error: "invalid request" }, c);
        return true;
      }
      throw err;
    }
    const matterId = body.matterId.trim();
    if (!isValidMatterId(matterId) || isAdhocMeetingMatterId(matterId)) {
      sendJson(res, 400, { ok: false, error: "invalid matter id" }, c);
      return true;
    }
    try {
      const roster = writeTeamRoster(workspaceDir, matterId, {
        participantAssistantIds: body.participantAssistantIds,
        synthesizerAssistantId: body.synthesizerAssistantId,
      });
      sendJson(res, 200, { ok: true, roster }, c);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      sendJson(res, 400, { ok: false, error: msg }, c);
    }
    return true;
  }

  if (pathname === "/api/matters/team-meeting" && req.method === "GET") {
    const matterId = url.searchParams.get("matterId")?.trim() ?? "";
    if (!isValidMatterId(matterId)) {
      sendJson(res, 400, { ok: false, error: "invalid matter id" }, c);
      return true;
    }
    const limitRaw = url.searchParams.get("limit");
    let limit = TEAM_MEETING_TAIL_LIMIT_DEFAULT;
    if (limitRaw !== null && limitRaw !== "") {
      const n = Number(limitRaw);
      if (Number.isFinite(n)) {
        limit = Math.min(Math.max(1, Math.floor(n)), TEAM_MEETING_TAIL_LIMIT_CAP);
      }
    }
    const skipRaw = url.searchParams.get("skipFromEnd");
    let skipFromEnd = 0;
    if (skipRaw !== null && skipRaw !== "") {
      const n = Number(skipRaw);
      if (Number.isFinite(n)) {
        skipFromEnd = Math.max(0, Math.floor(n));
      }
    }
    const { lines, total } = readTeamMeetingWindow(workspaceDir, matterId, limit, skipFromEnd);
    sendJson(res, 200, { ok: true, lines, total }, c);
    return true;
  }

  if (pathname === "/api/matters/case-note" && req.method === "POST") {
    let body;
    try {
      body = await parseJsonBodyZod(req, matterCaseNoteRequestSchema);
    } catch (err) {
      if (isInvalidRequestBodyError(err)) {
        sendJson(res, 400, { ok: false, error: "invalid request" }, c);
        return true;
      }
      throw err;
    }
    const { matterId, section, note } = body;
    if (!isValidMatterId(matterId)) {
      sendJson(res, 400, { ok: false, error: "invalid matter id" }, c);
      return true;
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
    return true;
  }

  if (pathname === "/api/matters/interaction" && req.method === "POST") {
    let body;
    try {
      body = await parseJsonBodyZod(req, matterInteractionRequestSchema);
    } catch (err) {
      if (isInvalidRequestBodyError(err)) {
        sendJson(res, 400, { ok: false, error: "invalid request" }, c);
        return true;
      }
      throw err;
    }
    const matterId = body.matterId;
    const taskId = body.taskId ?? "";
    const action = body.action;
    if (!isValidMatterId(matterId)) {
      sendJson(res, 400, { ok: false, error: "invalid matter id" }, c);
      return true;
    }
    const resolvedTaskId = resolveMatterInteractionTaskId(workspaceDir, matterId, taskId);
    if (!resolvedTaskId) {
      sendJson(res, 400, { ok: false, error: "no task found for matter" }, c);
      return true;
    }
    const detail = describeMatterInteraction({
      action: action as MatterInteractionAction,
      surface: body.surface,
      label: body.label,
      target: body.target,
      variant: body.variant,
      section: body.section,
    });
    const auditDir = path.join(workspaceDir, "audit");
    const event = await emit(auditDir, {
      taskId: resolvedTaskId,
      kind: "ui.matter_action",
      actor: "lawyer",
      actorId: resolveDesktopActorId(),
      detail,
    });
    // W10：双写新 kind ux.matter_action（季末考虑 sunset 旧 kind）。
    if (
      isProductInsightsCollectionEnabled({
        policy: ctx.policy.loaded
          ? (ctx.policy.policy as unknown as LawMindWorkspacePolicy)
          : null,
      })
    ) {
      try {
        await emit(auditDir, {
          taskId: resolvedTaskId,
          kind: "ux.matter_action",
          actor: "lawyer",
          actorId: resolveDesktopActorId(),
          detail,
        });
      } catch {
        /* dual-write best-effort */
      }
    }
    sendJson(res, 200, { ok: true, taskId: resolvedTaskId, event }, c);
    return true;
  }

  if (pathname === "/api/matters/overviews" && req.method === "GET") {
    const overviews = await listMatterOverviews(workspaceDir);
    sendJson(res, 200, { ok: true, overviews }, c);
    return true;
  }

  if (pathname === "/api/matters/interaction-rollup" && req.method === "GET") {
    const rollup = await buildMatterInteractionRollup(workspaceDir);
    sendJson(res, 200, { ok: true, ...rollup }, c);
    return true;
  }

  if (pathname === "/api/matters/role" && req.method === "GET") {
    const matterId = url.searchParams.get("matterId")?.trim() ?? "";
    if (!matterId || !isValidMatterId(matterId)) {
      sendJson(res, 400, { ok: false, error: "invalid matter id" }, c);
      return true;
    }
    const role = await readCaseSubdirRole(workspaceDir, matterId);
    sendJson(res, 200, { ok: true, matterId, role }, c);
    return true;
  }

  if (pathname === "/api/matters/role" && req.method === "POST") {
    let body;
    try {
      body = await parseJsonBodyZod(req, matterRolePostSchema);
    } catch (err) {
      if (isInvalidRequestBodyError(err)) {
        sendJson(res, 400, { ok: false, error: "invalid request" }, c);
        return true;
      }
      throw err;
    }
    const mid = body.matterId;
    const roleRaw = body.role.toLowerCase();
    if (!mid || !isValidMatterId(mid)) {
      sendJson(res, 400, { ok: false, error: "invalid matter id" }, c);
      return true;
    }
    const role: CaseSubdirRole | null =
      roleRaw === "matter" || roleRaw === "case"
        ? "matter"
        : roleRaw === "folder" || roleRaw === "storage"
          ? "folder"
          : null;
    if (!role) {
      sendJson(res, 400, { ok: false, error: "role must be matter or folder" }, c);
      return true;
    }
    try {
      if (role === "matter") {
        await createMatterIfAbsent(workspaceDir, mid);
      }
      await writeCaseSubdirRole(workspaceDir, mid, role);
      sendJson(res, 200, { ok: true, matterId: mid, role }, c);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      sendJson(res, 500, { ok: false, error: msg }, c);
    }
    return true;
  }

  if (pathname === "/api/matters/create" && req.method === "POST") {
    let body;
    try {
      body = await parseJsonBodyZod(req, matterCreatePostSchema);
    } catch (err) {
      if (isInvalidRequestBodyError(err)) {
        sendJson(res, 400, { ok: false, error: "matterId required" }, c);
        return true;
      }
      throw err;
    }
    const mid = body.matterId;
    const displayName = body.displayName ?? "";
    const conflictCheckConfirmed = body.conflictCheckConfirmed === true;
    const engagementAccepted = body.engagementAccepted === true;
    try {
      const result = await createMatterIfAbsent(workspaceDir, mid, {
        ...(displayName ? { displayName } : {}),
        ...(body.clientId ? { clientId: body.clientId } : {}),
        ...(body.sensitivity ? { sensitivity: body.sensitivity } : {}),
        status: conflictCheckConfirmed && engagementAccepted ? "active" : "intake",
      });
      if (!conflictCheckConfirmed) {
        const existing = await listWorkQueueItems(workspaceDir, {
          matterId: mid,
          kind: "need_conflict_check",
          status: "open",
        });
        if (existing.length === 0) {
          openQueueItem(workspaceDir, {
            matterId: mid,
            kind: "need_conflict_check",
            title: "完成利益冲突检查",
            detail: "在正式接受委托和处理客户材料前，确认客户及相关方不存在利益冲突。",
            priority: "high",
          });
        }
      }
      sendJson(res, 200, {
        ok: true,
        ...result,
        status: conflictCheckConfirmed && engagementAccepted ? "active" : "intake",
        conflictCheckRequired: !conflictCheckConfirmed,
      }, c);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      sendJson(res, 400, { ok: false, error: msg }, c);
    }
    return true;
  }

  if (pathname === "/api/matters/profile" && req.method === "POST") {
    let body;
    try {
      body = await parseJsonBodyZod(req, matterProfilePostSchema);
    } catch (err) {
      if (isInvalidRequestBodyError(err)) {
        sendJson(res, 400, { ok: false, error: "invalid profile body" }, c);
        return true;
      }
      throw err;
    }
    const mid = body.matterId;
    if (!isValidMatterId(mid)) {
      sendJson(res, 400, { ok: false, error: "invalid matter id" }, c);
      return true;
    }
    try {
      const conflictOk = body.conflictCheckConfirmed === true;
      const engagementOk = body.engagementAccepted === true;
      let nextStatus = body.status;
      if (conflictOk && engagementOk) {
        nextStatus = "active";
      }
      const updated = await updateMatterProfile(workspaceDir, {
        matterId: mid,
        ...(body.title ? { title: body.title } : {}),
        ...(body.clientId !== undefined ? { clientId: body.clientId } : {}),
        ...(body.sensitivity ? { sensitivity: body.sensitivity } : {}),
        ...(nextStatus ? { status: nextStatus } : {}),
        ...(body.causeOfAction !== undefined ? { causeOfAction: body.causeOfAction } : {}),
        ...(body.counterparty !== undefined ? { counterparty: body.counterparty } : {}),
        ...(body.matterKind ? { matterKind: body.matterKind } : {}),
        ...(body.practiceTags ? { practiceTags: body.practiceTags } : {}),
        ...(body.docket ? { docket: body.docket } : {}),
      });
      if (!updated) {
        sendJson(res, 404, { ok: false, error: "matter not found" }, c);
        return true;
      }
      if (conflictOk) {
        for (const item of listQueueItemsForMatter(workspaceDir, mid, {
          kind: "need_conflict_check",
          status: "open",
        })) {
          transitionQueueItem(workspaceDir, mid, item.queueItemId, "resolved");
        }
      } else if (body.conflictCheckConfirmed === false) {
        const existing = listQueueItemsForMatter(workspaceDir, mid, {
          kind: "need_conflict_check",
          status: "open",
        });
        if (existing.length === 0) {
          openQueueItem(workspaceDir, {
            matterId: mid,
            kind: "need_conflict_check",
            title: "完成利益冲突检查",
            detail: "在正式接受委托和处理客户材料前，确认客户及相关方不存在利益冲突。",
            priority: "high",
          });
        }
      }
      const caseMemory = (await buildMatterIndex(workspaceDir, mid)).caseMemory;
      const fromCase = parseMatterCaseProfileFields(caseMemory);
      const profile = buildMatterProfileView({
        matterId: updated.matterId,
        title: updated.title,
        clientId: updated.clientId ?? fromCase.clientIdFromCase,
        sensitivity: updated.sensitivity,
        status: updated.status,
        causeOfAction: fromCase.causeOfAction,
        counterparty: fromCase.counterparty,
        matterKind: updated.matterKind,
        caseNo: updated.docket?.caseNo ?? fromCase.caseNo,
        court: updated.docket?.court ?? fromCase.court,
        instance: updated.docket?.instance ?? fromCase.instance,
        standing: updated.docket?.standing ?? fromCase.standing,
        hearingAt: updated.docket?.hearingAt ?? fromCase.hearingAt,
      });
      sendJson(res, 200, { ok: true, profile, statusLine: matterGovernanceLabel(updated) }, c);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      sendJson(res, 400, { ok: false, error: msg }, c);
    }
    return true;
  }

  if (pathname === "/api/matters/display-name" && req.method === "POST") {
    let body;
    try {
      body = await parseJsonBodyZod(req, matterDisplayNamePostSchema);
    } catch (err) {
      if (isInvalidRequestBodyError(err)) {
        sendJson(res, 400, { ok: false, error: "displayName required" }, c);
        return true;
      }
      throw err;
    }
    const mid = body.matterId;
    const label = body.displayName;
    if (!isValidMatterId(mid)) {
      sendJson(res, 400, { ok: false, error: "invalid matter id" }, c);
      return true;
    }
    if (label.length > 200) {
      sendJson(res, 400, { ok: false, error: "displayName too long" }, c);
      return true;
    }
    try {
      await upsertMatterDisplayName(workspaceDir, mid, label);
      const record = loadMatter(workspaceDir, mid);
      if (record && record.title.trim() !== label) {
        saveMatter(workspaceDir, { ...record, title: label });
      }
      sendJson(res, 200, { ok: true, matterId: mid, displayName: label }, c);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      sendJson(res, 500, { ok: false, error: msg }, c);
    }
    return true;
  }

  if (pathname === "/api/matters/repair-projections" && req.method === "POST") {
    try {
      const repaired = await repairMatterProjections(workspaceDir);
      sendJson(res, 200, { ok: true, repaired }, c);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      sendJson(res, 500, { ok: false, error: msg }, c);
    }
    return true;
  }

  if (pathname === "/api/matters/delete" && req.method === "POST") {
    let body;
    try {
      body = await parseJsonBodyZod(req, matterDeletePostSchema);
    } catch (err) {
      if (isInvalidRequestBodyError(err)) {
        sendJson(res, 400, { ok: false, error: "invalid matter id" }, c);
        return true;
      }
      throw err;
    }
    const mid = body.matterId;
    if (!isValidMatterId(mid)) {
      sendJson(res, 400, { ok: false, error: "invalid matter id" }, c);
      return true;
    }
    let target: string;
    try {
      target = resolvedMatterCaseDir(workspaceDir, mid);
    } catch {
      sendJson(res, 400, { ok: false, error: "invalid matter path" }, c);
      return true;
    }
    let existedOnDisk = false;
    try {
      await fs.access(target);
      existedOnDisk = true;
    } catch {
      existedOnDisk = false;
    }
    if (existedOnDisk) {
      try {
        await fs.rm(target, { recursive: true, force: true });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        sendJson(res, 500, { ok: false, error: msg }, c);
        return true;
      }
    }
    sendJson(
      res,
      200,
      { ok: true, matterId: mid, deletedFromDisk: existedOnDisk },
      c,
    );
    return true;
  }

  if (pathname === "/api/matters/review-matrix" && req.method === "GET") {
    const matterId = url.searchParams.get("matterId")?.trim() ?? "";
    if (!isValidMatterId(matterId)) {
      sendJson(res, 400, { ok: false, error: "invalid matter id" }, c);
      return true;
    }
    const matrix = buildMatterReviewMatrix(workspaceDir, matterId);
    sendJson(res, 200, { ok: true, matrix }, c);
    return true;
  }

  if (pathname === "/api/matters/review-matrix/export" && req.method === "GET") {
    const matterId = url.searchParams.get("matterId")?.trim() ?? "";
    if (!isValidMatterId(matterId)) {
      sendJson(res, 400, { ok: false, error: "invalid matter id" }, c);
      return true;
    }
    const matrix = buildMatterReviewMatrix(workspaceDir, matterId);
    const csv = exportReviewMatrixCsv(matrix);
    sendJson(res, 200, { ok: true, matterId, format: "csv", csv }, c);
    return true;
  }

  if (pathname === "/api/matters/session-timeline" && req.method === "GET") {
    const matterId = url.searchParams.get("matterId")?.trim() ?? "";
    if (!isValidMatterId(matterId)) {
      sendJson(res, 400, { ok: false, error: "invalid matter id" }, c);
      return true;
    }
    const limitRaw = Number(url.searchParams.get("limit") ?? "40");
    const limit = Number.isFinite(limitRaw) ? Math.min(100, Math.max(5, Math.floor(limitRaw))) : 40;
    const entries = await buildMatterSessionTimeline(workspaceDir, matterId, limit);
    sendJson(res, 200, { ok: true, matterId, entries }, c);
    return true;
  }

  if (pathname === "/api/matters/detail" && req.method === "GET") {
    const matterId = url.searchParams.get("matterId")?.trim() ?? "";
    if (!isValidMatterId(matterId)) {
      sendJson(res, 400, { ok: false, error: "invalid matter id" }, c);
      return true;
    }
    const index = await buildMatterIndex(workspaceDir, matterId);
    const approvalRequests = await listApprovalRequests(workspaceDir, { matterId });
    const queueItems = await listWorkQueueItems(workspaceDir, { matterId });
    const record = loadMatter(workspaceDir, matterId);
    const summary = {
      ...summarizeMatterIndex(index),
      statusLine: matterGovernanceLabel(record),
    };
    const overview = buildMatterOverview(index);
    const truncated = index.caseMemory.length > 120_000;
    const caseMemory = truncated ? `${index.caseMemory.slice(0, 120_000)}\n\n…[truncated]` : index.caseMemory;
    const fromCase = parseMatterCaseProfileFields(index.caseMemory);
    const profile = record
      ? buildMatterProfileView({
          matterId: record.matterId,
          title: record.title,
          clientId: record.clientId ?? fromCase.clientIdFromCase,
          sensitivity: record.sensitivity,
          status: record.status,
          causeOfAction: fromCase.causeOfAction,
          counterparty: fromCase.counterparty,
          matterKind: record.matterKind,
          caseNo: record.docket?.caseNo ?? fromCase.caseNo,
          court: record.docket?.court ?? fromCase.court,
          instance: record.docket?.instance ?? fromCase.instance,
          standing: record.docket?.standing ?? fromCase.standing,
          hearingAt: record.docket?.hearingAt ?? fromCase.hearingAt,
        })
      : null;
    const draftCitationIntegrity: Record<string, DraftCitationIntegrityView> = {};
    for (const draft of index.drafts) {
      draftCitationIntegrity[draft.taskId] = resolveDraftCitationIntegrity(workspaceDir, draft);
    }
    sendJson(
      res,
      200,
      {
        ok: true,
        matterId,
        summary,
        overview,
        profile,
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
    return true;
  }

  if (pathname === "/api/approvals" && req.method === "GET") {
    const matterId = url.searchParams.get("matterId")?.trim() || undefined;
    if (matterId && !isValidMatterId(matterId)) {
      sendJson(res, 400, { ok: false, error: "invalid matter id" }, c);
      return true;
    }
    const statusRaw = url.searchParams.get("status")?.trim() || undefined;
    const status =
      statusRaw === "pending" ||
      statusRaw === "approved" ||
      statusRaw === "rejected" ||
      statusRaw === "needs_changes"
        ? statusRaw
        : undefined;
    const targetRole = url.searchParams.get("targetRole")?.trim() || undefined;
    const approvals = await listApprovalRequests(workspaceDir, {
      matterId,
      status,
      targetRole,
    });
    sendJson(res, 200, { ok: true, approvals }, c);
    return true;
  }

  if (pathname === "/api/queues" && req.method === "GET") {
    const matterId = url.searchParams.get("matterId")?.trim() || undefined;
    if (matterId && !isValidMatterId(matterId)) {
      sendJson(res, 400, { ok: false, error: "invalid matter id" }, c);
      return true;
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
    return true;
  }

  if (pathname === "/api/matters/search" && req.method === "GET") {
    const matterId = url.searchParams.get("matterId")?.trim() ?? "";
    const q = url.searchParams.get("q") ?? "";
    if (!isValidMatterId(matterId)) {
      sendJson(res, 400, { ok: false, error: "invalid matter id" }, c);
      return true;
    }
    const index = await buildMatterIndex(workspaceDir, matterId);
    const hits = searchMatterIndex(index, q);
    sendJson(res, 200, { ok: true, matterId, query: q, hits: hits.slice(0, 60) }, c);
    return true;
  }

  if (pathname === "/api/matters" && req.method === "GET") {
    const matterIds = await listMatterIds(workspaceDir);
    sendJson(res, 200, { ok: true, matterIds }, c);
    return true;
  }

  return false;
}
