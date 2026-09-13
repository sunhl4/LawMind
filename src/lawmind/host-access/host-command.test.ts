import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildHostAccessRuntime } from "./access-broker.js";
import { authorizeHostCommand } from "./host-command.js";

describe("authorizeHostCommand", () => {
  it("refuses commands when the policy switch is off", () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "lm-cmd-ws-"));
    try {
      const runtime = buildHostAccessRuntime({
        workspaceDir: workspace,
        sessionId: "s1",
        hostMounts: [],
        hostAccessFile: path.join(workspace, "host-access.json"),
        homeDir: workspace,
      });
      const result = authorizeHostCommand(runtime, { command: "git", args: ["status"] });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain("未打开本机命令");
      }
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true });
    }
  });

  it("forbids shells and curl", () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "lm-cmd-ws-"));
    try {
      const runtime = buildHostAccessRuntime({
        workspaceDir: workspace,
        sessionId: "s1",
        hostMounts: [],
        hostAccessFile: path.join(workspace, "host-access.json"),
        homeDir: workspace,
      });
      runtime.policy.allowHostCommands = true;
      for (const command of ["bash", "sudo", "curl"]) {
        const result = authorizeHostCommand(runtime, { command });
        expect(result.ok).toBe(false);
      }
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true });
    }
  });

  it("requires approval for git even when workspace level is on", () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "lm-cmd-ws-"));
    try {
      const runtime = buildHostAccessRuntime({
        workspaceDir: workspace,
        sessionId: "s1",
        hostMounts: [],
        hostAccessFile: path.join(workspace, "host-access.json"),
        homeDir: workspace,
      });
      runtime.policy.allowHostCommands = true;
      runtime.policy.hostCommandLevel = "workspace";
      const pending = authorizeHostCommand(runtime, { command: "git", args: ["status"] });
      expect(pending.ok).toBe(false);
      if (!pending.ok) {
        expect(pending.needsApproval).toBe(true);
      }
      const approved = authorizeHostCommand(
        runtime,
        { command: "git", args: ["status"] },
        { approved: true },
      );
      if (approved.ok) {
        expect("command" in approved).toBe(true);
      } else {
        expect(approved.error).toContain("找不到命令");
      }
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true });
    }
  });

  it("session binaries stay blocked until the session allow flag is on", () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "lm-cmd-ws-"));
    try {
      const runtime = buildHostAccessRuntime({
        workspaceDir: workspace,
        sessionId: "s1",
        hostMounts: [],
        hostAccessFile: path.join(workspace, "host-access.json"),
        homeDir: workspace,
      });
      runtime.policy.allowHostCommands = true;
      runtime.policy.hostCommandLevel = "session";
      runtime.policy.allowSessionCommands = true;
      runtime.sessionCommandAllowed = false;
      const pending = authorizeHostCommand(runtime, { command: "rg", args: ["foo"] });
      expect(pending.ok).toBe(false);
      if (!pending.ok) {
        expect(pending.needsApproval).toBe(true);
        expect(pending.level).toBe("session");
      }
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true });
    }
  });

  it("resolves bundled officecli without requiring PATH", () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "lm-cmd-ws-"));
    const bin = path.join(workspace, "officecli");
    fs.writeFileSync(bin, "");
    const prev = process.env.LAWMIND_OFFICECLI;
    process.env.LAWMIND_OFFICECLI = bin;
    try {
      const runtime = buildHostAccessRuntime({
        workspaceDir: workspace,
        sessionId: "s1",
        hostMounts: [],
        hostAccessFile: path.join(workspace, "host-access.json"),
        homeDir: workspace,
      });
      runtime.policy.allowHostCommands = true;
      runtime.policy.hostCommandLevel = "office";
      const result = authorizeHostCommand(runtime, { command: "officecli", args: [] });
      expect(result.ok).toBe(true);
      if (result.ok && "command" in result) {
        expect(result.command).toBe(bin);
      }
    } finally {
      if (prev === undefined) {
        delete process.env.LAWMIND_OFFICECLI;
      } else {
        process.env.LAWMIND_OFFICECLI = prev;
      }
      fs.rmSync(workspace, { recursive: true, force: true });
    }
  });
});
