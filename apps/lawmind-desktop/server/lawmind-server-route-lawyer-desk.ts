/**
 * Lawyer 工作台 APIs: today, deadlines, events, standards, intake, similar cases.
 */

import { z } from "zod";
import { isValidMatterId } from "../../../src/lawmind/cases/matter-id.js";
import {
  completeDeadline,
  listDeadlinesForMatter,
  patchDeadline,
  recordDeadline,
  snoozeDeadline,
} from "../../../src/lawmind/application/services/deadline-service.js";
import { loadMatter } from "../../../src/lawmind/adapters/matter-storage/index.js";
import { listMatterIdsFromStorage } from "../../../src/lawmind/adapters/matter-storage/io.js";
import { parseMatterKind, MATTER_KIND_LABELS } from "../../../src/lawmind/desk/matter-kind.js";
import { extractLegalEvents, defaultRemindBeforeHours } from "../../../src/lawmind/desk/legal-event-extract.js";
import { formatDeadlinesIcs } from "../../../src/lawmind/desk/deadline-ics.js";
import { appendDailyPlanItems, setDailyPlanItemDone, markDailyPlanSourceDone } from "../../../src/lawmind/desk/daily-plan.js";
import { buildTodayWorkSnapshot } from "../../../src/lawmind/desk/today-work.js";
import { compileIntakeBrief, loadIntakeBrief, saveIntakeBrief, confirmIntakeBrief } from "../../../src/lawmind/desk/intake-brief.js";
import { listSimilarCasesForDesk } from "../../../src/lawmind/desk/similar-cases.js";
import { loadCauseLexicon, saveCauseLexicon } from "../../../src/lawmind/desk/cause-lexicon.js";
import { buildMatterPulse, daysUntilIso } from "../../../src/lawmind/desk/matter-pulse.js";
import { listTaskRecords } from "../../../src/lawmind/tasks/index.js";
import {
  deleteUserStandard,
  loadUserStandards,
  matchUserStandards,
  saveUserStandard,
} from "../../../src/lawmind/practice/user-standards.js";
import { inferClosedContractType } from "../../../src/lawmind/contracts/closed-contract-type.js";
import { updateMatterProfile } from "../../../src/lawmind/application/services/matter-write-service.js";
import { parseJsonBodyZod, isInvalidRequestBodyError } from "./lawmind-api-parse.js";
import type { LawmindRouteContext } from "./lawmind-server-route-types.js";
import { sendJson } from "./lawmind-server-helpers.js";

const planPostSchema = z.object({
  texts: z.array(z.string().trim().min(1).max(500)).min(1).max(20),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

const planItemPatchSchema = z.object({
  done: z.boolean(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

const deadlinePostSchema = z.object({
  title: z.string().trim().min(1).max(200),
  dueAt: z.string().trim().min(1),
  eventKind: z.enum(["hearing", "filing", "limitation", "reply", "custom"]).optional(),
  notes: z.string().trim().max(2000).optional(),
  remindBeforeHours: z.number().int().min(0).max(720).optional(),
});

const deadlinePatchSchema = z.object({
  status: z.enum(["open", "snoozed", "completed", "missed"]).optional(),
  dueAt: z.string().trim().optional(),
  notes: z.string().trim().max(2000).optional(),
  remindBeforeHours: z.number().int().min(0).max(720).optional(),
});

const extractPostSchema = z.object({
  text: z.string().trim().min(1).max(20_000),
  matterId: z.string().trim().optional(),
});

const confirmEventsSchema = z.object({
  matterId: trimmedMatterId(),
  events: z
    .array(
      z.object({
        eventKind: z.enum(["hearing", "filing", "limitation", "reply", "custom"]),
        title: z.string().trim().min(1).max(200),
        dueAt: z.string().trim().min(1),
        notes: z.string().trim().max(2000).optional(),
      }),
    )
    .min(1)
    .max(12),
});

function trimmedMatterId() {
  return z.string().trim().min(1);
}

const standardSaveSchema = z.object({
  id: z.string().trim().optional(),
  title: z.string().trim().min(1).max(80),
  kind: z.enum(["contract_review", "litigation_intake", "daily_triage"]).optional(),
  enabled: z.boolean().optional(),
  items: z
    .array(
      z.object({
        text: z.string().trim().min(1).max(400),
        tone: z.enum(["check", "never_accept", "must_rewrite"]).optional(),
      }),
    )
    .optional(),
  bindWhen: z
    .object({
      contractTypes: z.array(z.string()).optional(),
      keywords: z.array(z.string()).optional(),
      clientIds: z.array(z.string()).optional(),
    })
    .optional(),
});

const compileTalkSchema = z.object({
  transcript: z.string().trim().min(1).max(50_000),
});

const causeApplySchema = z.object({
  causeOfAction: z.string().trim().min(1).max(200),
});

const lexiconPostSchema = z.object({
  causes: z.array(z.string().trim().min(1).max(80)).max(80),
});

const sourceDoneSchema = z.object({
  source: z.enum(["mail", "deadline", "approval"]),
  sourceRef: z.string().trim().min(1).max(200),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

function requireMatter(pathnameMatter: string, res: LawmindRouteContext["res"], c: LawmindRouteContext["c"]): string | null {
  if (!isValidMatterId(pathnameMatter)) {
    sendJson(res, 400, { ok: false, error: "invalid matter id" }, c);
    return null;
  }
  return pathnameMatter;
}

export async function handleLawyerDeskRoutes({
  pathname,
  req,
  res,
  c,
  ctx,
  url,
}: LawmindRouteContext): Promise<boolean> {
  const { workspaceDir } = ctx;

  if (pathname === "/api/desk/today" && req.method === "GET") {
    sendJson(res, 200, { ok: true, today: buildTodayWorkSnapshot(workspaceDir) }, c);
    return true;
  }

  if (pathname === "/api/desk/matters" && req.method === "GET") {
    const kindFilter = url.searchParams.get("kind")?.trim();
    const openTasksByMatter = new Map<string, number>();
    for (const task of listTaskRecords(workspaceDir)) {
      if (!task.matterId || task.status === "rendered" || task.status === "rejected" || task.status === "completed") {
        continue;
      }
      openTasksByMatter.set(task.matterId, (openTasksByMatter.get(task.matterId) ?? 0) + 1);
    }
    const rows = listMatterIdsFromStorage(workspaceDir)
      .map((matterId) => {
        const rec = loadMatter(workspaceDir, matterId);
        if (!rec) {
          return null;
        }
        const kind = parseMatterKind(rec.matterKind);
        if (kindFilter && kindFilter !== "all" && kind !== kindFilter) {
          return null;
        }
        const deadlines = listDeadlinesForMatter(workspaceDir, matterId).filter(
          (d) => d.status === "open" || d.status === "snoozed",
        );
        const hearing = deadlines.find((d) => d.eventKind === "hearing");
        const nextHearingAt = hearing?.dueAt ?? rec.docket?.hearingAt;
        return {
          matterId,
          title: rec.title,
          status: rec.status,
          matterKind: kind,
          matterKindLabel: MATTER_KIND_LABELS[kind],
          clientId: rec.clientId,
          docket: rec.docket,
          openDeadlineCount: deadlines.length,
          openTaskCount: openTasksByMatter.get(matterId) ?? 0,
          nextHearingAt,
          daysUntilHearing: daysUntilIso(nextHearingAt),
        };
      })
      .filter((row) => row !== null);
    sendJson(res, 200, { ok: true, matters: rows }, c);
    return true;
  }

  if (pathname === "/api/desk/plan" && req.method === "POST") {
    try {
      const body = await parseJsonBodyZod(req, planPostSchema);
      const plan = await appendDailyPlanItems(workspaceDir, body.texts, { date: body.date });
      sendJson(res, 200, { ok: true, plan, today: buildTodayWorkSnapshot(workspaceDir) }, c);
    } catch (err) {
      if (isInvalidRequestBodyError(err)) {
        sendJson(res, 400, { ok: false, error: "invalid plan" }, c);
        return true;
      }
      throw err;
    }
    return true;
  }

  const planItemMatch = /^\/api\/desk\/plan\/items\/([^/]+)$/.exec(pathname);
  if (planItemMatch && req.method === "PATCH") {
    try {
      const body = await parseJsonBodyZod(req, planItemPatchSchema);
      const plan = await setDailyPlanItemDone(workspaceDir, decodeURIComponent(planItemMatch[1] ?? ""), body.done, body.date);
      if (!plan) {
        sendJson(res, 404, { ok: false, error: "item not found" }, c);
        return true;
      }
      sendJson(res, 200, { ok: true, plan, today: buildTodayWorkSnapshot(workspaceDir) }, c);
    } catch (err) {
      if (isInvalidRequestBodyError(err)) {
        sendJson(res, 400, { ok: false, error: "invalid patch" }, c);
        return true;
      }
      throw err;
    }
    return true;
  }

  if (pathname === "/api/desk/plan/source-done" && req.method === "POST") {
    try {
      const body = await parseJsonBodyZod(req, sourceDoneSchema);
      const plan = await markDailyPlanSourceDone(workspaceDir, body.source, body.sourceRef, body.date);
      sendJson(res, 200, { ok: true, plan, today: buildTodayWorkSnapshot(workspaceDir) }, c);
    } catch (err) {
      if (isInvalidRequestBodyError(err)) {
        sendJson(res, 400, { ok: false, error: "invalid source" }, c);
        return true;
      }
      throw err;
    }
    return true;
  }

  const dlList = /^\/api\/matters\/([^/]+)\/deadlines$/.exec(pathname);
  if (dlList && req.method === "GET") {
    const matterId = requireMatter(decodeURIComponent(dlList[1] ?? ""), res, c);
    if (!matterId) {
      return true;
    }
    sendJson(res, 200, { ok: true, deadlines: listDeadlinesForMatter(workspaceDir, matterId) }, c);
    return true;
  }
  if (dlList && req.method === "POST") {
    const matterId = requireMatter(decodeURIComponent(dlList[1] ?? ""), res, c);
    if (!matterId) {
      return true;
    }
    try {
      const body = await parseJsonBodyZod(req, deadlinePostSchema);
      const record = recordDeadline(workspaceDir, {
        matterId,
        title: body.title,
        dueAt: body.dueAt,
        eventKind: body.eventKind,
        notes: body.notes,
        remindBeforeHours: body.remindBeforeHours,
        source: "manual",
      });
      sendJson(res, 200, { ok: true, deadline: record }, c);
    } catch (err) {
      if (isInvalidRequestBodyError(err)) {
        sendJson(res, 400, { ok: false, error: "invalid deadline" }, c);
        return true;
      }
      throw err;
    }
    return true;
  }

  const dlIcs = /^\/api\/matters\/([^/]+)\/deadlines\.ics$/.exec(pathname);
  if (dlIcs && req.method === "GET") {
    const matterId = requireMatter(decodeURIComponent(dlIcs[1] ?? ""), res, c);
    if (!matterId) {
      return true;
    }
    const rec = loadMatter(workspaceDir, matterId);
    const ics = formatDeadlinesIcs(
      listDeadlinesForMatter(workspaceDir, matterId).filter((d) => d.status === "open" || d.status === "snoozed"),
      { calendarName: rec?.title ?? matterId },
    );
    res.writeHead(200, {
      "content-type": "text/calendar; charset=utf-8",
      "content-disposition": `attachment; filename="${matterId}-deadlines.ics"`,
      ...c,
    });
    res.end(ics);
    return true;
  }

  const dlOne = /^\/api\/matters\/([^/]+)\/deadlines\/([^/]+)$/.exec(pathname);
  if (dlOne && req.method === "PATCH") {
    const matterId = requireMatter(decodeURIComponent(dlOne[1] ?? ""), res, c);
    const deadlineId = decodeURIComponent(dlOne[2] ?? "");
    if (!matterId) {
      return true;
    }
    try {
      const body = await parseJsonBodyZod(req, deadlinePatchSchema);
      let updated =
        body.status === "completed"
          ? completeDeadline(workspaceDir, matterId, deadlineId)
          : body.status === "snoozed"
            ? snoozeDeadline(workspaceDir, matterId, deadlineId, body.dueAt)
            : patchDeadline(workspaceDir, matterId, deadlineId, body);
      if (!updated) {
        sendJson(res, 404, { ok: false, error: "deadline not found" }, c);
        return true;
      }
      if (body.status === "completed") {
        await markDailyPlanSourceDone(workspaceDir, "deadline", deadlineId);
      }
      sendJson(res, 200, { ok: true, deadline: updated }, c);
    } catch (err) {
      if (isInvalidRequestBodyError(err)) {
        sendJson(res, 400, { ok: false, error: "invalid patch" }, c);
        return true;
      }
      throw err;
    }
    return true;
  }

  if (pathname === "/api/desk/events/extract" && req.method === "POST") {
    try {
      const body = await parseJsonBodyZod(req, extractPostSchema);
      sendJson(res, 200, { ok: true, events: extractLegalEvents(body.text) }, c);
    } catch (err) {
      if (isInvalidRequestBodyError(err)) {
        sendJson(res, 400, { ok: false, error: "invalid extract" }, c);
        return true;
      }
      throw err;
    }
    return true;
  }

  if (pathname === "/api/desk/events/confirm" && req.method === "POST") {
    try {
      const body = await parseJsonBodyZod(req, confirmEventsSchema);
      if (!isValidMatterId(body.matterId)) {
        sendJson(res, 400, { ok: false, error: "invalid matter id" }, c);
        return true;
      }
      const recorded = body.events.map((ev) =>
        recordDeadline(workspaceDir, {
          matterId: body.matterId,
          title: ev.title,
          dueAt: ev.dueAt,
          eventKind: ev.eventKind,
          notes: ev.notes,
          source: "document_extract",
          remindBeforeHours: defaultRemindBeforeHours(ev.eventKind),
        }),
      );
      sendJson(res, 200, { ok: true, deadlines: recorded }, c);
    } catch (err) {
      if (isInvalidRequestBodyError(err)) {
        sendJson(res, 400, { ok: false, error: "invalid confirm" }, c);
        return true;
      }
      throw err;
    }
    return true;
  }

  if (pathname === "/api/workspace/standards" && req.method === "GET") {
    sendJson(res, 200, { ok: true, standards: loadUserStandards(workspaceDir) }, c);
    return true;
  }
  if (pathname === "/api/workspace/standards" && req.method === "POST") {
    try {
      const body = await parseJsonBodyZod(req, standardSaveSchema);
      const saved = await saveUserStandard(workspaceDir, {
        id: body.id,
        title: body.title,
        kind: body.kind,
        enabled: body.enabled,
        items: body.items?.map((item) => ({ text: item.text, tone: item.tone ?? "check" })),
        bindWhen: body.bindWhen,
        source: "lawyer",
      });
      sendJson(res, 200, { ok: true, standard: saved }, c);
    } catch (err) {
      if (isInvalidRequestBodyError(err)) {
        sendJson(res, 400, { ok: false, error: "invalid standard" }, c);
        return true;
      }
      throw err;
    }
    return true;
  }

  const stdOne = /^\/api\/workspace\/standards\/([^/]+)$/.exec(pathname);
  if (stdOne && req.method === "DELETE") {
    const ok = await deleteUserStandard(workspaceDir, decodeURIComponent(stdOne[1] ?? ""));
    sendJson(res, ok ? 200 : 400, { ok }, c);
    return true;
  }

  if (pathname === "/api/desk/standards/match" && req.method === "POST") {
    try {
      const body = await parseJsonBodyZod(
        req,
        z.object({
          instruction: z.string().optional(),
          clientId: z.string().optional(),
          contractType: z.string().optional(),
          skipIds: z.array(z.string()).optional(),
        }),
      );
      const inferred = body.contractType || inferClosedContractType(body.instruction ?? "")?.id;
      const matched = matchUserStandards(workspaceDir, {
        instruction: body.instruction,
        clientId: body.clientId,
        contractType: inferred,
      }).filter((s) => !(body.skipIds ?? []).includes(s.id));
      sendJson(res, 200, { ok: true, standards: matched, contractType: inferred }, c);
    } catch (err) {
      if (isInvalidRequestBodyError(err)) {
        sendJson(res, 400, { ok: false, error: "invalid match" }, c);
        return true;
      }
      throw err;
    }
    return true;
  }

  const pulseGet = /^\/api\/matters\/([^/]+)\/pulse$/.exec(pathname);
  if (pulseGet && req.method === "GET") {
    const matterId = requireMatter(decodeURIComponent(pulseGet[1] ?? ""), res, c);
    if (!matterId) {
      return true;
    }
    const pulse = buildMatterPulse(workspaceDir, matterId);
    if (!pulse) {
      sendJson(res, 404, { ok: false, error: "matter not found" }, c);
      return true;
    }
    sendJson(res, 200, { ok: true, pulse }, c);
    return true;
  }

  const intakeConfirm = /^\/api\/matters\/([^/]+)\/intake-brief\/confirm$/.exec(pathname);
  if (intakeConfirm && req.method === "POST") {
    const matterId = requireMatter(decodeURIComponent(intakeConfirm[1] ?? ""), res, c);
    if (!matterId) {
      return true;
    }
    const brief = await confirmIntakeBrief(workspaceDir, matterId);
    if (!brief) {
      sendJson(res, 404, { ok: false, error: "brief not found" }, c);
      return true;
    }
    sendJson(res, 200, { ok: true, brief }, c);
    return true;
  }

  const intakeGet = /^\/api\/matters\/([^/]+)\/intake-brief$/.exec(pathname);
  if (intakeGet && req.method === "GET") {
    const matterId = requireMatter(decodeURIComponent(intakeGet[1] ?? ""), res, c);
    if (!matterId) {
      return true;
    }
    sendJson(res, 200, { ok: true, brief: loadIntakeBrief(workspaceDir, matterId) ?? null }, c);
    return true;
  }
  if (intakeGet && req.method === "POST") {
    const matterId = requireMatter(decodeURIComponent(intakeGet[1] ?? ""), res, c);
    if (!matterId) {
      return true;
    }
    try {
      const body = await parseJsonBodyZod(req, compileTalkSchema);
      const brief = compileIntakeBrief({ matterId, transcript: body.transcript, workspaceDir });
      const saved = await saveIntakeBrief(workspaceDir, brief);
      sendJson(res, 200, { ok: true, brief: saved }, c);
    } catch (err) {
      if (isInvalidRequestBodyError(err)) {
        sendJson(res, 400, { ok: false, error: "invalid transcript" }, c);
        return true;
      }
      throw err;
    }
    return true;
  }

  const similar = /^\/api\/matters\/([^/]+)\/similar-cases$/.exec(pathname);
  if (similar && req.method === "GET") {
    const matterId = requireMatter(decodeURIComponent(similar[1] ?? ""), res, c);
    if (!matterId) {
      return true;
    }
    const hits = await listSimilarCasesForDesk({
      workspaceDir,
      matterId,
      query: url.searchParams.get("q") ?? undefined,
    });
    sendJson(res, 200, { ok: true, hits }, c);
    return true;
  }

  const causeApply = /^\/api\/matters\/([^/]+)\/cause$/.exec(pathname);
  if (causeApply && req.method === "POST") {
    const matterId = requireMatter(decodeURIComponent(causeApply[1] ?? ""), res, c);
    if (!matterId) {
      return true;
    }
    try {
      const body = await parseJsonBodyZod(req, causeApplySchema);
      const updated = await updateMatterProfile(workspaceDir, {
        matterId,
        causeOfAction: body.causeOfAction,
      });
      const brief = await confirmIntakeBrief(workspaceDir, matterId);
      sendJson(res, 200, { ok: Boolean(updated), causeOfAction: body.causeOfAction, brief: brief ?? null }, c);
    } catch (err) {
      if (isInvalidRequestBodyError(err)) {
        sendJson(res, 400, { ok: false, error: "invalid cause" }, c);
        return true;
      }
      throw err;
    }
    return true;
  }

  if (pathname === "/api/workspace/cause-lexicon" && req.method === "GET") {
    sendJson(res, 200, { ok: true, lexicon: loadCauseLexicon(workspaceDir) }, c);
    return true;
  }
  if (pathname === "/api/workspace/cause-lexicon" && req.method === "POST") {
    try {
      const body = await parseJsonBodyZod(req, lexiconPostSchema);
      const lexicon = await saveCauseLexicon(workspaceDir, body.causes);
      sendJson(res, 200, { ok: true, lexicon }, c);
    } catch (err) {
      if (isInvalidRequestBodyError(err)) {
        sendJson(res, 400, { ok: false, error: "invalid lexicon" }, c);
        return true;
      }
      throw err;
    }
    return true;
  }

  return false;
}
