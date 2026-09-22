/**
 * 离线许可路由（软门槛）。
 *
 *   GET  /api/license            → 当前许可/试用状态
 *   POST /api/license/activate   → { code } 校验签名并写盘
 *   POST /api/license/clear      → 清除已保存激活码（回到试用/到期口径）
 *
 * 无网络调用；激活码校验失败一律拒绝写入。
 */

import { z } from "zod";
import {
  activateLicense,
  clearLicense,
  machineFingerprint,
  resolveLicenseState,
} from "../../../src/lawmind/license/index.js";
import { isInvalidRequestBodyError, parseJsonBodyZod } from "./lawmind-api-parse.js";
import { sendJson } from "./lawmind-server-helpers.js";
import type { LawmindRouteContext } from "./lawmind-server-route-types.js";

const activateSchema = z.object({
  code: z.string().min(1),
});

export async function handleLicenseRoutes({
  pathname,
  req,
  res,
  c,
}: LawmindRouteContext): Promise<boolean> {
  if (pathname === "/api/license" && req.method === "GET") {
    sendJson(res, 200, { ok: true, license: resolveLicenseState() }, c);
    return true;
  }

  if (pathname === "/api/license/fingerprint" && req.method === "GET") {
    // 绑机签发时律师需把本机指纹交给发行方；这不是秘密，但只在本机 API 暴露。
    sendJson(res, 200, { ok: true, fingerprint: machineFingerprint() }, c);
    return true;
  }

  if (pathname === "/api/license/activate" && req.method === "POST") {
    let body: { code: string };
    try {
      body = await parseJsonBodyZod(req, activateSchema);
    } catch (err) {
      if (isInvalidRequestBodyError(err)) {
        sendJson(res, 400, { ok: false, error: "code required" }, c);
        return true;
      }
      throw err;
    }
    const result = activateLicense(body.code);
    if (!result.ok) {
      sendJson(res, 400, { ok: false, error: result.error, reason: result.reason }, c);
      return true;
    }
    sendJson(res, 200, { ok: true, license: result.state }, c);
    return true;
  }

  if (pathname === "/api/license/clear" && req.method === "POST") {
    clearLicense();
    sendJson(res, 200, { ok: true, license: resolveLicenseState() }, c);
    return true;
  }

  return false;
}
