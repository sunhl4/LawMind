/**
 * 安全 shell 命令网关（Safe Shell Command Gateway）
 *
 * 集中处理 Electron 主进程中打开外部程序/文件/链接的安全策略：
 *   - 命令白名单（仅 macOS `open`、Windows `explorer`/`start`、Linux `xdg-open`）
 *   - 绝对路径校验，拒绝相对路径与路径穿越
 *   - 参数数组化，禁止通过 shell 拼接
 *   - 审计 `safe_command` 事件到 workspaceDir/audit/
 *
 * 使用方：renderer 通过 IPC 调用 `lawmind:open-with-system`、
 * `lawmind:show-item-in-folder`、`lawmind:open-external`。
 */

import fs from "node:fs";
import path from "node:path";
import { shell } from "electron";
import { randomUUID } from "node:crypto";

const ALLOWED_OPEN_COMMANDS = new Set([
  "open", // macOS
  "explorer", // Windows
  "start", // Windows (cmd.exe 内置，但 PATH 中也可能存在)
  "xdg-open", // Linux
]);

function todayAuditFileName() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}.jsonl`;
}

function auditDirFromWorkspace(workspaceDir) {
  if (!workspaceDir || typeof workspaceDir !== "string") {
    return null;
  }
  return path.join(workspaceDir, "audit");
}

function ensureAuditDir(auditDir) {
  if (!auditDir) {
    return false;
  }
  try {
    fs.mkdirSync(auditDir, { recursive: true });
    return true;
  } catch {
    return false;
  }
}

function appendAuditLine(auditDir, event) {
  if (!auditDir) {
    return;
  }
  try {
    // 独立文件，避免写入引擎哈希链日审计而把链打断。
    const filePath = path.join(auditDir, `desktop-shell-${todayAuditFileName()}`);
    fs.appendFileSync(filePath, `${JSON.stringify(event)}\n`, "utf8");
  } catch {
    /* 审计为尽力而为，失败不阻塞业务 */
  }
}

function emitSafeCommandAudit(auditDir, command, args, result) {
  if (!auditDir) {
    return;
  }
  if (!ensureAuditDir(auditDir)) {
    return;
  }
  appendAuditLine(auditDir, {
    eventId: randomUUID(),
    taskId: "desktop-shell",
    kind: "safe_command",
    actor: "system",
    actorId: "electron-main",
    detail: JSON.stringify({
      command,
      args,
      ...result,
    }),
    timestamp: new Date().toISOString(),
  });
}

function assertAbsolutePath(targetPath) {
  if (typeof targetPath !== "string" || !targetPath.trim()) {
    throw new Error("path required");
  }
  const trimmed = targetPath.trim();
  if (!path.isAbsolute(trimmed)) {
    throw new Error("path must be absolute");
  }
  const normalized = path.normalize(trimmed);
  if (normalized !== trimmed && normalized !== path.resolve(trimmed)) {
    throw new Error("path contains traversal");
  }
  return normalized;
}

function assertAllowedOpenCommand(command) {
  const base = path.basename(command.trim()).toLowerCase();
  if (!ALLOWED_OPEN_COMMANDS.has(base)) {
    throw new Error(`command not allowed: ${base}`);
  }
  return base;
}

function runAllowedOpenCommand(command, args) {
  const base = assertAllowedOpenCommand(command);
  // 参数数组化，禁止 shell。
  const normalizedArgs = args.map((a) => String(a));
  if (base === "open" || base === "xdg-open") {
    return shell.openPath(normalizedArgs[0] ?? "");
  }
  if (base === "explorer" || base === "start") {
    return shell.openPath(normalizedArgs[0] ?? "");
  }
  throw new Error(`unsupported command: ${base}`);
}

/**
 * 用系统默认应用打开工作区/项目内文件（如 Word 文档）。
 * 调用方已负责路径根守卫；本函数只做绝对路径校验、命令白名单与审计。
 */
export async function safeOpenWithSystem(absPath, workspaceDir) {
  const auditDir = auditDirFromWorkspace(workspaceDir);
  const started = Date.now();
  let normalized;
  try {
    normalized = assertAbsolutePath(absPath);
    const err = await runAllowedOpenCommand("open", [normalized]);
    const durationMs = Date.now() - started;
    emitSafeCommandAudit(auditDir, "open_with_system", [normalized], {
      exitCode: err ? 1 : 0,
      error: err || undefined,
      durationMs,
    });
    return { ok: !err, error: err || undefined };
  } catch (e) {
    const durationMs = Date.now() - started;
    const msg = e instanceof Error ? e.message : String(e);
    emitSafeCommandAudit(auditDir, "open_with_system", [normalized ?? absPath], {
      exitCode: 1,
      error: msg,
      durationMs,
    });
    return { ok: false, error: msg };
  }
}

/**
 * 在 Finder/Explorer 中显示文件或目录。
 */
export async function safeShowItemInFolder(absPath, workspaceDir) {
  const auditDir = auditDirFromWorkspace(workspaceDir);
  const started = Date.now();
  let normalized;
  try {
    normalized = assertAbsolutePath(absPath);
    shell.showItemInFolder(normalized);
    const durationMs = Date.now() - started;
    emitSafeCommandAudit(auditDir, "show_item_in_folder", [normalized], {
      exitCode: 0,
      durationMs,
    });
    return { ok: true };
  } catch (e) {
    const durationMs = Date.now() - started;
    const msg = e instanceof Error ? e.message : String(e);
    emitSafeCommandAudit(auditDir, "show_item_in_folder", [normalized ?? absPath], {
      exitCode: 1,
      error: msg,
      durationMs,
    });
    return { ok: false, error: msg };
  }
}

/**
 * 用系统浏览器打开外部 URL。
 * 仅允许 http / https 协议。
 */
export async function safeOpenExternal(rawUrl, workspaceDir) {
  if (typeof rawUrl !== "string" || !rawUrl.trim()) {
    return { ok: false, error: "invalid_url" };
  }
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { ok: false, error: "invalid_url" };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, error: "protocol_not_allowed" };
  }
  const auditDir = auditDirFromWorkspace(workspaceDir);
  const started = Date.now();
  try {
    await shell.openExternal(parsed.toString());
    const durationMs = Date.now() - started;
    emitSafeCommandAudit(auditDir, "open_external", [parsed.toString()], {
      exitCode: 0,
      durationMs,
    });
    return { ok: true };
  } catch (e) {
    const durationMs = Date.now() - started;
    const msg = e instanceof Error ? e.message : String(e);
    emitSafeCommandAudit(auditDir, "open_external", [parsed.toString()], {
      exitCode: 1,
      error: msg,
      durationMs,
    });
    return { ok: false, error: msg };
  }
}

/**
 * 低层入口：用白名单命令打开文件/目录。
 * 参数必须为数组，禁止 shell 拼接。
 */
export async function safeShellCommand({ command, args, workspaceDir }) {
  const auditDir = auditDirFromWorkspace(workspaceDir);
  const normalizedArgs = (args ?? []).map((a) => String(a));
  const started = Date.now();
  try {
    for (const a of normalizedArgs) {
      assertAbsolutePath(a);
    }
    const err = await runAllowedOpenCommand(command, normalizedArgs);
    const durationMs = Date.now() - started;
    emitSafeCommandAudit(auditDir, command, normalizedArgs, {
      exitCode: err ? 1 : 0,
      error: err || undefined,
      durationMs,
    });
    return { ok: !err, error: err || undefined };
  } catch (e) {
    const durationMs = Date.now() - started;
    const msg = e instanceof Error ? e.message : String(e);
    emitSafeCommandAudit(auditDir, command, normalizedArgs, {
      exitCode: 1,
      error: msg,
      durationMs,
    });
    return { ok: false, error: msg };
  }
}
