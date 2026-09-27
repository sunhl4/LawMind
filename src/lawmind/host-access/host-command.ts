import fs from "node:fs";
import path from "node:path";
import { resolveOfficeCliBin } from "../artifacts/officecli-bin.js";
import { runSafeCommand } from "../platform/safe-command.js";
import { ensureLocalFile, IcloudLawyerPrompt } from "../runtime/icloud-materialize.js";
import { allowedRootsForCommands, resolveHostPath } from "./access-broker.js";
import { isUnderRoot } from "./paths.js";
import type { HostAccessRuntime } from "./types.js";

const OFFICE_BINARIES = new Set(["officecli", "mdfind", "mdls"]);
const WORKSPACE_BINARIES = new Set(["git", "python", "python3"]);

/**
 * officecli：可改写文件，且它的**位置参数是文档选择器**而不是文件系统路径。
 *
 * 两个性质各有后果：
 *   1. 可写 ⇒ 参数与 cwd 只能落在工作区内（挂载点是只读面，见 `resolveHostPath`
 *      的 `write_forbidden`）。只读命令（mdfind / mdls）不受此限。
 *   2. 选择器 ⇒ `/body`、`/`、`/header[1]` 这类参数不能当文件系统路径校验，否则
 *      `--find/--replace` 编辑（必然带选择器）会被全部误拒。见 OFFICECLI_SELECTOR_RE。
 */
const OFFICECLI_COMMANDS = new Set(["officecli", "officecli.exe"]);

/**
 * officecli 的文档位置选择器白名单。
 *
 * 语法是 `officecli <cmd> <file> <path> …`：真正被改写的是 `<file>` 位置参数，
 * 选择器只指定文档内部范围。所以判定必须**白名单式**——只认 OOXML 已知部件名，
 * 不匹配就退回文件系统路径校验，宁可误拒也不误放。
 */
const OFFICECLI_SELECTOR_RE =
  /^\/(?:body|header|footer|comments?|endnotes?|footnotes?|styles|numbering|settings|theme|metadata|docProps|revision|slide|sheet)\d*(?:\[[^\]]*\])?(?:\/.*)?$/i;

function isOfficeCliSelector(arg: string): boolean {
  // 单独一个 `/` 表示整篇文档作用域，是最常见的编辑形式（`set doc.docx / --find …`）。
  return arg === "/" || OFFICECLI_SELECTOR_RE.test(arg);
}
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

function argsEscapeRoots(
  args: string[],
  roots: string[],
  opts?: { allowDocumentSelectors?: boolean },
): string | undefined {
  for (const arg of args) {
    if (!arg.startsWith("/") && !/^[A-Za-z]:[\\/]/.test(arg)) {
      continue;
    }
    if (opts?.allowDocumentSelectors && isOfficeCliSelector(arg)) {
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
  void opts;
  if (!runtime.policy.allowHostCommands) {
    return { ok: false, error: "当前不能运行这条本机命令。" };
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
        error: "该命令超出办公与分析白名单。",
      };
    }
  }
  if (!levelAllowed(needed, runtime.policy.hostCommandLevel)) {
    return {
      ok: false,
      error: "当前不能运行这条本机命令。",
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
  const isOfficeCli = OFFICECLI_COMMANDS.has(name);
  const roots = isOfficeCli ? [runtime.workspaceDir] : allowedRootsForCommands(runtime);
  const args = request.args ?? [];
  const bad = argsEscapeRoots(args, roots, { allowDocumentSelectors: isOfficeCli });
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
  if (isOfficeCli && !isUnderRoot(runtime.workspaceDir, cwd)) {
    // 相对路径参数以 cwd 为基准解析，所以写类命令的 cwd 也必须留在工作区内。
    cwd = runtime.workspaceDir;
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
    await materializeHostCommandInputs(auth.args, auth.cwd);
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
    if (err instanceof IcloudLawyerPrompt) {
      throw err;
    }
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** 命令参数里的文件若还在 iCloud，先落到本机再交给子进程，避免 textutil 堵在 read() 上。 */
async function materializeHostCommandInputs(args: readonly string[], cwd: string): Promise<void> {
  const seen = new Set<string>();
  for (const raw of args) {
    if (!raw || raw.startsWith("-")) {
      continue;
    }
    const candidate = path.isAbsolute(raw) ? raw : path.resolve(cwd, raw);
    if (seen.has(candidate)) {
      continue;
    }
    seen.add(candidate);
    await ensureLocalFile(candidate);
  }
}
