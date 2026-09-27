/**
 * GET  /api/memory/library?view=habits|matter|revoked&matterId=
 * POST /api/memory/library/confirm  { id, body? }
 * POST /api/memory/library/revoke   { id }
 * POST /api/memory/library/restore  { id }
 * POST /api/memory/library/dismiss  { id }
 */

import { z } from "zod";
import {
  confirmMemory,
  dismissMemoryRecord,
  listMemoryLibrary,
  restoreMemory,
  revokeMemory,
} from "../../../src/lawmind/memory/kernel/gateway.js";
import { ensureMemoryImported } from "../../../src/lawmind/memory/kernel/migrate.js";
import { isInvalidRequestBodyError, parseJsonBodyZod } from "./lawmind-api-parse.js";
import { sendJson } from "./lawmind-server-helpers.js";
import type { LawmindRouteContext } from "./lawmind-server-route-types.js";

const viewSchema = z.enum(["habits", "matter", "revoked"]);

const idSchema = z.object({
  id: z.string().min(1),
  body: z.string().optional(),
  key: z.string().optional(),
  scope: z.enum(["lawyer", "client", "matter", "firm"]).optional(),
  scopeId: z.string().optional(),
});

export async function handleMemoryLibraryRoutes(args: LawmindRouteContext): Promise<boolean> {
  const { ctx, req, res, url, pathname, c } = args;
  const workspaceDir = ctx.workspaceDir;

  if (pathname === "/api/memory/library" && req.method === "GET") {
    const viewParsed = viewSchema.safeParse(url.searchParams.get("view") ?? "habits");
    if (!viewParsed.success) {
      sendJson(res, 400, { ok: false, error: "invalid view" }, c);
      return true;
    }
    ensureMemoryImported(workspaceDir);
    const items = listMemoryLibrary(
      workspaceDir,
      viewParsed.data,
      url.searchParams.get("matterId") ?? undefined,
    );
    sendJson(res, 200, { ok: true, view: viewParsed.data, items }, c);
    return true;
  }

  if (req.method !== "POST") {
    return false;
  }
  if (
    pathname !== "/api/memory/library/confirm" &&
    pathname !== "/api/memory/library/revoke" &&
    pathname !== "/api/memory/library/restore" &&
    pathname !== "/api/memory/library/dismiss"
  ) {
    return false;
  }
  let body: z.infer<typeof idSchema>;
  try {
    body = await parseJsonBodyZod(req, idSchema);
  } catch (err) {
    if (isInvalidRequestBodyError(err)) {
      sendJson(res, 400, { ok: false, error: "missing id" }, c);
      return true;
    }
    throw err;
  }
  if (pathname === "/api/memory/library/confirm") {
    try {
      const record = await confirmMemory(workspaceDir, body.id, {
        body: body.body,
        key: body.key,
        scope: body.scope,
        scopeId: body.scopeId,
      });
      sendJson(
        res,
        record ? 200 : 400,
        record ? { ok: true, record } : { ok: false, error: "not_pending" },
        c,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      sendJson(res, 400, { ok: false, error: msg }, c);
    }
    return true;
  }
  if (pathname === "/api/memory/library/revoke") {
    const record = revokeMemory(workspaceDir, body.id);
    sendJson(res, record ? 200 : 400, record ? { ok: true, record } : { ok: false, error: "not_current" }, c);
    return true;
  }
  if (pathname === "/api/memory/library/restore") {
    const record = await restoreMemory(workspaceDir, body.id);
    sendJson(res, record ? 200 : 400, record ? { ok: true, record } : { ok: false, error: "not_revoked" }, c);
    return true;
  }
  const record = dismissMemoryRecord(workspaceDir, body.id);
  sendJson(res, record ? 200 : 400, record ? { ok: true, record } : { ok: false, error: "not_pending" }, c);
  return true;
}
