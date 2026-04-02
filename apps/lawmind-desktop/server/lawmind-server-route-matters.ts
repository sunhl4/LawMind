import path from "node:path";
import {
  listApprovalRequests,
  listWorkQueueItems,
} from "../../../src/lawmind/application/services/queue-service.js";
import {
  buildMatterIndex,
  buildMatterOverview,
  createMatterIfAbsent,
  isValidMatterId,
  listMatterIds,
  listMatterOverviews,
  searchMatterIndex,
  summarizeMatterIndex,
} from "../../../src/lawmind/cases/index.js";
import type { DraftCitationIntegrityView } from "../../../src/lawmind/drafts/index.js";
import { resolveDraftCitationIntegrity } from "../../../src/lawmind/drafts/index.js";
import { emit } from "../../../src/lawmind/audit/index.js";
import {
  appendCaseArtifact,
  appendCaseCoreIssue,
  appendCaseRiskNote,
  appendCaseTaskGoal,
} from "../../../src/lawmind/memory/index.js";
import { listTaskRecords } from "../../../src/lawmind/tasks/index.js";
import type { LawmindRouteContext } from "./lawmind-server-route-types.js";
import { readJsonBody, resolveDesktopActorId, sendJson } from "./lawmind-server-helpers.js";

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
      return true;
    }
    if (!note) {
      sendJson(res, 400, { ok: false, error: "note required" }, c);
      return true;
    }
    if (!["core_issue", "risk", "artifact", "task_goal"].includes(section)) {
      sendJson(res, 400, { ok: false, error: "invalid section" }, c);
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
      return true;
    }
    if (!["open_review", "save_upgrade_suggestion", "write_case_note"].includes(action)) {
      sendJson(res, 400, { ok: false, error: "invalid action" }, c);
      return true;
    }
    const resolvedTaskId = resolveMatterInteractionTaskId(workspaceDir, matterId, taskId);
    if (!resolvedTaskId) {
      sendJson(res, 400, { ok: false, error: "no task found for matter" }, c);
      return true;
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
        target:
          body.target === "assistant" ? "assistant" : body.target === "lawyer" ? "lawyer" : undefined,
        variant:
          body.variant === "conservative" ||
          body.variant === "assertive" ||
          body.variant === "standard"
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

  if (pathname === "/api/matters/create" && req.method === "POST") {
    const body = (await readJsonBody(req)) as { matterId?: string };
    const mid = typeof body.matterId === "string" ? body.matterId.trim() : "";
    if (!mid) {
      sendJson(res, 400, { ok: false, error: "matterId required" }, c);
      return true;
    }
    try {
      const result = await createMatterIfAbsent(workspaceDir, mid);
      sendJson(res, 200, { ok: true, ...result }, c);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      sendJson(res, 400, { ok: false, error: msg }, c);
    }
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
    const summary = summarizeMatterIndex(index);
    const overview = buildMatterOverview(index);
    const truncated = index.caseMemory.length > 120_000;
    const caseMemory = truncated ? `${index.caseMemory.slice(0, 120_000)}\n\n…[truncated]` : index.caseMemory;
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
    const approvals = await listApprovalRequests(workspaceDir, { matterId, status });
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
