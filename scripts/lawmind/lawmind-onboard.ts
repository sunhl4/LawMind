import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

type PresetId =
  | "qwen-only"
  | "qwen-chatlaw"
  | "deepseek-lawgpt"
  | "general-lexedge"
  | "general-partner";

type CliOptions = {
  workspaceDir: string;
  preset?: PresetId;
  yes: boolean;
  skipSmoke: boolean;
  strict: boolean;
};

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = {
    workspaceDir: path.resolve(process.cwd(), "workspace"),
    yes: false,
    skipSmoke: false,
    strict: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--workspace" && argv[i + 1]) {
      opts.workspaceDir = path.resolve(process.cwd(), argv[i + 1]);
      i += 1;
    } else if (arg === "--preset" && argv[i + 1]) {
      opts.preset = argv[i + 1] as PresetId;
      i += 1;
    } else if (arg === "--yes" || arg === "-y") {
      opts.yes = true;
    } else if (arg === "--skip-smoke") {
      opts.skipSmoke = true;
    } else if (arg === "--no-strict") {
      opts.strict = false;
    }
  }
  return opts;
}

function run(command: string, args: string[]) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    stdio: "inherit",
    env: process.env,
    shell: process.platform === "win32",
  });
  if (result.status !== 0) {
    throw new Error(`command failed: ${command} ${args.join(" ")}`);
  }
}

async function ensureWorkspace(workspaceDir: string): Promise<void> {
  await fs.mkdir(workspaceDir, { recursive: true });
  const memoryFile = path.join(workspaceDir, "MEMORY.md");
  const profileFile = path.join(workspaceDir, "LAWYER_PROFILE.md");

  await fs
    .access(memoryFile)
    .catch(() =>
      fs.writeFile(
        memoryFile,
        "# LawMind 通用记忆\n\n- 这里记录长期方法论、风格规则、合规边界。\n",
        "utf8",
      ),
    );

  await fs
    .access(profileFile)
    .catch(() =>
      fs.writeFile(
        profileFile,
        "# 律师个人偏好\n\n- 这里记录语气偏好、常用模板、客户沟通口径。\n",
        "utf8",
      ),
    );
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  await ensureWorkspace(opts.workspaceDir);

  console.log("[LawMind] onboarding start");
  console.log(`workspace=${opts.workspaceDir}`);
  console.log(`strict=${opts.strict ? "on" : "off"}`);

  const setupArgs = ["--import", "tsx", "scripts/lawmind/lawmind-quick-setup.ts"];
  if (opts.preset) {
    setupArgs.push("--preset", opts.preset);
  }
  if (opts.yes) {
    setupArgs.push("--yes");
  }
  run("node", setupArgs);

  const envCheckArgs = ["run", "lawmind:env:check", "--"];
  if (opts.strict) {
    envCheckArgs.push("--strict");
  }
  run("pnpm", envCheckArgs);

  if (!opts.skipSmoke) {
    run("pnpm", ["run", "lawmind:smoke", "--", "--fail-on-empty-claims"]);
  } else {
    console.log("[LawMind] smoke skipped by --skip-smoke");
  }

  console.log("\n[LawMind] onboarding complete");
  console.log("next:");
  console.log("  pnpm lawmind:agent");
  console.log("  pnpm lawmind:ops -- status");
}

main().catch((err) => {
  console.error("[LawMind] onboarding failed:", err);
  process.exitCode = 1;
});
