/**
 * GET/POST /api/workspace/desk-settings — 工作区桌面偏好（批量合同目录等）
 */

import { readDeskSettings, writeDeskSettings } from "../../../src/lawmind/learning/desk-settings.js";
import type { LawmindRouteContext } from "./lawmind-server-route-types.js";
import { readJsonBody, sendJson } from "./lawmind-server-helpers.js";

export async function handleDeskSettingsRoutes({
  pathname,
  req,
  res,
  c,
  ctx,
}: LawmindRouteContext): Promise<boolean> {
  const { workspaceDir } = ctx;
  if (pathname !== "/api/workspace/desk-settings") {
    return false;
  }

  if (req.method === "GET") {
    const settings = await readDeskSettings(workspaceDir);
    sendJson(res, 200, { ok: true, settings }, c);
    return true;
  }

  if (req.method === "POST") {
    const body = (await readJsonBody(req)) as { contractBatchRelativeDir?: string | null };
    try {
      const settings = await writeDeskSettings(workspaceDir, {
        contractBatchRelativeDir: body.contractBatchRelativeDir,
      });
      sendJson(res, 200, { ok: true, settings }, c);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      sendJson(
        res,
        400,
        { ok: false, code: msg === "invalid_contract_batch_dir" ? "invalid_path" : "save_failed", message: msg },
        c,
      );
    }
    return true;
  }

  return false;
}
