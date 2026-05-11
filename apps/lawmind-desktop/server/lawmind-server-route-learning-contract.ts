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
import type { LawmindRouteContext } from "./lawmind-server-route-types.js";
import { readJsonBody, sendJson } from "./lawmind-server-helpers.js";

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

  const body = (await readJsonBody(req)) as {
    initialPath?: string;
    finalPath?: string;
    keyModifications?: unknown;
    title?: string;
    requirementsSummary?: string;
    matterId?: string;
    assistantId?: string;
    appendLawyerProfileBullet?: boolean;
    stableDocumentKey?: string;
    lawyerReviewNotes?: string;
  };

  const initialPath = typeof body.initialPath === "string" ? body.initialPath.trim() : "";
  const finalPath = typeof body.finalPath === "string" ? body.finalPath.trim() : "";
  if (!initialPath || !finalPath) {
    sendJson(res, 400, { ok: false, code: "paths_required", message: "请提供 initialPath 与 finalPath（相对工作区或工作区下的绝对路径）。" }, c);
    return true;
  }

  const matterRaw = typeof body.matterId === "string" ? body.matterId.trim() : "";
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
      title: typeof body.title === "string" ? body.title : undefined,
      requirementsSummary: typeof body.requirementsSummary === "string" ? body.requirementsSummary : undefined,
      matterId: matterRaw || undefined,
      assistantId: typeof body.assistantId === "string" ? body.assistantId : undefined,
      appendLawyerProfileBullet: body.appendLawyerProfileBullet === true,
      auditDir: body.appendLawyerProfileBullet === true ? auditDir : undefined,
      stableDocumentKey: typeof body.stableDocumentKey === "string" ? body.stableDocumentKey : undefined,
      lawyerReviewNotes: typeof body.lawyerReviewNotes === "string" ? body.lawyerReviewNotes : undefined,
    });
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
