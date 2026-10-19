import fs from "node:fs";
import path from "node:path";
import {
  ensureLocalFile,
  ensureLocalFileSync,
} from "../../../src/lawmind/runtime/icloud-materialize.js";
import {
  PROTECTED_WORKSPACE_WRITE_CODE,
  PROTECTED_WORKSPACE_WRITE_REFUSAL,
  isProtectedWorkspaceRel,
} from "../../../src/lawmind/runtime/protected-workspace-rels.js";
import { parseJsonBodyZod } from "./lawmind-api-parse.js";
import {
  fsPptxSavePostSchema,
  fsWritePostSchema,
  fsXlsxSavePostSchema,
} from "./lawmind-api-schemas.js";
import type { LawmindRouteContext } from "./lawmind-server-route-types.js";
import {
  MAX_TEXT_READ_BYTES,
  FsWriteNotAllowedError,
  isLikelyBinary,
  normalizeRelPath,
  resolveFsPath,
  resolveFsRoots,
  safeArtifactPath,
  sendJson,
} from "./lawmind-server-helpers.js";

/** 中栏 `.doc` 文本预览上限；超过就截断并回报 `truncated`。 */
const DOC_PREVIEW_MAX_CHARS = 200_000;

export async function handleFilesystemRoute({
  ctx,
  pathname,
  req,
  res,
  url,
  c,
}: LawmindRouteContext): Promise<boolean> {
  const { workspaceDir } = ctx;

  if (pathname === "/api/artifact" && req.method === "GET") {
    const rel = url.searchParams.get("path") ?? "";
    const full = safeArtifactPath(workspaceDir, rel);
    if (!full || !fs.existsSync(full)) {
      sendJson(res, 404, { ok: false, error: "not found" }, c);
      return true;
    }
    ensureLocalFileSync(full);
    const buf = await fs.promises.readFile(full);
    res.writeHead(200, {
      "content-type": "application/octet-stream",
      "content-disposition": `inline; filename="${path.basename(full)}"`,
      ...c,
    });
    res.end(buf);
    return true;
  }

  if (pathname === "/api/fs/tree" && req.method === "GET") {
    const roots = resolveFsRoots(workspaceDir);
    const root = url.searchParams.get("root") ?? "workspace";
    const relPath = url.searchParams.get("path") ?? "";
    const { full, rel } = resolveFsPath(roots, root, relPath, { access: "read" });
    const stat = fs.statSync(full);
    if (!stat.isDirectory()) {
      sendJson(res, 400, { ok: false, error: "path is not directory" }, c);
      return true;
    }
    const entries = fs
      .readdirSync(full, { withFileTypes: true })
      .map((entry) => {
        const childRel = normalizeRelPath(path.join(rel, entry.name));
        const childAbs = path.join(full, entry.name);
        const childStat = fs.statSync(childAbs);
        return {
          name: entry.name,
          path: childRel,
          kind: entry.isDirectory() ? "directory" : "file",
          size: entry.isDirectory() ? undefined : childStat.size,
          mtimeMs: childStat.mtimeMs,
        };
      })
      .toSorted((a, b) => {
        if (a.kind !== b.kind) {
          return a.kind === "directory" ? -1 : 1;
        }
        return a.name.localeCompare(b.name);
      });
    sendJson(res, 200, { ok: true, entries }, c);
    return true;
  }

  if (pathname === "/api/fs/raw" && req.method === "GET") {
    const roots = resolveFsRoots(workspaceDir);
    const root = url.searchParams.get("root") ?? "workspace";
    const relPath = url.searchParams.get("path") ?? "";
    let full: string;
    try {
      ({ full } = resolveFsPath(roots, root, relPath, { access: "read" }));
    } catch {
      sendJson(res, 400, { ok: false, error: "invalid_path" }, c);
      return true;
    }
    let stat: fs.Stats;
    try {
      stat = fs.statSync(full);
    } catch {
      sendJson(res, 404, { ok: false, error: "not found" }, c);
      return true;
    }
    if (!stat.isFile()) {
      sendJson(res, 400, { ok: false, error: "path is not file" }, c);
      return true;
    }
    const mime = mimeForRawPath(full);
    if (!mime) {
      sendJson(res, 415, { ok: false, error: "mime_not_allowed" }, c);
      return true;
    }
    ensureLocalFileSync(full);
    const size = stat.size;
    const rangeHeader = req.headers.range;
    if (rangeHeader) {
      const match = /^bytes=(\d*)-(\d*)$/i.exec(rangeHeader.trim());
      if (!match) {
        sendJson(res, 416, { ok: false, error: "invalid_range" }, c);
        return true;
      }
      const start = match[1] ? Number(match[1]) : 0;
      const end = match[2] ? Number(match[2]) : size - 1;
      if (
        !Number.isFinite(start) ||
        !Number.isFinite(end) ||
        start < 0 ||
        end < start ||
        start >= size
      ) {
        res.writeHead(416, {
          "content-range": `bytes */${size}`,
          ...c,
        });
        res.end();
        return true;
      }
      const safeEnd = Math.min(end, size - 1);
      const chunkSize = safeEnd - start + 1;
      res.writeHead(206, {
        "content-type": mime,
        "content-length": String(chunkSize),
        "content-range": `bytes ${start}-${safeEnd}/${size}`,
        "accept-ranges": "bytes",
        "cache-control": "private, max-age=0",
        ...c,
      });
      fs.createReadStream(full, { start, end: safeEnd }).pipe(res);
      return true;
    }
    res.writeHead(200, {
      "content-type": mime,
      "content-length": String(size),
      "accept-ranges": "bytes",
      "cache-control": "private, max-age=0",
      ...c,
    });
    fs.createReadStream(full).pipe(res);
    return true;
  }

  if (pathname === "/api/fs/pdf-preview" && req.method === "GET") {
    const roots = resolveFsRoots(workspaceDir);
    const root = url.searchParams.get("root") ?? "workspace";
    const relPath = url.searchParams.get("path") ?? "";
    if (!/\.pdf$/i.test(relPath)) {
      sendJson(res, 415, { ok: false, error: "not_pdf" }, c);
      return true;
    }
    let full: string;
    try {
      ({ full } = resolveFsPath(roots, root, relPath, { access: "read" }));
    } catch {
      sendJson(res, 400, { ok: false, error: "invalid_path" }, c);
      return true;
    }
    if (!fs.existsSync(full) || !fs.statSync(full).isFile()) {
      sendJson(res, 404, { ok: false, error: "not found" }, c);
      return true;
    }
    ensureLocalFileSync(full);
    const pageRaw = url.searchParams.get("page");
    try {
      const { countPdfPages, renderPdfPagePng } = await import(
        "../../../src/lawmind/acceptance-sheet/pdf-page.js"
      );
      if (!pageRaw) {
        const pages = await countPdfPages(full);
        sendJson(res, 200, { ok: true, pages }, c);
        return true;
      }
      const page = Number(pageRaw);
      if (!Number.isInteger(page) || page < 1 || page > 200) {
        sendJson(res, 400, { ok: false, error: "invalid_page" }, c);
        return true;
      }
      const png = await renderPdfPagePng(full, page);
      res.writeHead(200, {
        "content-type": "image/png",
        "cache-control": "private, max-age=0",
        ...c,
      });
      res.end(png);
    } catch (err) {
      const message = err instanceof Error ? err.message : "pdf_preview_failed";
      sendJson(res, 400, { ok: false, error: message, message }, c);
    }
    return true;
  }

  if (pathname === "/api/fs/zip-listing" && req.method === "GET") {
    const roots = resolveFsRoots(workspaceDir);
    const root = url.searchParams.get("root") ?? "workspace";
    const relPath = url.searchParams.get("path") ?? "";
    if (!/\.zip$/i.test(relPath)) {
      sendJson(res, 415, { ok: false, error: "not_zip" }, c);
      return true;
    }
    let full: string;
    try {
      ({ full } = resolveFsPath(roots, root, relPath, { access: "read" }));
    } catch {
      sendJson(res, 400, { ok: false, error: "invalid_path" }, c);
      return true;
    }
    try {
      ensureLocalFileSync(full);
      const JSZip = (await import("jszip")).default;
      const buf = await fs.promises.readFile(full);
      const zip = await JSZip.loadAsync(buf);
      const entries: Array<{ path: string; size: number; directory: boolean }> = [];
      const MAX_ENTRIES = 2_000;
      let truncated = false;
      for (const [name, entry] of Object.entries(zip.files)) {
        if (entries.length >= MAX_ENTRIES) {
          truncated = true;
          break;
        }
        const rawSize = (entry as { ["_data"]?: { uncompressedSize?: number } })["_data"]
          ?.uncompressedSize;
        entries.push({
          path: name,
          size: entry.dir ? 0 : typeof rawSize === "number" ? rawSize : 0,
          directory: entry.dir,
        });
      }
      entries.sort((a, b) => a.path.localeCompare(b.path));
      sendJson(res, 200, { ok: true, entries, truncated }, c);
    } catch (err) {
      const message = err instanceof Error ? err.message : "zip_listing_failed";
      sendJson(res, 400, { ok: false, error: message }, c);
    }
    return true;
  }

  if (pathname === "/api/fs/convert-doc" && req.method === "POST") {
    const body = (await parseJsonBodyZod(req, fsWritePostSchema)) as {
      root?: string;
      path?: string;
    };
    const roots = resolveFsRoots(workspaceDir);
    const root = body.root ?? "workspace";
    const relPath = body.path ?? "";
    if (!/\.doc$/i.test(relPath) || /\.docx$/i.test(relPath)) {
      sendJson(res, 415, { ok: false, error: "not_legacy_doc" }, c);
      return true;
    }
    let full: string;
    let rel: string;
    try {
      ({ full, rel } = resolveFsPath(roots, root, relPath, { access: "read" }));
    } catch {
      sendJson(res, 400, { ok: false, error: "invalid_path" }, c);
      return true;
    }
    // Conversion writes a sibling under the same root — require write access.
    try {
      resolveFsPath(roots, root, path.dirname(rel) || ".", { access: "write" });
    } catch {
      sendJson(res, 403, { ok: false, error: "write_forbidden" }, c);
      return true;
    }
    try {
      const { convertLegacyDocForPreview } = await import(
        "../../../src/lawmind/mail/convert-to-docx.js"
      );
      // convertLegacyDocForPreview resolves under workspaceDir; for project root
      // pass the absolute parent via a workspace-relative path only when root is workspace.
      if (root !== "workspace") {
        sendJson(
          res,
          400,
          { ok: false, error: "convert_doc_workspace_only" },
          c,
        );
        return true;
      }
      const result = await convertLegacyDocForPreview(workspaceDir, rel);
      if (!result.ok) {
        sendJson(res, 400, { ok: false, error: result.error }, c);
        return true;
      }
      // 中栏直接显示正文：不再让律师「确认转换」，也不再打开同一份 `.doc`（那会自己套娃）。
      const { readBinaryWordDocText } = await import(
        "../../../src/lawmind/mail/read-word-binary.js"
      );
      const text = await readBinaryWordDocText(full).catch(() => "");
      sendJson(
        res,
        200,
        {
          ok: true,
          relativePath: result.relativePath,
          converted: result.converted,
          ...(result.tool ? { tool: result.tool } : {}),
          text: text.slice(0, DOC_PREVIEW_MAX_CHARS),
          truncated: text.length > DOC_PREVIEW_MAX_CHARS,
        },
        c,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : "convert_doc_failed";
      sendJson(res, 400, { ok: false, error: message }, c);
    }
    return true;
  }

  if (pathname === "/api/fs/xlsx-preview" && req.method === "GET") {
    const roots = resolveFsRoots(workspaceDir);
    const root = url.searchParams.get("root") ?? "workspace";
    const relPath = url.searchParams.get("path") ?? "";
    if (!/\.xlsx$/i.test(relPath)) {
      sendJson(res, 415, { ok: false, error: "not_xlsx" }, c);
      return true;
    }
    let full: string;
    try {
      ({ full } = resolveFsPath(roots, root, relPath, { access: "read" }));
    } catch {
      sendJson(res, 400, { ok: false, error: "invalid_path" }, c);
      return true;
    }
    try {
      const { loadXlsxUiPreview } = await import(
        "../../../src/lawmind/agent/tools/legal/xlsx-preview.js"
      );
      const loaded = await loadXlsxUiPreview(full);
      // Stat after load: ensureLocalFile / materialize may refresh mtime vs tab listing.
      const mtimeMs = fs.statSync(full).mtimeMs;
      sendJson(
        res,
        200,
        {
          ok: true,
          sheets: loaded.sheets,
          truncatedSheets: loaded.truncatedSheets,
          mtimeMs,
        },
        c,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : "xlsx_preview_failed";
      sendJson(res, 400, { ok: false, error: message }, c);
    }
    return true;
  }

  if (pathname === "/api/fs/pptx-preview" && req.method === "GET") {
    const roots = resolveFsRoots(workspaceDir);
    const root = url.searchParams.get("root") ?? "workspace";
    const relPath = url.searchParams.get("path") ?? "";
    if (!/\.pptx$/i.test(relPath)) {
      sendJson(res, 415, { ok: false, error: "not_pptx" }, c);
      return true;
    }
    let full: string;
    try {
      ({ full } = resolveFsPath(roots, root, relPath, { access: "read" }));
    } catch {
      sendJson(res, 400, { ok: false, error: "invalid_path" }, c);
      return true;
    }
    try {
      const mtimeMs = fs.statSync(full).mtimeMs;
      try {
        const { loadPptxVisualPreview } = await import(
          "../../../src/lawmind/agent/tools/legal/pptx-officecli.js"
        );
        const visual = await loadPptxVisualPreview({ absPath: full });
        sendJson(
          res,
          200,
          {
            ok: true,
            mode: "visual",
            slideCount: visual.slideCount,
            truncatedSlides: visual.truncatedSlides,
            slides: visual.slides,
            cacheKey: visual.cacheKey,
            mtimeMs,
          },
          c,
        );
        return true;
      } catch {
        /* fall through to text extract */
      }
      const { loadPptxUiPreview } = await import(
        "../../../src/lawmind/agent/tools/legal/pptx-preview.js"
      );
      const loaded = await loadPptxUiPreview(full);
      sendJson(
        res,
        200,
        {
          ok: true,
          mode: "text",
          slideCount: loaded.slides.length,
          slides: loaded.slides,
          truncatedSlides: loaded.truncatedSlides,
          slideWidthEmu: loaded.slideWidthEmu,
          slideHeightEmu: loaded.slideHeightEmu,
          mtimeMs: fs.statSync(full).mtimeMs,
        },
        c,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : "pptx_preview_failed";
      sendJson(res, 400, { ok: false, error: message }, c);
    }
    return true;
  }

  if (pathname === "/api/fs/pptx-slide" && req.method === "GET") {
    const roots = resolveFsRoots(workspaceDir);
    const root = url.searchParams.get("root") ?? "workspace";
    const relPath = url.searchParams.get("path") ?? "";
    const page = Number(url.searchParams.get("page") ?? "1");
    if (!/\.pptx$/i.test(relPath)) {
      sendJson(res, 415, { ok: false, error: "not_pptx" }, c);
      return true;
    }
    if (!Number.isFinite(page) || page < 1 || page > 80) {
      sendJson(res, 400, { ok: false, error: "invalid_page" }, c);
      return true;
    }
    let full: string;
    try {
      ({ full } = resolveFsPath(roots, root, relPath, { access: "read" }));
    } catch {
      sendJson(res, 400, { ok: false, error: "invalid_path" }, c);
      return true;
    }
    try {
      const {
        pptxPreviewCacheKey,
        pptxSlideCachePath,
        renderPptxSlideScreenshot,
      } = await import("../../../src/lawmind/agent/tools/legal/pptx-officecli.js");
      const mtimeMs = fs.statSync(full).mtimeMs;
      const cacheKey = pptxPreviewCacheKey(full, mtimeMs);
      const outPng = pptxSlideCachePath(workspaceDir, cacheKey, page);
      if (!fs.existsSync(outPng)) {
        await renderPptxSlideScreenshot({ absPath: full, page1Based: page, outPng });
      }
      const buf = fs.readFileSync(outPng);
      res.writeHead(200, {
        ...c,
        "Content-Type": "image/png",
        "Content-Length": String(buf.length),
        "Cache-Control": "private, max-age=30",
      });
      res.end(buf);
    } catch (err) {
      const message = err instanceof Error ? err.message : "pptx_slide_failed";
      sendJson(res, 400, { ok: false, error: message }, c);
    }
    return true;
  }

  if (pathname === "/api/fs/pptx-save" && req.method === "POST") {
    const body = await parseJsonBodyZod(req, fsPptxSavePostSchema);
    const roots = resolveFsRoots(workspaceDir);
    const root = body.root;
    const relPath = body.path;
    if (!/\.pptx$/i.test(relPath)) {
      sendJson(res, 415, { ok: false, error: "not_pptx" }, c);
      return true;
    }
    let resolved: { full: string; rel: string };
    try {
      resolved = resolveFsPath(roots, root, relPath, { access: "write" });
    } catch (err) {
      if (err instanceof FsWriteNotAllowedError) {
        sendJson(res, 403, { ok: false, code: err.code, error: err.message }, c);
        return true;
      }
      sendJson(res, 400, { ok: false, error: "invalid_path" }, c);
      return true;
    }
    const { full, rel } = resolved;
    if (root === "workspace" && isProtectedWorkspaceRel(rel)) {
      sendJson(
        res,
        403,
        {
          ok: false,
          code: PROTECTED_WORKSPACE_WRITE_CODE,
          error: PROTECTED_WORKSPACE_WRITE_REFUSAL,
        },
        c,
      );
      return true;
    }
    if (!fs.existsSync(full) || !fs.statSync(full).isFile()) {
      sendJson(res, 404, { ok: false, error: "not_found" }, c);
      return true;
    }
    try {
      await ensureLocalFile(full);
      const prior = fs.statSync(full);
      if (
        body.expectedMtimeMs !== undefined &&
        Math.abs(prior.mtimeMs - body.expectedMtimeMs) > 1
      ) {
        sendJson(
          res,
          409,
          { ok: false, error: "conflict", mtimeMs: prior.mtimeMs },
          c,
        );
        return true;
      }
      const { applyPptxTextEdits } = await import(
        "../../../src/lawmind/agent/tools/legal/pptx-officecli.js"
      );
      const result = await applyPptxTextEdits({ absPath: full, edits: body.edits });
      const mtimeMs = fs.statSync(full).mtimeMs;
      sendJson(res, 200, { ok: true, applied: result.applied, mtimeMs }, c);
    } catch (err) {
      const message = err instanceof Error ? err.message : "pptx_save_failed";
      sendJson(res, 400, { ok: false, error: message }, c);
    }
    return true;
  }

  if (pathname === "/api/fs/read" && req.method === "GET") {
    const roots = resolveFsRoots(workspaceDir);
    const root = url.searchParams.get("root") ?? "workspace";
    const relPath = url.searchParams.get("path") ?? "";
    const { full } = resolveFsPath(roots, root, relPath, { access: "read" });
    const stat = fs.statSync(full);
    if (!stat.isFile()) {
      sendJson(res, 400, { ok: false, error: "path is not file" }, c);
      return true;
    }
    if (stat.size > MAX_TEXT_READ_BYTES) {
      sendJson(res, 413, { ok: false, error: "file too large" }, c);
      return true;
    }
    ensureLocalFileSync(full);
    const buf = fs.readFileSync(full);
    if (isLikelyBinary(buf)) {
      sendJson(res, 415, { ok: false, error: "binary file is not supported" }, c);
      return true;
    }
    sendJson(
      res,
      200,
      {
        ok: true,
        content: buf.toString("utf8"),
        size: stat.size,
        mtimeMs: stat.mtimeMs,
      },
      c,
    );
    return true;
  }

  if (pathname === "/api/fs/xlsx-save" && req.method === "POST") {
    const body = await parseJsonBodyZod(req, fsXlsxSavePostSchema);
    const roots = resolveFsRoots(workspaceDir);
    const root = body.root;
    const relPath = body.path;
    if (!/\.xlsx$/i.test(relPath)) {
      sendJson(res, 415, { ok: false, error: "not_xlsx" }, c);
      return true;
    }
    let resolved: { full: string; rel: string };
    try {
      resolved = resolveFsPath(roots, root, relPath, { access: "write" });
    } catch (err) {
      if (err instanceof FsWriteNotAllowedError) {
        sendJson(res, 403, { ok: false, code: err.code, error: err.message }, c);
        return true;
      }
      sendJson(res, 400, { ok: false, error: "invalid_path" }, c);
      return true;
    }
    const { full, rel } = resolved;
    if (root === "workspace" && isProtectedWorkspaceRel(rel)) {
      sendJson(
        res,
        403,
        {
          ok: false,
          code: PROTECTED_WORKSPACE_WRITE_CODE,
          error: PROTECTED_WORKSPACE_WRITE_REFUSAL,
        },
        c,
      );
      return true;
    }
    if (!fs.existsSync(full) || !fs.statSync(full).isFile()) {
      sendJson(res, 404, { ok: false, error: "not_found" }, c);
      return true;
    }
    try {
      // Materialize before mtime check so iCloud download cannot invalidate the token.
      await ensureLocalFile(full);
      const prior = fs.statSync(full);
      if (
        body.expectedMtimeMs !== undefined &&
        Math.abs(prior.mtimeMs - body.expectedMtimeMs) > 1
      ) {
        sendJson(
          res,
          409,
          {
            ok: false,
            conflict: true,
            error: "file was modified externally",
            mtimeMs: prior.mtimeMs,
          },
          c,
        );
        return true;
      }
      const { applyXlsxCellEdits } = await import(
        "../../../src/lawmind/agent/tools/legal/xlsx-preview.js"
      );
      const result = await applyXlsxCellEdits(full, body.edits, { skipEnsureLocal: true });
      const next = fs.statSync(full);
      ctx.sseBus?.emit({
        type: "fs:change",
        data: { root, rel, mtimeMs: next.mtimeMs, size: next.size },
      });
      sendJson(
        res,
        200,
        {
          ok: true,
          applied: result.applied,
          mtimeMs: next.mtimeMs,
          size: next.size,
          previousMtimeMs: prior.mtimeMs,
        },
        c,
      );
    } catch (err) {
      const code = err && typeof err === "object" ? (err as NodeJS.ErrnoException).code : undefined;
      const raw = err instanceof Error ? err.message : "xlsx_save_failed";
      const message =
        code === "EACCES" || code === "EPERM" || /permission denied|EACCES|EPERM/i.test(raw)
          ? "没有写入权限：文件可能是只读的，或正被 Excel/WPS 打开。请先关闭本机应用，或在访达中去掉「锁定」后再保存。"
          : raw;
      sendJson(res, 400, { ok: false, error: message }, c);
    }
    return true;
  }

  if (pathname === "/api/fs/write" && req.method === "POST") {
    const body = await parseJsonBodyZod(req, fsWritePostSchema);
    const roots = resolveFsRoots(workspaceDir);
    const root = body.root ?? "workspace";
    const relPath = body.path ?? "";
    const content = body.content ?? "";
    const expectedMtimeMs = body.expectedMtimeMs;
    // 写门禁在 resolveFsPath 的 write 分支里（可写根白名单，挂载点只读），
    // 与本机能力网关的 write_forbidden 同口径。
    let resolved: { full: string; rel: string };
    try {
      resolved = resolveFsPath(roots, root, relPath, { access: "write" });
    } catch (err) {
      if (err instanceof FsWriteNotAllowedError) {
        sendJson(res, 403, { ok: false, code: err.code, error: err.message }, c);
        return true;
      }
      throw err;
    }
    const { full, rel } = resolved;
    if (root === "workspace" && isProtectedWorkspaceRel(rel)) {
      sendJson(
        res,
        403,
        {
          ok: false,
          code: PROTECTED_WORKSPACE_WRITE_CODE,
          error: PROTECTED_WORKSPACE_WRITE_REFUSAL,
        },
        c,
      );
      return true;
    }

    let priorMtime: number | undefined;
    if (fs.existsSync(full)) {
      const stat = fs.statSync(full);
      if (!stat.isFile()) {
        sendJson(res, 400, { ok: false, error: "path is not file" }, c);
        return true;
      }
      priorMtime = stat.mtimeMs;
      if (expectedMtimeMs !== undefined && Math.abs(stat.mtimeMs - expectedMtimeMs) > 1) {
        sendJson(
          res,
          409,
          { ok: false, conflict: true, error: "file was modified externally", mtimeMs: stat.mtimeMs },
          c,
        );
        return true;
      }
    } else {
      fs.mkdirSync(path.dirname(full), { recursive: true });
    }

    fs.writeFileSync(full, content, "utf8");
    const next = fs.statSync(full);
    ctx.sseBus?.emit({
      type: "fs:change",
      data: { root, rel, mtimeMs: next.mtimeMs, size: next.size },
    });
    sendJson(
      res,
      200,
      { ok: true, mtimeMs: next.mtimeMs, size: next.size, previousMtimeMs: priorMtime },
      c,
    );
    return true;
  }

  return false;
}

const RAW_MIME_BY_EXT: Record<string, string> = {
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".svg": "image/svg+xml",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".ogg": "audio/ogg",
  ".flac": "audio/flac",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".m4v": "video/x-m4v",
};

function mimeForRawPath(absPath: string): string | null {
  const low = absPath.toLowerCase();
  for (const [ext, mime] of Object.entries(RAW_MIME_BY_EXT)) {
    if (low.endsWith(ext)) {
      return mime;
    }
  }
  return null;
}
