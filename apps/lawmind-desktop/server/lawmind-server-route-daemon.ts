/**
 * Local lawmindd control — enable / start / stop. Spawn stays in-process of the desktop server.
 */

import path from "node:path";
import {
  buildDaemonProcessEnv,
  getDaemonStatus,
  setDaemonEnabled,
  stopDaemonProcess,
  summarizeDaemonForLawyer,
} from "../../../src/lawmind/platform/lawmind-daemon.js";
import { safeCommand } from "../../../src/lawmind/platform/safe-command.js";
import {
  daemonLogExists,
  readDaemonLogTail,
} from "../../../src/lawmind/platform/lawmind-daemon-log.js";
import { isInvalidRequestBodyError, parseJsonBodyZod } from "./lawmind-api-parse.js";
import { sendJsonError } from "./lawmind-api-error.js";
import type { LawmindRouteContext } from "./lawmind-server-route-types.js";
import { sendJson } from "./lawmind-server-helpers.js";
import { z } from "zod";

const patchSchema = z.object({
  action: z.enum(["enable", "disable", "start", "stop"]),
});

/**
 * 律师侧回执在服务端组装。
 *
 * 渲染进程不能直接 import `lawmind-daemon.ts`（它依赖 `node:fs`），
 * 而律师可读的文案必须只有一处实现、被单测覆盖——所以放在这里，
 * 让「你走后发生了什么」的措辞只有引擎一个真相源。
 */
function daemonPayload(workspaceDir: string) {
  const status = getDaemonStatus(workspaceDir);
  return { ...status, recap: summarizeDaemonForLawyer(status) };
}

function spawnDetachedDaemon(workspaceDir: string): { ok: boolean; error?: string } {
  if (process.env.LAWMIND_DAEMON === "1") {
    return { ok: false, error: "already_daemon" };
  }
  try {
    // 统一命令网关：校验绝对路径、禁止 shell、过滤 env、记录 safe_command 审计。
    safeCommand({
      command: process.execPath,
      args: process.argv.slice(1),
      detached: true,
      stdio: "ignore",
      // 起监督进程而不是裸 tick 进程：崩了才会被按退避自动拉起。
      env: buildDaemonProcessEnv(process.env, undefined, { supervisor: true }),
      auditDir: path.join(workspaceDir, "audit"),
      taskId: "daemon",
      actor: "system",
    });
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
  url,
  c,
}: LawmindRouteContext): Promise<boolean> {
  // 后台日志的读取面。为什么必须存在：日志一直被写（监督进程与子进程都写），
  // E2E 与单测也读，但**产品里没有任何地方能让律师看到它** ——
  // 「关桌面后继续办件」出问题时的现场只躺在文件系统里，等于把排障推给律师。
  // 上限由 readDaemonLogTail 内部裁剪，且拒绝超大请求，避免变成一个数据出口。
  if (pathname === "/api/daemon/log" && req.method === "GET") {
    const { workspaceDir } = ctx;
    // 注意 `Number(null) === 0`：不带参数时必须走默认值，否则会被夹到 1 行
    // （这个坑是测试抓到的——默认请求只回来了最后一行）。
    const rawLines = url.searchParams.get("lines")?.trim();
    const requested = rawLines ? Number(rawLines) : Number.NaN;
    const lines = Number.isFinite(requested)
      ? Math.min(500, Math.max(1, Math.floor(requested)))
      : 200;
    sendJson(
      res,
      200,
      {
        ok: true,
        log: { lines: readDaemonLogTail(workspaceDir, lines), exists: daemonLogExists(workspaceDir) },
      },
      c,
    );
    return true;
  }

  if (pathname !== "/api/daemon") {
    return false;
  }
  const { workspaceDir } = ctx;

  if (req.method === "GET") {
    sendJson(res, 200, { ok: true, daemon: daemonPayload(workspaceDir) }, c);
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
    sendJson(res, 200, { ok: true, daemon: daemonPayload(workspaceDir) }, c);
    return true;
  }
  if (body.action === "disable") {
    stopDaemonProcess(workspaceDir);
    setDaemonEnabled(workspaceDir, false);
    sendJson(res, 200, { ok: true, daemon: daemonPayload(workspaceDir) }, c);
    return true;
  }
  if (body.action === "stop") {
    stopDaemonProcess(workspaceDir);
    sendJson(res, 200, { ok: true, daemon: daemonPayload(workspaceDir) }, c);
    return true;
  }

  const current = getDaemonStatus(workspaceDir);
  if (current.running) {
    sendJson(res, 200, { ok: true, daemon: daemonPayload(workspaceDir) }, c);
    return true;
  }
  if (process.env.LAWMIND_DAEMON !== "1") {
    setDaemonEnabled(workspaceDir, true);
    sendJson(
      res,
      200,
      {
        ok: true,
        daemon: daemonPayload(workspaceDir),
        message: "桌面开着时由本窗口办件。关掉 LawMind 后才会在这台电脑上继续。",
      },
      c,
    );
    return true;
  }
  setDaemonEnabled(workspaceDir, true);
  const spawned = spawnDetachedDaemon(workspaceDir);
  if (!spawned.ok) {
    sendJsonError(res, 500, "daemon_spawn_failed", spawned.error ?? "无法启动后台办件。", c);
    return true;
  }
  sendJson(res, 200, { ok: true, daemon: { ...daemonPayload(workspaceDir), starting: true } }, c);
  return true;
}
