/**
 * CLI for the local automations daemon (lawmindd).
 * Usage: pnpm lawmind:daemon -- start|stop|status [--workspace <dir>]
 */

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildDaemonProcessEnv,
  getDaemonStatus,
  setDaemonEnabled,
  stopDaemonProcess,
} from "../../src/lawmind/platform/lawmind-daemon.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function parseArgs(argv: string[]): { command: string; workspaceDir: string } {
  let workspaceDir =
    process.env.LAWMIND_WORKSPACE_DIR?.trim() || path.resolve(process.cwd(), "workspace");
  const positionals: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if ((arg === "--workspace" || arg === "-w") && argv[i + 1]) {
      workspaceDir = path.resolve(argv[i + 1] ?? workspaceDir);
      i += 1;
    } else if (!arg.startsWith("-")) {
      positionals.push(arg);
    }
  }
  return { command: positionals[0] ?? "status", workspaceDir };
}

function spawnDaemon(workspaceDir: string): void {
  const serverScript = path.join(
    repoRoot,
    "apps",
    "lawmind-desktop",
    "server",
    "lawmind-local-server.ts",
  );
  const child = spawn(process.execPath, ["--import", "tsx", serverScript], {
    detached: true,
    stdio: "ignore",
    cwd: repoRoot,
    env: buildDaemonProcessEnv(process.env, {
      LAWMIND_WORKSPACE_DIR: workspaceDir,
      LAWMIND_REPO_ROOT: repoRoot,
    }),
  });
  child.unref();
}

function main(): void {
  const { command, workspaceDir } = parseArgs(process.argv.slice(2));
  if (command === "start") {
    const current = getDaemonStatus(workspaceDir);
    if (current.running) {
      console.log(JSON.stringify({ ok: true, daemon: current, alreadyRunning: true }));
      return;
    }
    setDaemonEnabled(workspaceDir, true);
    spawnDaemon(workspaceDir);
    console.log(
      JSON.stringify({ ok: true, daemon: { ...getDaemonStatus(workspaceDir), starting: true } }),
    );
    return;
  }
  if (command === "stop") {
    console.log(JSON.stringify({ ok: true, daemon: stopDaemonProcess(workspaceDir) }));
    return;
  }
  if (command === "enable") {
    console.log(JSON.stringify({ ok: true, daemon: setDaemonEnabled(workspaceDir, true) }));
    return;
  }
  if (command === "disable") {
    stopDaemonProcess(workspaceDir);
    console.log(JSON.stringify({ ok: true, daemon: setDaemonEnabled(workspaceDir, false) }));
    return;
  }
  console.log(JSON.stringify({ ok: true, daemon: getDaemonStatus(workspaceDir) }));
}

main();
