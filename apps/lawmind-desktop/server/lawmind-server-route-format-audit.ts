/**
 * 格式体检（只读）。桌面中栏 / 设置页调用。
 *
 *   POST /api/documents/format-audit
 *     { root: "workspace"|"project", path, projectDir?, mode?, lawmindParagraphs? }
 *     -> { ok, text, report }
 *
 * 只读：不写回文件，也不生成副产物。三种口径的语义见
 * `src/lawmind/drafts/document-format-audit.ts`：
 * imported 跟随原文 / from-scratch 国标草案 / retemplate 律师要求整体套模板。
 */

import fs from "node:fs";
import { z } from "zod";
import {
  auditDocumentFormat,
  renderFormatAuditText,
} from "../../../src/lawmind/drafts/document-format-audit.js";
import { applyFormatFixesToDocxFile } from "../../../src/lawmind/drafts/format-fix.js";
import { checkDocxSize } from "../../../src/lawmind/drafts/docx-size.js";
import { readDocxDocumentLayout } from "../../../src/lawmind/drafts/word-surface.js";
import { resolveWordBaselineAbs } from "../../../src/lawmind/artifacts/word-revision-delivery.js";
import { resolveWorkspaceRelativePath } from "../../../src/lawmind/runtime/workspace-path.js";
import { resolveWordRevisionAuthor } from "../../../src/lawmind/policy/word-revision-author.js";
import { readWorkspacePolicyFile } from "../../../src/lawmind/policy/workspace-policy.js";
import { isInvalidRequestBodyError, parseJsonBodyZod } from "./lawmind-api-parse.js";
import { safeOptionalProjectDir, sendJson } from "./lawmind-server-helpers.js";
import type { LawmindRouteContext } from "./lawmind-server-route-types.js";

const auditSchema = z.object({
  root: z.enum(["workspace", "project"]),
  path: z.string().trim().min(1).max(2_000),
  projectDir: z.string().optional(),
  mode: z.enum(["imported", "from-scratch", "retemplate"]).optional(),
  lawmindParagraphs: z.array(z.number().int().min(0)).max(2_000).optional(),
});

const fixSchema = auditSchema.extend({
  outputPath: z.string().trim().min(1).max(2_000).optional(),
  /** 显式 outputPath 命中已有文件时要律师确认，避免静默覆盖别人已签的稿子。 */
  overwrite: z.boolean().optional(),
});

/** 不覆盖原文件：默认 原名_格式修订.docx。 */
function defaultFixRelPath(relPath: string): string {
  const posix = relPath.replace(/\\/g, "/");
  const dir = posix.includes("/") ? posix.slice(0, posix.lastIndexOf("/") + 1) : "";
  const base = posix.slice(dir.length).replace(/\.docx$/i, "");
  return `${dir}${base}_格式修订.docx`;
}

/**
 * 格式自动修（A 层）：写一份带格式修订的副本。原文件不动。
 *
 *   POST /api/documents/format-fix
 *     { root, path, mode?, lawmindParagraphs?, outputPath? }
 */
export async function handleFormatFixRoutes({
  ctx,
  req,
  res,
  pathname,
  c,
}: LawmindRouteContext): Promise<boolean> {
  if (pathname !== "/api/documents/format-fix") {
    return false;
  }
  if (req.method !== "POST") {
    sendJson(res, 405, { ok: false, error: "method_not_allowed" }, c);
    return true;
  }
  let body: z.infer<typeof fixSchema>;
  try {
    body = await parseJsonBodyZod(req, fixSchema);
  } catch (error) {
    if (isInvalidRequestBodyError(error)) {
      sendJson(res, 400, { ok: false, error: "invalid_request_body", detail: error.message }, c);
      return true;
    }
    throw error;
  }
  if (!/\.docx$/i.test(body.path)) {
    sendJson(
      res,
      400,
      { ok: false, error: "unsupported_file_type", detail: "格式自动修只认 .docx" },
      c,
    );
    return true;
  }

  const projectDir = safeOptionalProjectDir(body.projectDir ?? null);
  const located = resolveWordBaselineAbs({
    workspaceDir: ctx.workspaceDir,
    ...(projectDir ? { projectDir } : {}),
    raw: body.path,
    preferredRoot: body.root,
  });
  if (!located) {
    sendJson(res, 404, { ok: false, error: "not_found", detail: `找不到 ${body.path}` }, c);
    return true;
  }

  const mode = body.mode ?? "imported";
  const outRel = body.outputPath?.trim() || defaultFixRelPath(located.rel);
  // 目标还不存在，不能用 resolveWordBaselineAbs（它要求文件已存在），
  // 但仍必须走同一套围栏：绝对路径、`..`、写回原件都要挡住。
  const resolvedOut = resolveWorkspaceRelativePath(
    located.root === "project" && projectDir ? projectDir : ctx.workspaceDir,
    outRel,
  );
  if (!resolvedOut.ok) {
    sendJson(
      res,
      400,
      {
        ok: false,
        error: "invalid_output_path",
        detail: "副本必须写在工作区里，且不能含 ..",
      },
      c,
    );
    return true;
  }
  const outAbs = resolvedOut.abs;
  if (outAbs === located.abs) {
    sendJson(
      res,
      400,
      { ok: false, error: "in_place_refused", detail: "副本不能覆盖原文件" },
      c,
    );
    return true;
  }
  if (!/\.docx$/i.test(resolvedOut.rel)) {
    sendJson(
      res,
      400,
      { ok: false, error: "invalid_output_path", detail: "副本路径必须以 .docx 结尾" },
      c,
    );
    return true;
  }
  // 默认副本名（原名_格式修订.docx）覆盖自己的上次产物是预期行为；但律师可能已经在
  // 那份副本上手改过并被覆盖——必须在返回里说清，而不是静默替换。
  const replacingDefaultCopy = !body.outputPath && fs.existsSync(outAbs);
  // 律师显式指定了别的 outputPath 时，命中已有文件必须先确认，别把已签的稿子盖掉。
  if (body.outputPath && fs.existsSync(outAbs) && body.overwrite !== true) {
    sendJson(
      res,
      409,
      {
        ok: false,
        error: "output_exists",
        detail: `${outRel} 已存在。要覆盖它请带 overwrite: true，或换一个副本名。`,
      },
      c,
    );
    return true;
  }

  const author =
    resolveWordRevisionAuthor(readWorkspacePolicyFile(ctx.workspaceDir)?.wordRevisionAuthor) ||
    "LawMind";

  // 与体检同一道上限；写副本要读整包，超限直接拒，不留半截产物。
  const inputSize = await checkDocxSize(located.abs);
  if (!inputSize.ok) {
    sendJson(res, 413, { ok: false, error: "file_too_large", detail: inputSize.reason }, c);
    return true;
  }

  const result = await applyFormatFixesToDocxFile({
    inputAbs: located.abs,
    outputAbs: outAbs,
    mode,
    author,
    ...(body.lawmindParagraphs?.length ? { lawmindParagraphs: body.lawmindParagraphs } : {}),
  });
  if (!result.ok) {
    sendJson(res, 422, { ok: false, error: result.code, detail: result.error, plan: result.plan }, c);
    return true;
  }
  if ((result.appliedParagraphs ?? 0) === 0) {
    // 没有副本可交，不能返回一个看起来成功的 outputPath。
    sendJson(
      res,
      422,
      {
        ok: false,
        error: "nothing_applied",
        detail:
          result.warning ?? "体检指出了问题，但每一段都没能安全定位，没有写副本。",
        plan: result.plan,
      },
      c,
    );
    return true;
  }
  const warnings = [
    replacingDefaultCopy
      ? "已覆盖上一次生成的同名格式修订副本（原文件未动）。若您在旧副本上手动改过，请改用其他副本名重做。"
      : "",
    result.warning ?? "",
  ].filter(Boolean);
  sendJson(
    res,
    200,
    {
      ok: true,
      sourcePath: located.rel,
      outputPath: outRel,
      appliedParagraphs: result.appliedParagraphs ?? 0,
      appliedRuns: result.appliedRuns ?? 0,
      plan: result.plan,
      revisions: result.revisions,
      ...(replacingDefaultCopy ? { replacedExisting: true } : {}),
      ...(warnings.length ? { warning: warnings.join("；") } : {}),
    },
    c,
  );
  return true;
}

export async function handleFormatAuditRoutes({
  ctx,
  req,
  res,
  pathname,
  c,
}: LawmindRouteContext): Promise<boolean> {
  if (pathname !== "/api/documents/format-audit") {
    return false;
  }
  if (req.method !== "POST") {
    sendJson(res, 405, { ok: false, error: "method_not_allowed" }, c);
    return true;
  }

  let body: z.infer<typeof auditSchema>;
  try {
    body = await parseJsonBodyZod(req, auditSchema);
  } catch (error) {
    if (isInvalidRequestBodyError(error)) {
      sendJson(res, 400, { ok: false, error: "invalid_request_body", detail: error.message }, c);
      return true;
    }
    throw error;
  }

  if (!/\.docx$/i.test(body.path)) {
    sendJson(
      res,
      400,
      { ok: false, error: "unsupported_file_type", detail: "格式体检只认 .docx" },
      c,
    );
    return true;
  }

  const projectDir = safeOptionalProjectDir(body.projectDir ?? null);
  const located = resolveWordBaselineAbs({
    workspaceDir: ctx.workspaceDir,
    ...(projectDir ? { projectDir } : {}),
    raw: body.path,
    preferredRoot: body.root,
  });
  if (!located) {
    sendJson(res, 404, { ok: false, error: "not_found", detail: `找不到 ${body.path}` }, c);
    return true;
  }

  // 体积上限先于解析：超大/构造过的 zip 不该让本地服务卡住。
  const size = await checkDocxSize(located.abs);
  if (!size.ok) {
    sendJson(res, 413, { ok: false, error: "file_too_large", detail: size.reason }, c);
    return true;
  }
  try {
    const layout = await readDocxDocumentLayout(located.abs);
    const report = auditDocumentFormat({
      page: layout.page,
      blocks: layout.blocks,
      mode: body.mode ?? "imported",
      ...(layout.hasTextBoxes ? { hasTextBoxes: true } : {}),
      ...(body.lawmindParagraphs?.length ? { lawmindParagraphs: body.lawmindParagraphs } : {}),
    });
    sendJson(
      res,
      200,
      {
        ok: true,
        path: located.rel,
        root: located.root,
        text: renderFormatAuditText(report),
        report,
      },
      c,
    );
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    if (/End of central directory|zip|不是有效的 \.docx/i.test(reason)) {
      sendJson(
        res,
        422,
        {
          ok: false,
          error: "not_a_docx",
          detail: "不是有效的 .docx（可能是旧版 .doc 改了后缀，或文件损坏）",
        },
        c,
      );
      return true;
    }
    sendJson(res, 500, { ok: false, error: "format_audit_failed", detail: reason }, c);
  }
  return true;
}
