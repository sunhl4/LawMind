/**
 * 合同修订「待验收」草稿与验收落库
 *
 * POST /api/learning/contract-review/drafts — 保存/更新草稿（律师批注、要点、路径）
 * GET  /api/learning/contract-review/drafts — 列出待处理草稿
 * POST /api/learning/contract-review/drafts/accept — 验收通过后写入 contract-revisions 积累包
 */

import path from "node:path";
import { isValidMatterId } from "../../../src/lawmind/cases/index.js";
import {
  finalizeContractRevisionPack,
} from "../../../src/lawmind/learning/contract-revision-pack.js";
import {
  listOpenContractReviewDrafts,
  markContractReviewDraftAccepted,
  readContractReviewDraft,
  saveContractReviewDraft,
} from "../../../src/lawmind/learning/contract-review-draft.js";
import type { LawmindRouteContext } from "./lawmind-server-route-types.js";
import { readJsonBody, sendJson } from "./lawmind-server-helpers.js";

export async function handleContractReviewRoutes({
  ctx,
  pathname,
  req,
  res,
  c,
}: LawmindRouteContext): Promise<boolean> {
  const { workspaceDir } = ctx;

  if (pathname === "/api/learning/contract-review/drafts" && req.method === "GET") {
    const items = await listOpenContractReviewDrafts(workspaceDir, 40);
    sendJson(res, 200, { ok: true, items }, c);
    return true;
  }

  if (pathname === "/api/learning/contract-review/drafts" && req.method === "POST") {
    const body = (await readJsonBody(req)) as {
      draftId?: string;
      initialPath?: string;
      revisedPath?: string;
      lawyerAnnotations?: string;
      keyModificationsDraft?: unknown;
      matterId?: string;
      assistantId?: string;
      status?: string;
    };
    const initialPath = typeof body.initialPath === "string" ? body.initialPath.trim() : "";
    const revisedPath = typeof body.revisedPath === "string" ? body.revisedPath.trim() : "";
    if (!initialPath || !revisedPath) {
      sendJson(res, 400, { ok: false, code: "paths_required", message: "请提供 initialPath 与 revisedPath。" }, c);
      return true;
    }
    const matterRaw = typeof body.matterId === "string" ? body.matterId.trim() : "";
    if (matterRaw && !isValidMatterId(matterRaw)) {
      sendJson(res, 400, { ok: false, code: "invalid_matter_id" }, c);
      return true;
    }
    const keys = Array.isArray(body.keyModificationsDraft)
      ? body.keyModificationsDraft.filter((x): x is string => typeof x === "string")
      : [];
    try {
      const doc = await saveContractReviewDraft(workspaceDir, {
        draftId: typeof body.draftId === "string" ? body.draftId : undefined,
        initialPath,
        revisedPath,
        lawyerAnnotations: typeof body.lawyerAnnotations === "string" ? body.lawyerAnnotations : "",
        keyModificationsDraft: keys,
        matterId: matterRaw || undefined,
        assistantId: typeof body.assistantId === "string" ? body.assistantId.trim() || undefined : undefined,
        status: body.status === "withdrawn" ? "withdrawn" : "open",
      });
      sendJson(res, 200, { ok: true, draft: doc }, c);
    } catch (e) {
      sendJson(res, 500, { ok: false, message: e instanceof Error ? e.message : String(e) }, c);
    }
    return true;
  }

  if (pathname === "/api/learning/contract-review/drafts/accept" && req.method === "POST") {
    const body = (await readJsonBody(req)) as {
      draftId?: string;
      stableDocumentKey?: string;
      appendLawyerProfileBullet?: boolean;
      title?: string;
    };
    const draftId = typeof body.draftId === "string" ? body.draftId.trim() : "";
    if (!draftId) {
      sendJson(res, 400, { ok: false, code: "draft_id_required" }, c);
      return true;
    }
    const draft = await readContractReviewDraft(workspaceDir, draftId);
    if (!draft || draft.status !== "open") {
      sendJson(res, 404, { ok: false, code: "draft_not_found" }, c);
      return true;
    }
    const auditDir = path.join(workspaceDir, "audit");
    try {
      const title =
        (typeof body.title === "string" && body.title.trim()) ||
        path.basename(draft.revisedPath) ||
        path.basename(draft.initialPath);
      const result = await finalizeContractRevisionPack({
        workspaceDir,
        initialSourcePath: draft.initialPath,
        finalSourcePath: draft.revisedPath,
        keyModifications: draft.keyModificationsDraft.length ? draft.keyModificationsDraft : ["（由验收草稿转入，未单独列要点）"],
        title,
        requirementsSummary: draft.lawyerAnnotations,
        matterId: draft.matterId,
        assistantId: draft.assistantId,
        appendLawyerProfileBullet: body.appendLawyerProfileBullet === true,
        auditDir: body.appendLawyerProfileBullet === true ? auditDir : undefined,
        stableDocumentKey: typeof body.stableDocumentKey === "string" ? body.stableDocumentKey.trim() : undefined,
      });
      await markContractReviewDraftAccepted(workspaceDir, draftId);
      sendJson(
        res,
        200,
        {
          ok: true,
          revisionId: result.revisionId,
          packRelativeDir: path.join("learning", "contract-revisions", result.revisionId).replace(/\\/g, "/"),
        },
        c,
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const status = msg === "path_outside_workspace" ? 403 : 400;
      sendJson(res, status, { ok: false, code: "accept_failed", message: msg }, c);
    }
    return true;
  }

  return false;
}
