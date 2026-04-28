/**
 * Source preview route — Deliverable-First Architecture P3 (来源锚点).
 *
 *   GET /api/sources/:id/preview?taskId=<taskId>
 *     -> { ok, source: ResearchSource, supportingClaims: ResearchClaim[],
 *          taskId, sectionsCiting: Array<{ heading: string }> }
 *
 *     - If `taskId` is provided, look up the source inside the persisted research
 *       snapshot for that draft and report which draft sections cite it.
 *     - If `taskId` is absent, scan every research snapshot in the workspace and
 *       return the first hit (rare; mainly for dev / chat citations that don't
 *       carry a draft taskId).
 *
 *     Returns 404 if the source ID is unknown.
 *
 * Why: hovering / clicking a citation pill should reveal what the underlying
 * source actually is (title, citation string, URL, court, case number) and
 * which claims it supports. This is the trust moat that closes the gap with
 * Harvey / Spellbook style verifiable provenance.
 *
 * Read-only; no side effects.
 */

import fs from "node:fs";
import path from "node:path";
import { readResearchSnapshot } from "../../../src/lawmind/drafts/research-snapshot.js";
import { readDraft } from "../../../src/lawmind/drafts/index.js";
import type {
  ArtifactDraft,
  ResearchBundle,
  ResearchClaim,
  ResearchSource,
} from "../../../src/lawmind/types.js";
import type { LawmindRouteContext } from "./lawmind-server-route-types.js";
import { sendJson } from "./lawmind-server-helpers.js";
import { isSafeTaskIdSegment } from "./safe-task-id.js";

type Hit = {
  source: ResearchSource;
  supportingClaims: ResearchClaim[];
  taskId: string;
  sectionsCiting: Array<{ heading: string }>;
};

/**
 * Source IDs are user-supplied strings (e.g. "s-001" or a UUID). We only block
 * filesystem-traversal characters; otherwise we let any printable character
 * through so legacy snapshots keep working.
 */
function isSafeSourceId(raw: string): boolean {
  if (raw.length === 0 || raw.length > 256) {
    return false;
  }
  if (raw.includes("/") || raw.includes("\\") || raw.includes("\0")) {
    return false;
  }
  return true;
}

function sectionsCitingId(draft: ArtifactDraft | undefined, sourceId: string): Array<{ heading: string }> {
  if (!draft) {
    return [];
  }
  const out: Array<{ heading: string }> = [];
  for (const sec of draft.sections) {
    const cites = (sec.citations ?? []).map((c) => String(c).trim());
    if (cites.includes(sourceId)) {
      out.push({ heading: sec.heading });
    }
  }
  return out;
}

function findInBundle(
  bundle: ResearchBundle,
  sourceId: string,
  taskId: string,
  draft: ArtifactDraft | undefined,
): Hit | null {
  const source = bundle.sources.find((s) => s.id === sourceId);
  if (!source) {
    return null;
  }
  const supportingClaims = bundle.claims.filter((c) => c.sourceIds.includes(sourceId));
  return {
    source,
    supportingClaims,
    taskId,
    sectionsCiting: sectionsCitingId(draft, sourceId),
  };
}

/**
 * Fallback scan when the caller did not pass a taskId. We walk every persisted
 * research snapshot in the workspace and return the first matching source.
 * Bounded by the number of drafts (already on disk), so the cost is linear in
 * snapshots — fine for desktop scale; if this ever needs a real index we can
 * add a sources/ aggregate layer.
 */
function scanWorkspaceForSource(workspaceDir: string, sourceId: string): Hit | null {
  let names: string[];
  try {
    names = fs.readdirSync(path.join(workspaceDir, "drafts"));
  } catch {
    return null;
  }
  for (const name of names) {
    if (!name.endsWith(".research.json")) {
      continue;
    }
    const taskId = name.slice(0, -".research.json".length);
    const bundle = readResearchSnapshot(workspaceDir, taskId);
    if (!bundle) {
      continue;
    }
    const draft = readDraft(workspaceDir, taskId);
    const hit = findInBundle(bundle, sourceId, taskId, draft);
    if (hit) {
      return hit;
    }
  }
  return null;
}

export async function handleSourceRoutes({
  ctx,
  pathname,
  req,
  res,
  c,
}: LawmindRouteContext): Promise<boolean> {
  if (req.method !== "GET") {
    return false;
  }

  const previewMatch = pathname.match(/^\/api\/sources\/([^/]+)\/preview$/);
  if (!previewMatch) {
    return false;
  }
  const rawId = decodeURIComponent(previewMatch[1] ?? "");
  if (!isSafeSourceId(rawId)) {
    sendJson(res, 400, { ok: false, error: "invalid source id" }, c);
    return true;
  }

  const url = new URL(req.url ?? "/", "http://localhost");
  const taskIdParam = url.searchParams.get("taskId")?.trim();
  const { workspaceDir } = ctx;

  let hit: Hit | null = null;

  if (taskIdParam) {
    if (!isSafeTaskIdSegment(taskIdParam)) {
      sendJson(res, 400, { ok: false, error: "invalid task id" }, c);
      return true;
    }
    const bundle = readResearchSnapshot(workspaceDir, taskIdParam);
    if (!bundle) {
      sendJson(
        res,
        404,
        { ok: false, error: "research_snapshot_not_found", taskId: taskIdParam },
        c,
      );
      return true;
    }
    hit = findInBundle(bundle, rawId, taskIdParam, readDraft(workspaceDir, taskIdParam));
  } else {
    hit = scanWorkspaceForSource(workspaceDir, rawId);
  }

  if (!hit) {
    sendJson(res, 404, { ok: false, error: "source_not_found", sourceId: rawId }, c);
    return true;
  }

  sendJson(
    res,
    200,
    {
      ok: true,
      source: hit.source,
      supportingClaims: hit.supportingClaims,
      taskId: hit.taskId,
      sectionsCiting: hit.sectionsCiting,
    },
    c,
  );
  return true;
}

