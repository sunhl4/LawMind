import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { listSessions } from "../src/lawmind/agent/session.js";
import { listMatterIds } from "../src/lawmind/cases/index.js";
import { listDrafts } from "../src/lawmind/drafts/index.js";
import { listTaskRecords } from "../src/lawmind/tasks/index.js";

type Command = "status" | "doctor";

function parseArgs(argv: string[]): { command: Command; workspaceDir: string; deep: boolean } {
  const command = (argv[0] as Command | undefined) ?? "status";
  let workspaceDir = path.resolve(process.cwd(), "workspace");
  let deep = false;
  for (let i = 1; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--workspace" && argv[i + 1]) {
      workspaceDir = path.resolve(process.cwd(), argv[i + 1]);
      i += 1;
    } else if (arg === "--deep") {
      deep = true;
    }
  }
  return { command, workspaceDir, deep };
}

function run(command: string, args: string[]): number {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    stdio: "inherit",
    env: process.env,
    shell: process.platform === "win32",
  });
  return result.status ?? 1;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function status(workspaceDir: string): Promise<void> {
  const tasks = listTaskRecords(workspaceDir);
  const drafts = listDrafts(workspaceDir);
  const matters = await listMatterIds(workspaceDir);
  const sessions = listSessions(workspaceDir);

  const taskByStatus = tasks.reduce<Record<string, number>>((acc, task) => {
    acc[task.status] = (acc[task.status] ?? 0) + 1;
    return acc;
  }, {});

  const draftByStatus = drafts.reduce<Record<string, number>>((acc, draft) => {
    acc[draft.reviewStatus] = (acc[draft.reviewStatus] ?? 0) + 1;
    return acc;
  }, {});

  console.log("LawMind Ops Status");
  console.log("==================");
  console.log(`workspace: ${workspaceDir}`);
  console.log(`matters: ${matters.length}`);
  console.log(`tasks: ${tasks.length}`);
  console.log(`drafts: ${drafts.length}`);
  console.log(`sessions: ${sessions.length}`);
  console.log("");
  console.log("Task status:");
  for (const [statusName, count] of Object.entries(taskByStatus)) {
    console.log(`  - ${statusName}: ${count}`);
  }
  console.log("Draft review status:");
  for (const [statusName, count] of Object.entries(draftByStatus)) {
    console.log(`  - ${statusName}: ${count}`);
  }
}

async function doctor(workspaceDir: string, deep: boolean): Promise<number> {
  console.log("LawMind Ops Doctor");
  console.log("==================");
  console.log(`workspace: ${workspaceDir}`);
  console.log(`mode: ${deep ? "deep" : "standard"}`);
  console.log("");

  const checks: Array<{ name: string; ok: boolean; detail?: string }> = [];

  checks.push({
    name: "workspace directory",
    ok: await fileExists(workspaceDir),
  });
  checks.push({
    name: "MEMORY.md",
    ok: await fileExists(path.join(workspaceDir, "MEMORY.md")),
  });
  checks.push({
    name: "LAWYER_PROFILE.md",
    ok: await fileExists(path.join(workspaceDir, "LAWYER_PROFILE.md")),
  });
  checks.push({
    name: ".env.lawmind",
    ok: await fileExists(path.join(process.cwd(), ".env.lawmind")),
  });

  for (const check of checks) {
    console.log(
      `${check.ok ? "✅" : "❌"} ${check.name}${check.detail ? ` - ${check.detail}` : ""}`,
    );
  }

  let exitCode = checks.every((item) => item.ok) ? 0 : 1;
  console.log("");
  console.log("Running environment strict check...");
  const envStatus = run("npm", ["run", "lawmind:env:check", "--", "--strict"]);
  if (envStatus !== 0) {
    exitCode = 1;
  }

  if (deep) {
    console.log("");
    console.log("Running smoke check...");
    const smokeStatus = run("npm", ["run", "lawmind:smoke", "--", "--fail-on-empty-claims"]);
    if (smokeStatus !== 0) {
      exitCode = 1;
    }
  }

  console.log("");
  console.log(exitCode === 0 ? "✅ doctor passed" : "❌ doctor failed");
  return exitCode;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.command === "status") {
    await status(opts.workspaceDir);
    return;
  }
  const exitCode = await doctor(opts.workspaceDir, opts.deep);
  process.exitCode = exitCode;
}

main().catch((err) => {
  console.error("[LawMind] ops failed:", err);
  process.exitCode = 1;
});
