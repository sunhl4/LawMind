/**
 * `pnpm lawmind:daemon` 参数。与桌面共用同一套 loopback HTTP，不另开协议。
 */

import path from "node:path";
import { DEFAULT_LAWMIDD_PORT } from "./advertise.js";

export type LawminddCliOptions = {
  workspaceDir: string;
  port: number;
  envFile?: string;
  help: boolean;
};

export function parseLawminddArgs(
  argv: string[],
  cwd = process.cwd(),
  env: NodeJS.ProcessEnv = process.env,
): LawminddCliOptions {
  const envWorkspace = env.LAWMIND_WORKSPACE_DIR?.trim();
  const envPort = env.LAWMIND_DESKTOP_PORT?.trim();
  const opts: LawminddCliOptions = {
    workspaceDir: path.resolve(cwd, envWorkspace || "workspace"),
    port: envPort ? Number(envPort) : DEFAULT_LAWMIDD_PORT,
    envFile: env.LAWMIND_ENV_FILE?.trim() || undefined,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      opts.help = true;
    } else if ((arg === "--workspace" || arg === "-w") && argv[i + 1]) {
      opts.workspaceDir = path.resolve(cwd, argv[i + 1]);
      i += 1;
    } else if ((arg === "--port" || arg === "-p") && argv[i + 1]) {
      opts.port = Number(argv[i + 1]);
      i += 1;
    } else if ((arg === "--env-file" || arg === "--env") && argv[i + 1]) {
      opts.envFile = path.resolve(cwd, argv[i + 1]);
      i += 1;
    } else if (arg === "--") {
      continue;
    } else if (arg.startsWith("-")) {
      throw new Error(`unknown_flag:${arg}`);
    }
  }
  if (!Number.isFinite(opts.port) || opts.port < 1 || opts.port > 65535) {
    throw new Error("invalid_port");
  }
  return opts;
}

export function lawminddHelpText(): string {
  return [
    "lawmindd — 本机 LawMind HTTP（与桌面同一套 API，默认 127.0.0.1:4312）",
    "",
    "Usage:",
    "  pnpm lawmind:daemon -- [--port 4312] [--workspace ./workspace] [--env-file .env.lawmind]",
    "",
    "Word / WPS 侧载 manifest 指向 http://127.0.0.1:4312/sidecar/word/taskpane.html",
    "请与桌面使用同一工作区，选区才会出现在对话条上。",
  ].join("\n");
}
