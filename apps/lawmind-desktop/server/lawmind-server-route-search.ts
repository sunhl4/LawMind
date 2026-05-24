/**
 * Workspace FTS search (audit + session turns).
 *
 * GET  /api/search/workspace?q=&matterId=&source=audit,session&limit=
 * POST /api/search/workspace/rebuild
 */

import type { LawmindRouteContext } from "./lawmind-server-route-types.js";
import { isValidMatterId } from "../../../src/lawmind/cases/index.js";
import {
  getSearchIndexStatus,
  rebuildWorkspaceSearchIndex,
  searchWorkspaceIndex,
  type SearchIndexSource,
} from "../../../src/lawmind/indexing/index.js";
import { sendJson } from "./lawmind-server-helpers.js";

function parseSources(raw: string | null): SearchIndexSource[] | undefined {
  if (!raw?.trim()) {
    return undefined;
  }
  const allowed = new Set<SearchIndexSource>(["audit", "session"]);
  const parts = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s): s is SearchIndexSource => allowed.has(s as SearchIndexSource));
  return parts.length > 0 ? parts : undefined;
}

export async function handleSearchRoutes({
  ctx,
  req,
  res,
  url,
  pathname,
  c,
}: LawmindRouteContext): Promise<boolean> {
  const { workspaceDir } = ctx;

  if (pathname === "/api/search/workspace/rebuild" && req.method === "POST") {
    const allow =
      process.env.LAWMIND_ALLOW_INDEX_REBUILD?.trim() === "1" ||
      process.env.LAWMIND_ALLOW_INDEX_REBUILD?.trim().toLowerCase() === "true";
    if (!allow) {
      sendJson(
        res,
        403,
        {
          ok: false,
          error: "index_rebuild_disabled",
          hint: "设置 LAWMIND_ALLOW_INDEX_REBUILD=1 后可在本机重建全文索引。",
        },
        c,
      );
      return true;
    }
    const started = Date.now();
    const result = await rebuildWorkspaceSearchIndex(workspaceDir);
    const status = getSearchIndexStatus(workspaceDir);
    sendJson(
      res,
      200,
      {
        ok: true,
        ...result,
        durationMs: result.durationMs ?? Date.now() - started,
        searchIndex: status,
      },
      c,
    );
    return true;
  }

  if (pathname === "/api/search/workspace" && req.method === "GET") {
    const q = url.searchParams.get("q") ?? "";
    const matterId = url.searchParams.get("matterId")?.trim() ?? "";
    if (matterId && !isValidMatterId(matterId)) {
      sendJson(res, 400, { ok: false, error: "invalid_matter_id" }, c);
      return true;
    }
    const limitRaw = url.searchParams.get("limit");
    const limit = limitRaw ? Number(limitRaw) : undefined;
    const sources = parseSources(url.searchParams.get("source"));
    const result = searchWorkspaceIndex(workspaceDir, {
      q,
      matterId: matterId || undefined,
      sources,
      limit: Number.isFinite(limit) ? limit : undefined,
    });
    const searchIndex = getSearchIndexStatus(workspaceDir);
    sendJson(res, 200, { ...result, searchIndex }, c);
    return true;
  }

  return false;
}
