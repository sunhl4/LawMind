import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildMinimalChildEnv,
  buildSandboxChildEnv,
  runSafeCommand,
  safeCommand,
  SafeCommandError,
} from "./safe-command.js";

function parseJsonDetail(raw: unknown): Record<string, unknown> {
  const text = typeof raw === "string" ? raw : JSON.stringify(raw ?? {});
  return JSON.parse(text) as Record<string, unknown>;
}

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "lm-safe-cmd-"));
}

function writeScript(dir: string, name: string, body: string): string {
  const file = path.join(dir, name);
  fs.writeFileSync(file, body, "utf8");
  fs.chmodSync(file, 0o755);
  return file;
}

describe("safe-command", () => {
  it("rejects shell commands and code-execution args", async () => {
    expect(() =>
      safeCommand({
        command: "bash",
        args: ["-c", "echo pwned"],
        timeoutMs: 1000,
      }),
    ).toThrow(SafeCommandError);
    expect(() =>
      safeCommand({
        command: "sh",
        args: ["-c", "echo pwned"],
        timeoutMs: 1000,
      }),
    ).toThrow(SafeCommandError);
    // 直接运行 node -e 也会被当作可执行代码开关拒绝，防止参数注入绕过白名单。
    expect(() =>
      safeCommand({
        command: process.execPath,
        args: ["-e", "console.log(1)"],
        timeoutMs: 1000,
      }),
    ).toThrow(SafeCommandError);
  });

  it("rejects cwd outside allowed roots", async () => {
    const root = tmpDir();
    try {
      expect(() =>
        safeCommand({
          command: process.execPath,
          args: ["--version"],
          cwd: "/tmp",
          allowedRoots: [root],
          timeoutMs: 1000,
        }),
      ).toThrow(/cwd 超出允许目录/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("resolves relative command under cwd and runs it", async () => {
    const root = tmpDir();
    writeScript(root, "hello.sh", "#!/bin/sh\necho hello");
    try {
      const result = await runSafeCommand({
        command: "./hello.sh",
        args: [],
        cwd: root,
        allowedRoots: [root],
        timeoutMs: 5000,
      });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("hello");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("times out and kills hanging commands", async () => {
    const root = tmpDir();
    writeScript(root, "hang.js", "setTimeout(() => {}, 10000);");
    try {
      const result = await runSafeCommand({
        command: process.execPath,
        args: [path.join(root, "hang.js")],
        timeoutMs: 100,
      });
      expect(result.exitCode).toBeNull();
      expect(result.exitSignal).toBeTruthy();
      expect(result.durationMs).toBeLessThan(2000);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("does not leak model secrets into child env", async () => {
    const prev = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "should-not-leak";
    try {
      const env = buildMinimalChildEnv({ LAWMIND_MCP_SECRET: "only-this" });
      expect(env.OPENAI_API_KEY).toBeUndefined();
      expect(env.LAWMIND_MCP_SECRET).toBe("only-this");
      expect(env.PATH).toBeTruthy();
    } finally {
      if (prev === undefined) {
        delete process.env.OPENAI_API_KEY;
      } else {
        process.env.OPENAI_API_KEY = prev;
      }
    }
  });

  it("sandbox child env allows LAWMIND_ config but not secrets", async () => {
    const source = {
      LAWMIND_FOO: "ok",
      LAWMIND_FOO_SECRET: "hidden",
      LAWMIND_BAR_KEY: "hidden-too",
      PATH: "/usr/bin",
    };
    const env = buildSandboxChildEnv(source as unknown as NodeJS.ProcessEnv);
    expect(env.LAWMIND_FOO).toBe("ok");
    expect(env.LAWMIND_FOO_SECRET).toBeUndefined();
    expect(env.LAWMIND_BAR_KEY).toBeUndefined();
    expect(env.PATH).toBe("/usr/bin");
  });

  it("writes safe_command audit on exit", async () => {
    const auditDir = tmpDir();
    const root = tmpDir();
    writeScript(root, "exit2.js", "console.error('err-line'); process.exit(2);");
    try {
      await runSafeCommand({
        command: process.execPath,
        args: [path.join(root, "exit2.js")],
        auditDir,
        taskId: "safe-task",
        actor: "system",
        timeoutMs: 2000,
      });
      const today = new Date().toISOString().slice(0, 10);
      const logPath = path.join(auditDir, `${today}.jsonl`);
      const lines = fs.readFileSync(logPath, "utf8").split("\n").filter(Boolean);
      expect(lines).toHaveLength(1);
      const event = JSON.parse(lines[0]) as Record<string, unknown>;
      expect(event.kind).toBe("safe_command");
      expect(event.taskId).toBe("safe-task");
      expect(event.actor).toBe("system");
      const detail = parseJsonDetail(event.detail);
      expect(detail.exitCode).toBe(2);
      expect(detail).toHaveProperty("command");
      expect(detail).toHaveProperty("cwd");
      expect(detail).toHaveProperty("durationMs");
      expect(String(detail.stderr)).toContain("err-line");
      // 审计只保留 stderr 前 200 字符，且命令摘要不应包含环境变量或完整路径。
      expect(String(event.detail)).not.toContain("hidden");
    } finally {
      fs.rmSync(auditDir, { recursive: true, force: true });
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
