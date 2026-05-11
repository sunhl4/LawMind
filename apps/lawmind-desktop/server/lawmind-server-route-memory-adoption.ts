/**
 * /api/memory/adoption — W6
 *
 * - GET    /api/memory/adoption?scope=&state=&matterId=
 * - POST   /api/memory/adoption/suggest
 * - POST   /api/memory/adoption/adopt    { id }
 * - POST   /api/memory/adoption/dismiss  { id, note? }
 *
 * 用于 Inspector UI 列出 / 采纳 / 撤回 / 暂存 / 永久忽略 待审记忆建议。
 */

import {
  adoptMemorySuggestion,
  dismissMemorySuggestion,
  listMemorySuggestions,
  suggestMemoryAdoption,
  type MemoryAdoptionState,
  type MemoryScope,
} from "../../../src/lawmind/memory/adoption-service.js";
import type { LawmindRouteContext } from "./lawmind-server-route-types.js";
import { readJsonBody, resolveDesktopActorId, sendJson } from "./lawmind-server-helpers.js";

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
  if (pathname === "/api/memory/adoption" && req.method === "GET") {
    const scope = asScope(url.searchParams.get("scope"));
    const state = asState(url.searchParams.get("state"));
    const targetId = url.searchParams.get("matterId") ?? url.searchParams.get("targetId") ?? undefined;
    const items = await listMemorySuggestions(workspaceDir, {
      scope,
      state,
      targetId: targetId ?? undefined,
    });
    sendJson(res, 200, { ok: true, items }, c);
    return true;
  }

  if (pathname === "/api/memory/adoption/suggest" && req.method === "POST") {
    const body = (await readJsonBody(req)) as Record<string, unknown> | null;
    if (!body || typeof body !== "object") {
      sendJson(res, 400, { ok: false, error: "missing body" }, c);
      return true;
    }
    const scope = asScope(typeof body.scope === "string" ? body.scope : null);
    if (!scope) {
      sendJson(res, 400, { ok: false, error: "invalid scope" }, c);
      return true;
    }
    const kind = typeof body.kind === "string" ? body.kind : undefined;
    const payload = typeof body.payload === "string" ? body.payload : undefined;
    if (!kind || !payload) {
      sendJson(res, 400, { ok: false, error: "missing kind or payload" }, c);
      return true;
    }
    try {
      const rec = await suggestMemoryAdoption(
        workspaceDir,
        auditDir,
        {
          scope,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          kind: kind as any,
          payload,
          targetId: typeof body.targetId === "string" ? body.targetId : undefined,
          sourceTaskId: typeof body.sourceTaskId === "string" ? body.sourceTaskId : undefined,
          origin: "lawyer",
          note: typeof body.note === "string" ? body.note : undefined,
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
    const body = (await readJsonBody(req)) as Record<string, unknown> | null;
    if (!body || typeof body.id !== "string") {
      sendJson(res, 400, { ok: false, error: "missing id" }, c);
      return true;
    }
    const result = await adoptMemorySuggestion(workspaceDir, auditDir, body.id, () => {
      // Inspector adoption is informational by default — actual writeback paths are
      // already handled by their respective writers (case markdown, profile md).
    }, {
      actorId: resolveDesktopActorId(),
      note: typeof body.note === "string" ? body.note : undefined,
    });
    sendJson(res, result.ok ? 200 : 400, result, c);
    return true;
  }

  if (pathname === "/api/memory/adoption/dismiss" && req.method === "POST") {
    const body = (await readJsonBody(req)) as Record<string, unknown> | null;
    if (!body || typeof body.id !== "string") {
      sendJson(res, 400, { ok: false, error: "missing id" }, c);
      return true;
    }
    const result = await dismissMemorySuggestion(workspaceDir, auditDir, body.id, {
      actorId: resolveDesktopActorId(),
      note: typeof body.note === "string" ? body.note : undefined,
    });
    sendJson(res, result.ok ? 200 : 400, result, c);
    return true;
  }

  return false;
}
