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
  console.log("[Acceptance] Step 1/5: tests");
  run("npx", ["vitest", "run", "src/lawmind/"]);

  console.log("[Acceptance] Step 2/5: env check");
  const envArgs = ["run", "lawmind:env:check"];
  if (opts.strictEnv) {
    envArgs.push("--", "--strict");
  }
  run("npm", envArgs);

  console.log("[Acceptance] Step 3/5: smoke");
  const smokeArgs = ["run", "lawmind:smoke"];
  if (opts.strictEnv) {
    smokeArgs.push("--", "--fail-on-empty-claims");
  }
  run("npm", smokeArgs);

  console.log("[Acceptance] Step 4/5: demo");
  run("npm", ["run", "lawmind:demo"]);

  console.log("[Acceptance] Step 5/5: ops status");
  run("npm", ["run", "lawmind:ops", "--", "status"]);

  console.log("\n✅ LawMind acceptance completed.");
}

main().catch((err) => {
  console.error("[Acceptance] failed:", err);
  process.exitCode = 1;
});
