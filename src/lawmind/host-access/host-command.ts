import fs from "node:fs";
import path from "node:path";
import { resolveOfficeCliBin } from "../artifacts/officecli-bin.js";
import { runSafeCommand } from "../platform/safe-command.js";
import { allowedRootsForCommands, resolveHostPath } from "./access-broker.js";
import type { HostAccessRuntime } from "./types.js";

const OFFICE_BINARIES = new Set(["officecli", "mdfind", "mdls"]);
const WORKSPACE_BINARIES = new Set(["git", "python", "python3"]);
const FORBIDDEN_BINARIES = new Set([
  "sh",
  "bash",
  "zsh",
  "fish",
  "dash",
  "cmd",
  "cmd.exe",
  "powershell",
  "powershell.exe",
  "pwsh",
  "pwsh.exe",
  "sudo",
  "osascript",
  "curl",
  "wget",
]);

export type HostCommandRequest = {
  command: string;
  args?: string[];
  cwd?: string;
};

export type HostCommandResult =
  | { ok: true; stdout: string; stderr: string; exitCode: number }
  | { ok: false; error: string; needsApproval?: boolean; level?: string };

function basenameCommand(command: string): string {
  return path.basename(command.trim()).toLowerCase();
}

export function hostCommandNeedsSessionAllow(command: string): boolean {
  return commandLevelFor(basenameCommand(command)) === "session";
}

function commandLevelFor(name: string): "office" | "workspace" | "session" | "forbidden" {
  if (FORBIDDEN_BINARIES.has(name)) {
    return "forbidden";
  }
  if (OFFICE_BINARIES.has(name)) {
    return "office";
  }
  if (WORKSPACE_BINARIES.has(name)) {
    return "workspace";
  }
  return "session";
}

function levelAllowed(
  needed: "office" | "workspace" | "session",
  configured: "office" | "workspace" | "session",
): boolean {
  const rank = { office: 1, workspace: 2, session: 3 };
  return rank[configured] >= rank[needed];
}

function resolveOnPath(command: string): string | undefined {
  const trimmed = command.trim();
  if (!trimmed) {
    return undefined;
  }
  if (path.isAbsolute(trimmed) && fs.existsSync(trimmed)) {
    return trimmed;
  }
  const pathEnv = process.env.PATH ?? "";
  const parts = pathEnv.split(path.delimiter);
  for (const dir of parts) {
    const candidate = path.join(dir, trimmed);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
    if (process.platform === "win32") {
      for (const ext of [".exe", ".cmd", ".bat"]) {
        const withExt = candidate + ext;
        if (fs.existsSync(withExt)) {
          return withExt;
        }
      }
    }
  }
  return undefined;
}

function argsEscapeRoots(args: string[], roots: string[]): string | undefined {
  for (const arg of args) {
    if (!arg.startsWith("/") && !/^[A-Za-z]:[\\/]/.test(arg)) {
      continue;
    }
    const abs = path.resolve(arg);
    if (
      !roots.some(
        (root) => abs === path.resolve(root) || abs.startsWith(path.resolve(root) + path.sep),
      )
    ) {
      return arg;
    }
  }
  return undefined;
}

export function authorizeHostCommand(
  runtime: HostAccessRuntime,
  request: HostCommandRequest,
  opts?: { approved?: boolean },
): HostCommandResult | { ok: true; command: string; args: string[]; cwd: string; roots: string[] } {
  if (!runtime.policy.allowHostCommands) {
    return { ok: false, error: "未打开本机命令。请到设置「本机能力」允许本机命令。" };
  }
  const name = basenameCommand(request.command);
  const needed = commandLevelFor(name);
  if (needed === "forbidden") {
    return { ok: false, error: `不允许运行 ${name}。` };
  }
  if (needed === "session") {
    if (!runtime.policy.allowSessionCommands || runtime.policy.hostCommandLevel !== "session") {
      return {
        ok: false,
        error: "该命令超出办公/工作副本白名单。Solo 可在本机能力中打开「本会话命令」。",
      };
    }
    if (!runtime.sessionCommandAllowed) {
      return {
        ok: false,
        error: "请先在本会话确认「本机命令：本会话允许」。",
        needsApproval: true,
        level: "session",
      };
    }
  }
  if (!levelAllowed(needed, runtime.policy.hostCommandLevel)) {
    return {
      ok: false,
      error:
        needed === "workspace"
          ? "请在本机能力中把本机命令档位调到「工作副本」。"
          : "当前本机命令档位不足。",
    };
  }
  if (needed !== "office" && opts?.approved !== true) {
    return {
      ok: false,
      error: "该本机命令需要律师确认后才能执行。",
      needsApproval: true,
      level: needed,
    };
  }

  let resolved =
    name === "officecli" || name === "officecli.exe"
      ? resolveOfficeCliBin({
          explicit: path.isAbsolute(request.command.trim()) ? request.command.trim() : undefined,
        })
      : undefined;
  if (!resolved) {
    resolved = resolveOnPath(request.command);
  }
  if (!resolved) {
    return { ok: false, error: `找不到命令：${request.command}` };
  }
  const roots = allowedRootsForCommands(runtime);
  const args = request.args ?? [];
  const bad = argsEscapeRoots(args, roots);
  if (bad) {
    return { ok: false, error: `参数路径不在已授权目录内：${path.basename(bad)}` };
  }
  let cwd = request.cwd?.trim() ? path.resolve(request.cwd) : runtime.workspaceDir;
  const cwdResolved = resolveHostPath(runtime, cwd);
  if (!cwdResolved.ok) {
    cwd = runtime.workspaceDir;
  } else {
    cwd = cwdResolved.abs;
  }
  return { ok: true, command: resolved, args, cwd, roots };
}

export async function runHostCommand(
  runtime: HostAccessRuntime,
  request: HostCommandRequest,
  opts?: { approved?: boolean },
): Promise<HostCommandResult> {
  const auth = authorizeHostCommand(runtime, request, opts);
  if (!auth.ok || !("command" in auth)) {
    return auth;
  }
  try {
    const result = await runSafeCommand({
      command: auth.command,
      args: auth.args,
      cwd: auth.cwd,
      allowedRoots: auth.roots,
      timeoutMs: 30_000,
    });
    return {
      ok: true,
      stdout: result.stdout.slice(0, 12_000),
      stderr: result.stderr.slice(0, 2000),
      exitCode: result.exitCode ?? 1,
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
