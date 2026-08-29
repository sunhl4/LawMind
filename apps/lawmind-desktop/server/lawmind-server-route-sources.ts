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
import { isInvalidRequestBodyError, parseJsonBodyZod } from "./lawmind-api-parse.js";
import { sourceAnnotationPostSchema } from "./lawmind-api-schemas.js";
import type { LawmindRouteContext } from "./lawmind-server-route-types.js";
import { sendJson } from "./lawmind-server-helpers.js";
import {
  createSourceAnnotation,
  listSourceAnnotations,
  SOURCE_ANNOTATION_KINDS,
} from "../../../src/lawmind/sources/source-annotation.js";
import { isSafeTaskIdSegment } from "./safe-task-id.js";
import {
  resolveSourceAnchorId,
  sectionAnchorExcerpt,
  type SourceSectionCiting,
} from "./lawmind-source-anchor.js";

type Hit = {
  source: ResearchSource;
  supportingClaims: ResearchClaim[];
  taskId: string;
  sectionsCiting: SourceSectionCiting[];
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

function sectionsCitingId(
  draft: ArtifactDraft | undefined,
  sourceId: string,
  taskId: string,
): SourceSectionCiting[] {
  if (!draft) {
    return [];
  }
  const out: SourceSectionCiting[] = [];
  for (const sec of draft.sections) {
    const cites = (sec.citations ?? []).map((c) => String(c).trim());
    if (cites.includes(sourceId)) {
      out.push({
        heading: sec.heading,
        anchorId: resolveSourceAnchorId(taskId, sec.heading),
        excerpt: sectionAnchorExcerpt(sec.body),
      });
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
    sectionsCiting: sectionsCitingId(draft, sourceId, taskId),
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
  url,
  c,
}: LawmindRouteContext): Promise<boolean> {
  const annotationsMatch = pathname.match(/^\/api\/sources\/([^/]+)\/annotations$/);
  if (annotationsMatch) {
    const rawId = decodeURIComponent(annotationsMatch[1] ?? "");
    if (!isSafeSourceId(rawId)) {
      sendJson(res, 400, { ok: false, error: "invalid source id" }, c);
      return true;
    }
    const { workspaceDir } = ctx;
    const taskId = url.searchParams.get("taskId")?.trim() || undefined;
    const matterId = url.searchParams.get("matterId")?.trim() || undefined;

    if (req.method === "GET") {
      const items = listSourceAnnotations(workspaceDir, {
        sourceId: rawId,
        taskId,
        matterId,
      });
      sendJson(res, 200, { ok: true, sourceId: rawId, items }, c);
      return true;
    }

    if (req.method === "POST") {
      let body;
      try {
        body = await parseJsonBodyZod(req, sourceAnnotationPostSchema);
      } catch (err) {
        if (isInvalidRequestBodyError(err)) {
          sendJson(res, 400, { ok: false, error: "comment_required" }, c);
          return true;
        }
        throw err;
      }
      const comment = body.comment;
      const kindRaw = body.kind?.trim() || "comment";
      const kind = (SOURCE_ANNOTATION_KINDS as readonly string[]).includes(kindRaw)
        ? (kindRaw as (typeof SOURCE_ANNOTATION_KINDS)[number])
        : "comment";
      const row = await createSourceAnnotation(workspaceDir, `${workspaceDir}/audit`, {
        sourceId: rawId,
        taskId: body.taskId ?? taskId,
        matterId: body.matterId ?? matterId,
        comment,
        kind,
        createdBy: body.createdBy ?? "lawyer",
        linkedDraftId: body.linkedDraftId,
        createLearning: body.createLearning === true,
        range: body.range
          ? {
              start: Math.max(0, Math.floor(body.range.start)),
              end: Math.max(0, Math.floor(body.range.end)),
            }
          : undefined,
      });
      sendJson(res, 200, { ok: true, annotation: row }, c);
      return true;
    }

    return false;
  }

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

