/**
 * 合同修订积累包 API
 *
 * POST /api/learning/contract-revision/finalize — 落盘初始稿、定稿与关键修改点
 * GET  /api/learning/contract-revisions — 列出最近修订包摘要
 */

import path from "node:path";
import { isValidMatterId } from "../../../src/lawmind/cases/index.js";
import {
  finalizeContractRevisionPack,
  listContractRevisionPacks,
} from "../../../src/lawmind/learning/contract-revision-pack.js";
import { suggestLearningFromDraftReview } from "../../../src/lawmind/learning/review-learning-suggest.js";
import { isInvalidRequestBodyError, parseJsonBodyZod } from "./lawmind-api-parse.js";
import { learningContractFinalizePostSchema } from "./lawmind-api-schemas.js";
import type { LawmindRouteContext } from "./lawmind-server-route-types.js";
import { sendJson } from "./lawmind-server-helpers.js";

export async function handleLearningContractRoutes({
  ctx,
  pathname,
  req,
  res,
  url,
  c,
}: LawmindRouteContext): Promise<boolean> {
  const { workspaceDir } = ctx;

  if (pathname === "/api/learning/contract-revisions" && req.method === "GET") {
    const limitRaw = url.searchParams.get("limit")?.trim() ?? "";
    const limit = Math.min(200, Math.max(1, Number.parseInt(limitRaw, 10) || 50));
    const items = await listContractRevisionPacks(workspaceDir, limit);
    sendJson(res, 200, { ok: true, items }, c);
    return true;
  }

  if (pathname !== "/api/learning/contract-revision/finalize" || req.method !== "POST") {
    return false;
  }

  let body;
  try {
    body = await parseJsonBodyZod(req, learningContractFinalizePostSchema);
  } catch (err) {
    if (isInvalidRequestBodyError(err)) {
      const msg = err.issues.join("; ");
      if (msg.includes("initialPath") || msg.includes("finalPath")) {
        sendJson(res, 400, { ok: false, code: "paths_required", message: "请提供 initialPath 与 finalPath（相对工作区或工作区下的绝对路径）。" }, c);
        return true;
      }
      sendJson(res, 400, { ok: false, code: "invalid_request" }, c);
      return true;
    }
    throw err;
  }

  const initialPath = body.initialPath;
  const finalPath = body.finalPath;

  const matterRaw = body.matterId ?? "";
  if (matterRaw && !isValidMatterId(matterRaw)) {
    sendJson(res, 400, { ok: false, code: "invalid_matter_id", message: "案件 ID 格式不正确。" }, c);
    return true;
  }

  let keys: string[] = [];
  if (Array.isArray(body.keyModifications)) {
    keys = body.keyModifications.filter((x): x is string => typeof x === "string");
  } else if (typeof body.keyModifications === "string") {
    keys = [body.keyModifications];
  }

  const auditDir = path.join(workspaceDir, "audit");

  try {
    const result = await finalizeContractRevisionPack({
      workspaceDir,
      initialSourcePath: initialPath,
      finalSourcePath: finalPath,
      keyModifications: keys,
      title: body.title,
      requirementsSummary: body.requirementsSummary,
      matterId: matterRaw || undefined,
      assistantId: body.assistantId,
      appendLawyerProfileBullet: body.appendLawyerProfileBullet === true,
      auditDir: body.appendLawyerProfileBullet === true ? auditDir : undefined,
      stableDocumentKey: body.stableDocumentKey,
      lawyerReviewNotes: body.lawyerReviewNotes,
    });
    const learnNote = [
      ...keys.map((k) => String(k).trim()).filter(Boolean).slice(0, 3),
      typeof body.lawyerReviewNotes === "string" ? body.lawyerReviewNotes.trim() : "",
    ]
      .filter(Boolean)
      .join("。");
    if (learnNote) {
      try {
        await suggestLearningFromDraftReview({
          workspaceDir,
          auditDir,
          taskId: result.revisionId,
          status: "modified",
          note: learnNote,
          assistantId:
            typeof body.assistantId === "string" ? body.assistantId.trim() : undefined,
        });
      } catch {
        /* 学习建议失败不阻断修订包落盘 */
      }
    }
    sendJson(
      res,
      200,
      {
        ok: true,
        revisionId: result.revisionId,
        packRelativeDir: path.join("learning", "contract-revisions", result.revisionId).replace(/\\/g, "/"),
        manifest: result.manifest,
      },
      c,
    );
    return true;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const code =
      msg === "path_outside_workspace"
        ? "path_outside_workspace"
        : msg === "initial_file_not_found"
          ? "initial_not_found"
          : msg === "final_file_not_found"
            ? "final_not_found"
            : msg === "invalid_matter_id"
              ? "invalid_matter_id"
              : "finalize_failed";
    const status = code === "path_outside_workspace" ? 403 : 400;
    sendJson(res, status, { ok: false, code, message: msg }, c);
    return true;
  }
}
