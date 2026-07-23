import fs from "node:fs";
import path from "node:path";
import { scanDocxPlaceholders } from "../../../src/lawmind/templates/docx-template-fill.js";
import {
  listBuiltInTemplates,
  listUploadedTemplates,
  registerUploadedTemplate,
  removeUploadedTemplate,
  setUploadedTemplateEnabled,
} from "../../../src/lawmind/templates/index.js";
import { parseJsonBodyZod } from "./lawmind-api-parse.js";
import {
  templateEnabledPostSchema,
  templateRegisterPostSchema,
  templateScanPostSchema,
} from "./lawmind-api-schemas.js";
import type { LawmindRouteContext } from "./lawmind-server-route-types.js";
import { sendJson } from "./lawmind-server-helpers.js";

const UPLOADED_ID_RE = /^upload\/[a-z0-9][a-z0-9._-]{1,63}$/;

function resolvePathUnderWorkspace(workspaceDir: string, rel: string): string {
  const norm = rel.replace(/^\//, "");
  const abs = path.resolve(workspaceDir, norm);
  const root = path.resolve(workspaceDir);
  if (abs !== root && !abs.startsWith(root + path.sep)) {
    throw new Error("path must be under workspace");
  }
  return abs;
}

/** Resolve template source: absolute path (desktop pick/drop) or workspace-relative. */
function resolveTemplateSourceFile(
  workspaceDir: string,
  body: { path?: string; sourcePath?: string; absolutePath?: string },
): string {
  const absRaw = (body.absolutePath ?? "").trim();
  if (absRaw) {
    if (!path.isAbsolute(absRaw)) {
      throw new Error("absolutePath must be an absolute filesystem path");
    }
    const abs = path.resolve(absRaw);
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
      throw new Error("source file not found");
    }
    return abs;
  }
  const rel = (body.path ?? body.sourcePath ?? "").trim();
  if (!rel) {
    throw new Error("path (relative to workspace) or absolutePath is required");
  }
  const full = resolvePathUnderWorkspace(workspaceDir, rel);
  if (!fs.existsSync(full) || !fs.statSync(full).isFile()) {
    throw new Error("source file not found");
  }
  return full;
}

/**
 * 模板库：列表、扫描 .docx 占位符、登记上传模板、启停、删除
 */
export async function handleTemplateRoutes({
  ctx,
  pathname,
  req,
  res,
  url,
  c,
}: LawmindRouteContext): Promise<boolean> {
  const { workspaceDir } = ctx;

  if (pathname === "/api/templates" && req.method === "GET") {
    const builtIn = listBuiltInTemplates();
    const uploaded = await listUploadedTemplates(workspaceDir);
    sendJson(res, 200, { ok: true, builtIn, uploaded }, c);
    return true;
  }

  if (pathname === "/api/templates/scan" && req.method === "POST") {
    try {
      const body = await parseJsonBodyZod(req, templateScanPostSchema);
      const full = resolveTemplateSourceFile(workspaceDir, body);
      if (path.extname(full).toLowerCase() !== ".docx") {
        sendJson(res, 400, { ok: false, error: "only .docx scan supported" }, c);
        return true;
      }
      const placeholders = await scanDocxPlaceholders(full);
      sendJson(
        res,
        200,
        {
          ok: true,
          placeholders,
          path: body.path?.trim() || undefined,
          absolutePath: body.absolutePath?.trim() || undefined,
        },
        c,
      );
    } catch (e) {
      sendJson(res, 400, { ok: false, error: e instanceof Error ? e.message : String(e) }, c);
    }
    return true;
  }

  if (pathname === "/api/templates/register" && req.method === "POST") {
    try {
      const body = await parseJsonBodyZod(req, templateRegisterPostSchema);
      const id = body.id;
      if (!UPLOADED_ID_RE.test(id)) {
        sendJson(res, 400, { ok: false, error: "id must be like upload/firm-brief" }, c);
        return true;
      }
      const formatRaw = (body.format ?? "docx").toLowerCase();
      if (formatRaw !== "docx" && formatRaw !== "pptx") {
        sendJson(res, 400, { ok: false, error: "format must be docx or pptx" }, c);
        return true;
      }
      const full = resolveTemplateSourceFile(workspaceDir, body);
      const label = (body.label ?? id).trim();
      const rec = await registerUploadedTemplate({
        workspaceDir,
        id,
        format: formatRaw,
        label,
        sourcePath: full,
        placeholderMap: body.placeholderMap ?? {},
        enabled: body.enabled,
      });
      sendJson(res, 200, { ok: true, template: rec }, c);
    } catch (e) {
      sendJson(res, 400, { ok: false, error: e instanceof Error ? e.message : String(e) }, c);
    }
    return true;
  }

  if (pathname === "/api/templates/enabled" && req.method === "POST") {
    let body;
    try {
      body = await parseJsonBodyZod(req, templateEnabledPostSchema);
    } catch {
      sendJson(res, 400, { ok: false, error: "id is required" }, c);
      return true;
    }
    const rec = await setUploadedTemplateEnabled({ workspaceDir, id: body.id, enabled: body.enabled });
    if (!rec) {
      sendJson(res, 404, { ok: false, error: "not found" }, c);
    } else {
      sendJson(res, 200, { ok: true, template: rec }, c);
    }
    return true;
  }

  if (pathname === "/api/templates/uploaded" && req.method === "DELETE") {
    const id = url.searchParams.get("id")?.trim() ?? "";
    if (!UPLOADED_ID_RE.test(id)) {
      sendJson(res, 400, { ok: false, error: "invalid id" }, c);
      return true;
    }
    const ok = await removeUploadedTemplate({ workspaceDir, id });
    if (!ok) {
      sendJson(res, 404, { ok: false, error: "not found" }, c);
      return true;
    }
    sendJson(res, 200, { ok: true }, c);
    return true;
  }

  if (pathname === "/api/templates/built-in" && req.method === "GET") {
    sendJson(res, 200, { ok: true, templates: listBuiltInTemplates() }, c);
    return true;
  }

  if (pathname === "/api/templates/uploaded" && req.method === "GET") {
    const uploaded = await listUploadedTemplates(workspaceDir);
    sendJson(res, 200, { ok: true, templates: uploaded }, c);
    return true;
  }

  return false;
}
