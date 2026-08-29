/**
 * Workspace FTS search (audit + session turns + personal knowledge).
 *
 * GET  /api/search/workspace?q=&matterId=&source=audit,session,knowledge|all&limit=
 * POST /api/search/workspace/rebuild
 */

import type { LawmindRouteContext } from "./lawmind-server-route-types.js";
import { isValidMatterId } from "../../../src/lawmind/cases/index.js";
import {
  getSearchIndexStatus,
  rebuildWorkspaceSearchIndex,
  searchPersonalKnowledge,
  searchWorkspaceIndex,
  type SearchIndexSource,
  type WorkspaceSearchHit,
} from "../../../src/lawmind/indexing/index.js";
import { sendJson } from "./lawmind-server-helpers.js";

function parseSources(raw: string | null): SearchIndexSource[] | undefined {
  if (!raw?.trim()) {
    return undefined;
  }
  const token = raw.trim().toLowerCase();
  if (token === "all") {
    return ["audit", "session", "knowledge"];
  }
  if (token === "knowledge") {
    return ["knowledge"];
  }
  const allowed = new Set<SearchIndexSource>(["audit", "session", "knowledge"]);
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
    const limit = Number.isFinite(limitRaw ? Number(limitRaw) : NaN)
      ? Number(limitRaw)
      : 30;
    const sources = parseSources(url.searchParams.get("source"));
    const wantKnowledge = !sources || sources.includes("knowledge");
    const nonKnowledge = (sources ?? ["audit", "session", "knowledge"]).filter(
      (s) => s !== "knowledge",
    ) as SearchIndexSource[];

    const hits: WorkspaceSearchHit[] = [];
    if (nonKnowledge.length > 0 && !(sources?.length === 1 && sources[0] === "knowledge")) {
      const base = searchWorkspaceIndex(workspaceDir, {
        q,
        matterId: matterId || undefined,
        sources: nonKnowledge,
        limit,
      });
      hits.push(...base.hits);
    }
    if (wantKnowledge) {
      const knowledge = await searchPersonalKnowledge(workspaceDir, {
        q,
        matterId: matterId || undefined,
        limit,
        autoRebuild: false,
      });
      for (const h of knowledge.hits) {
        hits.push({
          source: "knowledge",
          id: h.path,
          path: h.path,
          docKind: h.docKind,
          section: h.section,
          matterId: h.matterId,
          snippet: h.snippet,
          score: h.score,
        });
      }
    }
    const searchIndex = getSearchIndexStatus(workspaceDir);
    sendJson(
      res,
      200,
      {
        ok: true,
        query: q,
        hits: hits.slice(0, limit),
        indexMissing: !searchIndex.ready,
        searchIndex,
      },
      c,
    );
    return true;
  }

  return false;
}
