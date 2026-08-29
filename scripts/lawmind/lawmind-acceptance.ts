import { spawnSync } from "node:child_process";

type Options = {
  strictEnv: boolean;
};

function parseArgs(argv: string[]): Options {
  return {
    strictEnv: argv.includes("--strict-env"),
  };
}

function run(command: string, args: string[]): void {
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

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  console.log("[Acceptance] Step 1/8: tests");
  run("pnpm", ["exec", "vitest", "run", "src/lawmind"]);

  console.log("[Acceptance] Step 2/8: env check");
  const envArgs = ["run", "lawmind:env:check"];
  if (opts.strictEnv) {
    envArgs.push("--", "--strict");
  }
  run("pnpm", envArgs);

  console.log("[Acceptance] Step 3/8: smoke");
  const smokeArgs = ["run", "lawmind:smoke"];
  if (opts.strictEnv) {
    smokeArgs.push("--", "--fail-on-empty-claims");
  }
  run("pnpm", smokeArgs);

  console.log("[Acceptance] Step 4/8: demo");
  run("pnpm", ["run", "lawmind:demo"]);

  console.log("[Acceptance] Step 5/8: quarterly demo (W3+W4+W5+W7+W9 端到端)");
  run("pnpm", ["run", "lawmind:quarterly-demo"]);

  console.log("[Acceptance] Step 6/8: benchmark");
  run("pnpm", ["run", "lawmind:benchmark", "--", "--out", "dist/lawmind-benchmark.json"]);

  console.log("[Acceptance] Step 7/8: release readiness report");
  run("pnpm", [
    "run",
    "lawmind:release-readiness",
    "--",
    "--out",
    "dist/lawmind-release-readiness.md",
  ]);

  console.log("[Acceptance] Step 8/8: ops status");
  run("pnpm", ["run", "lawmind:ops", "--", "status"]);

  console.log("\n✅ LawMind acceptance completed.");
}

main().catch((err) => {
  console.error("[Acceptance] failed:", err);
  process.exitCode = 1;
});
