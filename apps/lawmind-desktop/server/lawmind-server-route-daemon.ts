/**
 * Local lawmindd control — enable / start / stop. Spawn stays in-process of the desktop server.
 */

import { spawn } from "node:child_process";
import {
  buildDaemonProcessEnv,
  getDaemonStatus,
  setDaemonEnabled,
  stopDaemonProcess,
} from "../../../src/lawmind/platform/lawmind-daemon.js";
import { isInvalidRequestBodyError, parseJsonBodyZod } from "./lawmind-api-parse.js";
import { sendJsonError } from "./lawmind-api-error.js";
import type { LawmindRouteContext } from "./lawmind-server-route-types.js";
import { sendJson } from "./lawmind-server-helpers.js";
import { z } from "zod";

const patchSchema = z.object({
  action: z.enum(["enable", "disable", "start", "stop"]),
});

function spawnDetachedDaemon(): { ok: boolean; error?: string } {
  if (process.env.LAWMIND_DAEMON === "1") {
    return { ok: false, error: "already_daemon" };
  }
  try {
    const child = spawn(process.execPath, process.argv.slice(1), {
      detached: true,
      stdio: "ignore",
      env: buildDaemonProcessEnv(process.env),
    });
    child.unref();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function handleDaemonRoutes({
  ctx,
  pathname,
  req,
  res,
  c,
}: LawmindRouteContext): Promise<boolean> {
  if (pathname !== "/api/daemon") {
    return false;
  }
  const { workspaceDir } = ctx;

  if (req.method === "GET") {
    sendJson(res, 200, { ok: true, daemon: getDaemonStatus(workspaceDir) }, c);
    return true;
  }

  if (req.method !== "POST") {
    return false;
  }

  let body;
  try {
    body = await parseJsonBodyZod(req, patchSchema);
  } catch (err) {
    if (isInvalidRequestBodyError(err)) {
      sendJsonError(res, 400, "invalid_body", err.issues.join(" "), c);
      return true;
    }
    throw err;
  }

  if (body.action === "enable") {
    sendJson(res, 200, { ok: true, daemon: setDaemonEnabled(workspaceDir, true) }, c);
    return true;
  }
  if (body.action === "disable") {
    stopDaemonProcess(workspaceDir);
    sendJson(res, 200, { ok: true, daemon: setDaemonEnabled(workspaceDir, false) }, c);
    return true;
  }
  if (body.action === "stop") {
    sendJson(res, 200, { ok: true, daemon: stopDaemonProcess(workspaceDir) }, c);
    return true;
  }

  const current = getDaemonStatus(workspaceDir);
  if (current.running) {
    sendJson(res, 200, { ok: true, daemon: setDaemonEnabled(workspaceDir, true) }, c);
    return true;
  }
  if (process.env.LAWMIND_DAEMON !== "1") {
    sendJson(
      res,
      200,
      {
        ok: true,
        daemon: setDaemonEnabled(workspaceDir, true),
        message: "桌面开着时由本窗口办件。关掉 LawMind 后才会在这台电脑上继续。",
      },
      c,
    );
    return true;
  }
  setDaemonEnabled(workspaceDir, true);
  const spawned = spawnDetachedDaemon();
  if (!spawned.ok) {
    sendJsonError(res, 500, "daemon_spawn_failed", spawned.error ?? "无法启动后台办件。", c);
    return true;
  }
  sendJson(res, 200, { ok: true, daemon: { ...getDaemonStatus(workspaceDir), starting: true } }, c);
  return true;
}
