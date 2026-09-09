/**
 * /api/memory/adoption — W6
 *
 * - GET    /api/memory/adoption?scope=&state=&matterId=
 * - POST   /api/memory/adoption/suggest
 * - POST   /api/memory/adoption/adopt    { id, note? }  note = 改写后写入时的落盘正文覆盖
 * - POST   /api/memory/adoption/dismiss  { id, note? }
 *
 * 用于 Inspector UI 列出 / 采纳 / 忽略 待审记忆建议。「稍后再说」仅前端会话内搁置，不写库。
 */

import {
  adoptMemorySuggestion,
  dismissMemorySuggestion,
  listMemorySuggestions,
  suggestMemoryAdoption,
  type MemoryAdoptionState,
  type MemoryScope,
} from "../../../src/lawmind/memory/adoption-service.js";
import { applyMemoryAdoptionWrite } from "../../../src/lawmind/memory/adoption-apply.js";
import {
  adoptLearningSuggestion,
  dismissLearningSuggestion,
} from "../../../src/lawmind/learning/suggestion-queue.js";
import { listPendingAdoptionsUnified } from "../../../src/lawmind/memory/unified-pending-adoptions.js";

const LEARNING_ID_PREFIX = "learning:";

function learningSuggestionId(id: string): string | undefined {
  if (!id.startsWith(LEARNING_ID_PREFIX)) {
    return undefined;
  }
  const raw = id.slice(LEARNING_ID_PREFIX.length).trim();
  return raw || undefined;
}
import { buildAdoptionPreviewDiff } from "../../../src/lawmind/memory/adoption-preview-diff.js";
import { isInvalidRequestBodyError, parseJsonBodyZod } from "./lawmind-api-parse.js";
import {
  memoryAdoptionIdSchema,
  memoryAdoptionSuggestSchema,
} from "./lawmind-api-schemas.js";
import type { LawmindRouteContext } from "./lawmind-server-route-types.js";
import { resolveDesktopActorId, sendJson } from "./lawmind-server-helpers.js";

const VALID_SCOPES: ReadonlyArray<MemoryScope> = [
  "firm",
  "lawyer",
  "client",
  "matter",
  "playbook",
  "opponent",
  "project",
  "assistant",
];

const VALID_STATES: ReadonlyArray<MemoryAdoptionState> = [
  "pending",
  "adopted",
  "auto_adopted",
  "dismissed",
  "recorded_noop",
];

function asScope(value: string | null): MemoryScope | undefined {
  if (!value) {return undefined;}
  return (VALID_SCOPES as readonly string[]).includes(value) ? (value as MemoryScope) : undefined;
}

function asState(value: string | null): MemoryAdoptionState | undefined {
  if (!value) {return undefined;}
  return (VALID_STATES as readonly string[]).includes(value)
    ? (value as MemoryAdoptionState)
    : undefined;
}

export async function handleMemoryAdoptionRoutes({
  ctx,
  req,
  res,
  url,
  pathname,
  c,
}: LawmindRouteContext): Promise<boolean> {
  const { workspaceDir } = ctx;
  const auditDir = `${workspaceDir}/audit`;

  const previewDiffMatch = pathname.match(/^\/api\/memory\/adoption\/([^/]+)\/preview-diff$/);
  if (previewDiffMatch && req.method === "GET") {
    const id = decodeURIComponent(previewDiffMatch[1] ?? "");
    const matterId = url.searchParams.get("matterId")?.trim() || undefined;
    const result = await buildAdoptionPreviewDiff(workspaceDir, id, { matterId });
    if (!result.ok) {
      const status = result.error === "not_found" ? 404 : 400;
      sendJson(res, status, result, c);
      return true;
    }
    sendJson(res, 200, result, c);
    return true;
  }

  if (pathname === "/api/memory/adoption" && req.method === "GET") {
    const scope = asScope(url.searchParams.get("scope"));
    const state = asState(url.searchParams.get("state"));
    const targetId = url.searchParams.get("matterId") ?? url.searchParams.get("targetId") ?? undefined;
    const unified = url.searchParams.get("unified") !== "0";
    if (unified && (!state || state === "pending")) {
      let items = await listPendingAdoptionsUnified(workspaceDir);
      if (scope) {
        items = items.filter((i) => i.scope === scope);
      }
      if (targetId) {
        items = items.filter((i) => i.targetId === targetId);
      }
      sendJson(res, 200, { ok: true, items, unified: true }, c);
      return true;
    }
    const items = await listMemorySuggestions(workspaceDir, {
      scope,
      state,
      targetId: targetId ?? undefined,
    });
    sendJson(res, 200, { ok: true, items, unified: false }, c);
    return true;
  }

  if (pathname === "/api/memory/adoption/suggest" && req.method === "POST") {
    let body;
    try {
      body = await parseJsonBodyZod(req, memoryAdoptionSuggestSchema);
    } catch (err) {
      if (isInvalidRequestBodyError(err)) {
        const msg = err.issues.join("; ");
        if (msg.includes("scope")) {
          sendJson(res, 400, { ok: false, error: "invalid scope" }, c);
          return true;
        }
        if (msg.includes("kind") || msg.includes("payload")) {
          sendJson(res, 400, { ok: false, error: "missing kind or payload" }, c);
          return true;
        }
        sendJson(res, 400, { ok: false, error: "missing body" }, c);
        return true;
      }
      throw err;
    }
    const scope = body.scope;
    try {
      const rec = await suggestMemoryAdoption(
        workspaceDir,
        auditDir,
        {
          scope,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          kind: body.kind as any,
          payload: body.payload,
          targetId: body.targetId,
          sourceTaskId: body.sourceTaskId,
          origin: "lawyer",
          note: body.note,
        },
        { autoAdopt: body.autoAdopt === true },
      );
      sendJson(res, 200, { ok: true, suggestion: rec }, c);
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      sendJson(res, 400, { ok: false, error: msg }, c);
      return true;
    }
  }

  if (pathname === "/api/memory/adoption/adopt" && req.method === "POST") {
    let body;
    try {
      body = await parseJsonBodyZod(req, memoryAdoptionIdSchema);
    } catch (err) {
      if (isInvalidRequestBodyError(err)) {
        sendJson(res, 400, { ok: false, error: "missing id" }, c);
        return true;
      }
      throw err;
    }
    try {
      const learnId = learningSuggestionId(body.id);
      if (learnId) {
        const result = await adoptLearningSuggestion(workspaceDir, auditDir, learnId);
        sendJson(res, result.ok ? 200 : 400, result, c);
        return true;
      }
      const rewritten = body.note?.trim();
      const result = await adoptMemorySuggestion(
        workspaceDir,
        auditDir,
        body.id,
        async (rec) => {
          // 改写后写入：note 覆盖落盘正文；否则写原 payload。
          // writer 回执（含 noopReason）回流到状态机：无落盘面时记 recorded_noop。
          const toWrite = rewritten ? { ...rec, payload: rewritten } : rec;
          return applyMemoryAdoptionWrite(workspaceDir, toWrite, {
            envFile: ctx.envFile,
            auditDir,
          });
        },
        {
          actorId: resolveDesktopActorId(),
          note: rewritten ? "rewritten" : body.note,
        },
      );
      sendJson(res, result.ok ? 200 : 400, result, c);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      sendJson(res, 400, { ok: false, error: msg }, c);
    }
    return true;
  }

  if (pathname === "/api/memory/adoption/dismiss" && req.method === "POST") {
    let body;
    try {
      body = await parseJsonBodyZod(req, memoryAdoptionIdSchema);
    } catch (err) {
      if (isInvalidRequestBodyError(err)) {
        sendJson(res, 400, { ok: false, error: "missing id" }, c);
        return true;
      }
      throw err;
    }
    const learnId = learningSuggestionId(body.id);
    if (learnId) {
      const result = await dismissLearningSuggestion(workspaceDir, auditDir, learnId);
      sendJson(res, result.ok ? 200 : 400, result, c);
      return true;
    }
    const result = await dismissMemorySuggestion(workspaceDir, auditDir, body.id, {
      actorId: resolveDesktopActorId(),
      note: body.note,
    });
    sendJson(res, result.ok ? 200 : 400, result, c);
    return true;
  }

  return false;
}
