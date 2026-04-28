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
import type { LawmindRouteContext } from "./lawmind-server-route-types.js";
import { readJsonBody, sendJson } from "./lawmind-server-helpers.js";

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
      const body = (await readJsonBody(req)) as { path?: string };
      const rel = typeof body.path === "string" ? body.path.trim() : "";
      if (!rel) {
        sendJson(res, 400, { ok: false, error: "path is required" }, c);
        return true;
      }
      const full = resolvePathUnderWorkspace(workspaceDir, rel);
      if (!fs.existsSync(full) || !fs.statSync(full).isFile()) {
        sendJson(res, 400, { ok: false, error: "file not found" }, c);
        return true;
      }
      if (path.extname(full).toLowerCase() !== ".docx") {
        sendJson(res, 400, { ok: false, error: "only .docx scan supported" }, c);
        return true;
      }
      const placeholders = await scanDocxPlaceholders(full);
      sendJson(res, 200, { ok: true, placeholders, path: rel }, c);
    } catch (e) {
      sendJson(res, 400, { ok: false, error: e instanceof Error ? e.message : String(e) }, c);
    }
    return true;
  }

  if (pathname === "/api/templates/register" && req.method === "POST") {
    try {
      const body = (await readJsonBody(req)) as {
        id?: string;
        label?: string;
        format?: string;
        path?: string;
        /** 相对工作区；登记时会复制到 lawmind/templates/stored/ */
        sourcePath?: string;
        placeholderMap?: Record<string, string>;
        enabled?: boolean;
      };
      const id = body.id?.trim() ?? "";
      if (!id) {
        sendJson(res, 400, { ok: false, error: "id is required" }, c);
        return true;
      }
      if (!UPLOADED_ID_RE.test(id)) {
        sendJson(res, 400, { ok: false, error: "id must be like upload/firm-brief" }, c);
        return true;
      }
      const rel = (body.path ?? body.sourcePath ?? "").trim();
      if (!rel) {
        sendJson(res, 400, { ok: false, error: "path (relative to workspace) is required" }, c);
        return true;
      }
      const formatRaw = (body.format ?? "docx").toLowerCase();
      if (formatRaw !== "docx" && formatRaw !== "pptx") {
        sendJson(res, 400, { ok: false, error: "format must be docx or pptx" }, c);
        return true;
      }
      const full = resolvePathUnderWorkspace(workspaceDir, rel);
      if (!fs.existsSync(full) || !fs.statSync(full).isFile()) {
        sendJson(res, 400, { ok: false, error: "source file not found" }, c);
        return true;
      }
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
    const body = (await readJsonBody(req)) as { id?: string; enabled?: boolean };
    const id = body.id?.trim() ?? "";
    if (!id) {
      sendJson(res, 400, { ok: false, error: "id is required" }, c);
      return true;
    }
    if (typeof body.enabled !== "boolean") {
      sendJson(res, 400, { ok: false, error: "enabled boolean is required" }, c);
      return true;
    }
    const rec = await setUploadedTemplateEnabled({ workspaceDir, id, enabled: body.enabled });
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
