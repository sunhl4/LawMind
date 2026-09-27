import {
  listBuiltInTemplates,
} from "../../../src/lawmind/templates/index.js";
import type { LawmindRouteContext } from "./lawmind-server-route-types.js";
import { sendJson } from "./lawmind-server-helpers.js";

const UPLOAD_RETIRED =
  "不再支持上传文书模板。出稿请用内置模板；我们会在后台继续增加模板。";

/**
 * 模板库：只读内置清单。上传 / 扫描 / 启停已退役，避免用户自带稿解析失败。
 */
export async function handleTemplateRoutes({
  pathname,
  req,
  res,
  c,
}: LawmindRouteContext): Promise<boolean> {
  if (pathname === "/api/templates" && req.method === "GET") {
    sendJson(res, 200, { ok: true, builtIn: listBuiltInTemplates(), uploaded: [] }, c);
    return true;
  }

  if (
    (pathname === "/api/templates/scan" ||
      pathname === "/api/templates/register" ||
      pathname === "/api/templates/enabled") &&
    req.method === "POST"
  ) {
    sendJson(res, 405, { ok: false, error: UPLOAD_RETIRED }, c);
    return true;
  }

  if (pathname === "/api/templates/uploaded" && req.method === "DELETE") {
    sendJson(res, 405, { ok: false, error: UPLOAD_RETIRED }, c);
    return true;
  }

  if (pathname === "/api/templates/built-in" && req.method === "GET") {
    sendJson(res, 200, { ok: true, templates: listBuiltInTemplates() }, c);
    return true;
  }

  if (pathname === "/api/templates/uploaded" && req.method === "GET") {
    sendJson(res, 200, { ok: true, templates: [] }, c);
    return true;
  }

  return false;
}
