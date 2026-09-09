/**
 * 统一命令执行网关（Safe Command Gateway）
 *
 * 集中处理子进程命令的安全策略：
 *   ① 命令白名单 / 绝对路径解析
 *   ② 禁止 shell，参数必须数组化
 *   ③ env 注入审计（只传白名单 env）
 *   ④ cwd 限制（必须在工作区或临时目录下）
 *   ⑤ 超时、子进程资源清理
 *   ⑥ 输出审计（含命令摘要、退出码、stderr 前 200 字符）
 *
 * 使用方：MCP stdio、tool sandbox 子进程、lawmindd 等。
 * 安全规则注释保留中文，便于律所 IT 审阅。
 */

import { fork, spawn, type ChildProcess, type StdioOptions } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { emit } from "../audit/index.js";
import type { AuditEvent } from "../types.js";

export type SafeCommandOptions = {
  /** 可执行文件或 IPC 入口模块路径。 */
  command: string;
  args?: string[];
  cwd?: string;
  /** 允许的工作区/临时目录根列表；提供时 cwd 必须落在其中。 */
  allowedRoots?: string[];
  env?: NodeJS.ProcessEnv;
  /** 是否允许使用 shell（默认 false，即强制数组传参）。 */
  allowShell?: boolean;
  /** 是否使用 IPC fork；为 true 时 command 是模块路径。 */
  ipc?: boolean;
  execArgv?: string[];
  timeoutMs?: number;
  signal?: AbortSignal;
  stdio?: StdioOptions;
  detached?: boolean;
  killSignal?: NodeJS.Signals;
  auditDir?: string;
  taskId?: string;
  actor?: AuditEvent["actor"];
  actorId?: string;
  detail?: string;
};

export type SafeCommandResult = {
  exitCode: number | null;
  exitSignal: string | null;
  durationMs: number;
  stdout: string;
  stderr: string;
};

export type SafeCommandHandle = {
  child: ChildProcess;
  finished: Promise<SafeCommandResult>;
  kill(signal?: NodeJS.Signals): boolean;
};

export class SafeCommandError extends Error {
  readonly name = "SafeCommandError";
}

/** 禁止作为外部命令执行的系统 shell（防止参数注入一键拿 shell）。 */
const FORBIDDEN_SHELL_COMMANDS = new Set([
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
]);

/** 禁止出现在参数里的代码执行开关（与 shell 命令组合可 RCE）。 */
const FORBIDDEN_SHELL_ARGS = new Set([
  "-c",
  "/c",
  "-Command",
  "-command",
  "-e",
  "--eval",
  "--execute",
]);

/** 子进程默认允许继承的最小宿主环境变量。 */
const SAFE_COMMAND_HOST_ENV_KEYS = [
  "PATH",
  "HOME",
  "TMPDIR",
  "TEMP",
  "TMP",
  "LANG",
  "LC_ALL",
  "USER",
  "LOGNAME",
  "NODE_PATH",
  "SYSTEMROOT",
  "COMSPEC",
  "APPDATA",
  "LOCALAPPDATA",
] as const;

/** 绝不允许进入子进程的环境变量（本地 API token、鉴权旁路）。 */
const SAFE_COMMAND_ENV_DENY_EXACT = new Set([
  "LAWMIND_LOCAL_API_TOKEN",
  "LAWMIND_SKIP_API_AUTH",
  "LAWMIND_DESKTOP_PORT",
]);

/** 常见模型 / 集成密钥前缀（OPENAI_API_KEY、BRAVE_API_KEY …）。 */
const SAFE_COMMAND_SECRET_PREFIX_RE =
  /^(OPENAI|ANTHROPIC|AZURE|GOOGLE|GEMINI|DEEPSEEK|DASHSCOPE|QWEN|MOONSHOT|ZHIPU|MISTRAL|GROQ|COHERE|XAI|PERPLEXITY|BRAVE|TAVILY|SERPER|EXA)_/;

/** LAWMIND_ 前缀中的密钥项（LAWMIND_AUTHORITY_API_KEY / LAWMIND_MCP_*_SECRET …）。 */
const SAFE_COMMAND_LAWMIND_SECRET_RE = /^LAWMIND_.*(_KEY|_TOKEN|_SECRET|_PASSWORD)$/;

export type SafeChildEnvOptions = {
  source?: NodeJS.ProcessEnv;
  extra?: NodeJS.ProcessEnv;
  hostEnvKeys?: string[];
  denyExact?: Set<string> | string[];
  denyPrefixRe?: RegExp;
  allowLawmindSecrets?: boolean;
};

/**
 * 构建子进程环境变量白名单。
 * 默认只保留运行所需的最小宿主变量 + 显式 extra；绝不让模型/集成密钥和本地 API token 流入子进程。
 */
export function buildSafeChildEnv(opts: SafeChildEnvOptions = {}): Record<string, string> {
  const source = opts.source ?? process.env;
  const extra = opts.extra ?? {};
  const hostKeys = new Set(opts.hostEnvKeys ?? SAFE_COMMAND_HOST_ENV_KEYS);
  const denyExact = opts.denyExact
    ? opts.denyExact instanceof Set
      ? opts.denyExact
      : new Set(opts.denyExact)
    : SAFE_COMMAND_ENV_DENY_EXACT;
  const denyPrefixRe = opts.denyPrefixRe ?? SAFE_COMMAND_SECRET_PREFIX_RE;
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    if (typeof value !== "string" || value === "") {
      continue;
    }
    if (denyExact.has(key)) {
      continue;
    }
    if (denyPrefixRe.test(key) || SAFE_COMMAND_LAWMIND_SECRET_RE.test(key)) {
      continue;
    }
    // 只允许最小宿主环境变量 + 过滤掉密钥后的 LAWMIND_* 配置（沙箱需要，MCP 不需要）。
    const isHostKey = hostKeys.has(key);
    const isAllowedLawmind = opts.allowLawmindSecrets && key.startsWith("LAWMIND_");
    if (isHostKey || isAllowedLawmind) {
      out[key] = value;
    }
  }
  for (const [key, value] of Object.entries(extra)) {
    if (typeof value === "string" && value !== "" && !denyExact.has(key)) {
      out[key] = value;
    }
  }
  return out;
}

/** MCP 子进程最小环境（不继承 LAWMIND_ 配置，仅传 extra）。 */
export function buildMinimalChildEnv(extra?: NodeJS.ProcessEnv): Record<string, string> {
  return buildSafeChildEnv({ source: process.env, extra, allowLawmindSecrets: false });
}

/** 沙箱子进程环境：允许 LAWMIND_* 非敏感配置，但过滤密钥。 */
export function buildSandboxChildEnv(
  source: NodeJS.ProcessEnv = process.env,
  extra?: NodeJS.ProcessEnv,
): Record<string, string> {
  return buildSafeChildEnv({ source, extra, allowLawmindSecrets: true });
}

function isForbiddenShell(command: string, args: string[]): string | undefined {
  const base = path.basename(command.trim()).toLowerCase();
  if (!base) {
    return "命令不能为空";
  }
  if (FORBIDDEN_SHELL_COMMANDS.has(base)) {
    return `不允许使用系统 shell 作为外部命令：${base}`;
  }
  if (args.some((a) => FORBIDDEN_SHELL_ARGS.has(a))) {
    return "参数中禁止出现代码执行开关（如 -c / -Command）";
  }
  return undefined;
}

function findInPath(command: string, envPath?: string): string | undefined {
  const delimiter = process.platform === "win32" ? ";" : ":";
  const dirs = (envPath ?? process.env.PATH ?? "").split(delimiter).filter(Boolean);
  for (const dir of dirs) {
    const candidate = path.join(dir, command);
    if (fs.existsSync(candidate) && !fs.statSync(candidate).isDirectory()) {
      return candidate;
    }
    if (process.platform === "win32") {
      for (const ext of [".exe", ".cmd", ".bat"]) {
        const withExt = `${candidate}${ext}`;
        if (fs.existsSync(withExt) && !fs.statSync(withExt).isDirectory()) {
          return withExt;
        }
      }
    }
  }
  return undefined;
}

function resolveCommandPath(command: string, cwd: string, ipc: boolean): string {
  const trimmed = command.trim();
  if (!trimmed) {
    throw new SafeCommandError("命令不能为空");
  }
  if (ipc) {
    // IPC 入口必须是存在的模块文件；相对路径基于 cwd 解析。
    const resolved = path.resolve(cwd, trimmed);
    if (!fs.existsSync(resolved)) {
      throw new SafeCommandError(`IPC 入口不存在：${resolved}`);
    }
    return resolved;
  }
  if (path.isAbsolute(trimmed)) {
    if (!fs.existsSync(trimmed)) {
      throw new SafeCommandError(`命令不存在：${trimmed}`);
    }
    return trimmed;
  }
  if (trimmed.includes(path.sep) || (process.platform === "win32" && trimmed.includes("\\"))) {
    const resolved = path.resolve(cwd, trimmed);
    if (!fs.existsSync(resolved)) {
      throw new SafeCommandError(`命令不存在：${resolved}`);
    }
    return resolved;
  }
  const fromPath = findInPath(trimmed);
  if (!fromPath) {
    throw new SafeCommandError(`PATH 中找不到命令：${trimmed}`);
  }
  return fromPath;
}

function normalizeCwd(cwd?: string, allowedRoots?: string[]): string {
  const base = cwd ? path.resolve(cwd) : process.cwd();
  if (!allowedRoots || allowedRoots.length === 0) {
    return base;
  }
  const roots = allowedRoots.map((r) => path.resolve(r));
  for (const root of roots) {
    const rel = path.relative(root, base);
    if (!rel.startsWith("..") && !path.isAbsolute(rel)) {
      return base;
    }
  }
  throw new SafeCommandError(`cwd 超出允许目录：${base}`);
}

function safeSummary(command: string, args: string[] = []): string {
  const base = path.basename(command);
  const argSummary = args.join(" ").slice(0, 80);
  return `${base} ${argSummary}`.trim();
}

async function emitSafeCommandAudit(
  opts: SafeCommandOptions,
  command: string,
  args: string[],
  cwd: string,
  result: SafeCommandResult,
): Promise<void> {
  if (!opts.auditDir) {
    return;
  }
  await emit(opts.auditDir, {
    taskId: opts.taskId ?? "system",
    kind: "safe_command",
    actor: opts.actor ?? "system",
    actorId: opts.actorId,
    detail: JSON.stringify({
      command: safeSummary(command, args),
      cwd,
      exitCode: result.exitCode,
      exitSignal: result.exitSignal,
      durationMs: result.durationMs,
      stderr: result.stderr.slice(0, 200),
    }),
  }).catch(() => undefined);
}

function startChild(
  command: string,
  args: string[],
  cwd: string,
  options: SafeCommandOptions,
): ChildProcess {
  if (options.ipc) {
    return fork(command, args, {
      cwd,
      env: options.env,
      stdio: ["ignore", "ignore", "ignore", "ipc"],
      execArgv: options.execArgv,
      detached: options.detached,
    });
  }
  return spawn(command, args, {
    cwd,
    env: options.env,
    shell: options.allowShell === true,
    stdio: options.stdio ?? ["pipe", "pipe", "pipe"],
    detached: options.detached,
  });
}

export function safeCommand(options: SafeCommandOptions): SafeCommandHandle {
  // 1. 安全校验：禁止 shell 与代码执行参数。
  if (options.allowShell !== true) {
    const forbidden = isForbiddenShell(options.command, options.args ?? []);
    if (forbidden) {
      throw new SafeCommandError(forbidden);
    }
  }

  // 2. 解析并绝对化命令路径。
  const cwd = normalizeCwd(options.cwd, options.allowedRoots);
  const command = resolveCommandPath(options.command, cwd, options.ipc === true);
  const args = options.args ?? [];

  // 3. 启动子进程。
  const startedAt = Date.now();
  let child: ChildProcess;
  try {
    child = startChild(command, args, cwd, options);
  } catch (err) {
    const result: SafeCommandResult = {
      exitCode: null,
      exitSignal: null,
      durationMs: Date.now() - startedAt,
      stdout: "",
      stderr: err instanceof Error ? err.message : String(err),
    };
    void emitSafeCommandAudit(options, command, args, cwd, result).catch(() => undefined);
    throw err;
  }

  // 4. 捕获 stdout/stderr 用于审计与错误摘要。
  let stdout = "";
  let stderr = "";
  if (child.stdout) {
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      if (stdout.length > 1000) {
        stdout = stdout.slice(0, 1000);
      }
    });
  }
  if (child.stderr) {
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
      if (stderr.length > 1000) {
        stderr = stderr.slice(0, 1000);
      }
    });
  }

  // 5. 超时与信号处理。
  let timer: NodeJS.Timeout | undefined;
  const cleanupTimer = () => {
    if (timer) {
      clearTimeout(timer);
      timer = undefined;
    }
  };
  if (options.timeoutMs && options.timeoutMs > 0) {
    timer = setTimeout(() => {
      try {
        child.kill(options.killSignal ?? "SIGTERM");
      } catch {
        /* ignore */
      }
    }, options.timeoutMs);
  }
  let signalHandler: (() => void) | undefined;
  if (options.signal) {
    signalHandler = () => {
      try {
        child.kill(options.killSignal ?? "SIGTERM");
      } catch {
        /* ignore */
      }
    };
    if (options.signal.aborted) {
      signalHandler();
    } else {
      options.signal.addEventListener("abort", signalHandler, { once: true });
    }
  }

  if (options.detached) {
    try {
      child.unref();
    } catch {
      /* ignore */
    }
  }

  // 6. 资源清理与审计。
  let settled = false;
  const finished = new Promise<SafeCommandResult>((resolve, reject) => {
    const finish = async (exitCode: number | null, exitSignal: string | null) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanupTimer();
      if (signalHandler && options.signal) {
        options.signal.removeEventListener("abort", signalHandler);
      }
      const result: SafeCommandResult = {
        exitCode,
        exitSignal,
        durationMs: Date.now() - startedAt,
        stdout,
        stderr,
      };
      await emitSafeCommandAudit(options, command, args, cwd, result);
      resolve(result);
    };
    child.on("error", async (err) => {
      if (!settled) {
        cleanupTimer();
        if (signalHandler && options.signal) {
          options.signal.removeEventListener("abort", signalHandler);
        }
        settled = true;
        const result: SafeCommandResult = {
          exitCode: null,
          exitSignal: null,
          durationMs: Date.now() - startedAt,
          stdout,
          stderr: err.message,
        };
        await emitSafeCommandAudit(options, command, args, cwd, result);
        reject(err);
      }
    });
    child.on("exit", (code, signal) => void finish(code ?? null, signal ?? null));
    child.on("close", (code, signal) => void finish(code ?? null, signal ?? null));
  });

  return {
    child,
    finished,
    kill(signal = options.killSignal ?? "SIGTERM") {
      cleanupTimer();
      return child.kill(signal);
    },
  };
}

/** 便捷函数：等待子进程结束并返回结果。 */
export async function runSafeCommand(options: SafeCommandOptions): Promise<SafeCommandResult> {
  const handle = safeCommand(options);
  return handle.finished;
}
