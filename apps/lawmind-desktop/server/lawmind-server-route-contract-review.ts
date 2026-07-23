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
import { suggestLearningFromDraftReview } from "../../../src/lawmind/learning/review-learning-suggest.js";
import { isInvalidRequestBodyError, parseJsonBodyZod } from "./lawmind-api-parse.js";
import {
  contractReviewAcceptPostSchema,
  contractReviewDraftPostSchema,
} from "./lawmind-api-schemas.js";
import type { LawmindRouteContext } from "./lawmind-server-route-types.js";
import { sendJson } from "./lawmind-server-helpers.js";

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
    let body;
    try {
      body = await parseJsonBodyZod(req, contractReviewDraftPostSchema);
    } catch (err) {
      if (isInvalidRequestBodyError(err)) {
        const msg = err.issues.join("; ");
        if (msg.includes("initialPath") || msg.includes("revisedPath")) {
          sendJson(res, 400, { ok: false, code: "paths_required", message: "请提供 initialPath 与 revisedPath。" }, c);
          return true;
        }
        sendJson(res, 400, { ok: false, code: "invalid_request" }, c);
        return true;
      }
      throw err;
    }
    const initialPath = body.initialPath;
    const revisedPath = body.revisedPath;
    const matterRaw = body.matterId ?? "";
    if (matterRaw && !isValidMatterId(matterRaw)) {
      sendJson(res, 400, { ok: false, code: "invalid_matter_id" }, c);
      return true;
    }
    const keys = body.keyModificationsDraft ?? [];
    try {
      const doc = await saveContractReviewDraft(workspaceDir, {
        draftId: body.draftId,
        initialPath,
        revisedPath,
        lawyerAnnotations: body.lawyerAnnotations ?? "",
        keyModificationsDraft: keys,
        matterId: matterRaw || undefined,
        assistantId: body.assistantId || undefined,
        status: body.status === "withdrawn" ? "withdrawn" : "open",
      });
      sendJson(res, 200, { ok: true, draft: doc }, c);
    } catch (e) {
      sendJson(res, 500, { ok: false, message: e instanceof Error ? e.message : String(e) }, c);
    }
    return true;
  }

  if (pathname === "/api/learning/contract-review/drafts/accept" && req.method === "POST") {
    let body;
    try {
      body = await parseJsonBodyZod(req, contractReviewAcceptPostSchema);
    } catch (err) {
      if (isInvalidRequestBodyError(err)) {
        sendJson(res, 400, { ok: false, code: "draft_id_required" }, c);
        return true;
      }
      throw err;
    }
    const draftId = body.draftId;
    const draft = await readContractReviewDraft(workspaceDir, draftId);
    if (!draft || draft.status !== "open") {
      sendJson(res, 404, { ok: false, code: "draft_not_found" }, c);
      return true;
    }
    const auditDir = path.join(workspaceDir, "audit");
    try {
      const title =
        (body.title?.trim()) ||
        path.basename(draft.revisedPath) ||
        path.basename(draft.initialPath);
      const keyMods = draft.keyModificationsDraft.length
        ? draft.keyModificationsDraft
        : ["（由验收草稿转入，未单独列要点）"];
      const result = await finalizeContractRevisionPack({
        workspaceDir,
        initialSourcePath: draft.initialPath,
        finalSourcePath: draft.revisedPath,
        keyModifications: keyMods,
        title,
        requirementsSummary: draft.lawyerAnnotations,
        matterId: draft.matterId,
        assistantId: draft.assistantId,
        appendLawyerProfileBullet: body.appendLawyerProfileBullet === true,
        auditDir: body.appendLawyerProfileBullet === true ? auditDir : undefined,
        stableDocumentKey: body.stableDocumentKey,
      });
      const learnNote = [
        ...keyMods.map((k) => String(k).trim()).filter(Boolean).slice(0, 3),
        typeof draft.lawyerAnnotations === "string" ? draft.lawyerAnnotations.trim() : "",
      ]
        .filter(Boolean)
        .join("。");
      if (learnNote && body.appendLawyerProfileBullet !== true) {
        try {
          await suggestLearningFromDraftReview({
            workspaceDir,
            auditDir,
            taskId: result.revisionId,
            status: "modified",
            note: learnNote.slice(0, 600),
            assistantId: draft.assistantId,
          });
        } catch {
          /* 学习建议失败不阻断验收 */
        }
      }
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
