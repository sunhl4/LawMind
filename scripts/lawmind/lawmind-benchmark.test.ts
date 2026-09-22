import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const dirs: string[] = [];

afterEach(() => {
  for (const d of dirs.splice(0)) {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

function tmpDir(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "lm-benchmark-cli-"));
  dirs.push(d);
  return d;
}

function run(
  args: string[],
  env?: NodeJS.ProcessEnv,
): { status: number | null; stdout: string; stderr: string } {
  const ws = tmpDir();
  const out = path.join(ws, "benchmark.json");
  const result = spawnSync(
    "node",
    [
      "--import",
      "tsx",
      "scripts/lawmind/lawmind-benchmark.ts",
      ...args,
      "--workspace",
      ws,
      "--out",
      out,
    ],
    {
      cwd: process.cwd(),
      env: {
        PATH: process.env.PATH,
        LAWMIND_BENCHMARK_STRICT: "0",
        LAWMIND_BENCHMARK_REAL_MODEL: "0",
        ...env,
      },
      encoding: "utf8",
      timeout: 60_000,
    },
  );
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

describe("lawmind-benchmark CLI mode dispatch", () => {
  it("rejects an invalid mode", () => {
    const { status, stderr } = run(["--mode", "invalid"]);
    expect(status).toBe(1);
    expect(stderr).toContain("invalid mode");
  });

  it("runs mock mode by default and tags output", () => {
    const ws = tmpDir();
    const out = path.join(ws, "benchmark.json");
    const { status, stdout } = run([]);
    expect(status).toBe(0);
    expect(stdout).toContain("mode=mock");
    const payload = JSON.parse(fs.readFileSync(out, "utf8")) as {
      modelMode: string;
      results: unknown[];
    };
    expect(payload.modelMode).toBe("mock");
    expect(payload.results.length).toBeGreaterThan(0);
  });

  it("real mode requires an explicit opt-in gate", () => {
    const { status, stderr } = run(["--mode", "real"]);
    expect(status).toBe(1);
    expect(stderr).toContain("explicit opt-in");
  });

  it("real mode still requires real adapters even with --with-real-model", () => {
    const { status, stderr } = run(["--mode", "real", "--with-real-model"]);
    expect(status).toBe(1);
    expect(stderr).toContain("real model adapters");
  });
});
