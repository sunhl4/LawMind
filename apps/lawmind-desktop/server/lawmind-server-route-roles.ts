/**
 * /api/roles — W7
 * GET /api/roles                     → 列出全部内置 Role
 * GET /api/roles/:roleId             → 单个 Role 详情
 */

import { getRoleById, listRoles } from "../../../src/lawmind/core/role.js";
import type { LawmindRouteContext } from "./lawmind-server-route-types.js";
import { sendJson } from "./lawmind-server-helpers.js";

export async function handleRolesRoutes({
  req,
  res,
  pathname,
  c,
}: LawmindRouteContext): Promise<boolean> {
  if (pathname === "/api/roles" && req.method === "GET") {
    sendJson(res, 200, { ok: true, roles: listRoles() }, c);
    return true;
  }
  if (pathname.startsWith("/api/roles/") && req.method === "GET") {
    const roleId = decodeURIComponent(pathname.slice("/api/roles/".length));
    const role = getRoleById(roleId);
    if (!role) {
      sendJson(res, 404, { ok: false, error: "role not found" }, c);
      return true;
    }
    sendJson(res, 200, { ok: true, role }, c);
    return true;
  }
  return false;
}
