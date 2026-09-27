import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildHostAccessRuntime } from "./access-broker.js";
import { authorizeHostCommand } from "./host-command.js";

describe("authorizeHostCommand", () => {
  it("asks for approval instead of sending the lawyer to a settings switch", () => {
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
      if (!result.ok) {
        expect(result.needsApproval).toBeUndefined();
        expect(result.error).toContain("找不到命令");
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
      if (!pending.ok) {
        expect(pending.needsApproval).toBeUndefined();
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

  it("runs a non-office binary without a session confirmation", () => {
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
      if (!pending.ok) {
        expect(pending.needsApproval).toBeUndefined();
        expect(pending.error).toContain("找不到命令");
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

  /** officecli 能改写文件，因此它的参数与 cwd 不允许落到只读的挂载点上。 */
  function runtimeWithMount(workspace: string, mount: string) {
    const runtime = buildHostAccessRuntime({
      workspaceDir: workspace,
      sessionId: "s1",
      hostMounts: [
        { id: "m1", absPath: mount, label: "本机文件夹", addedAt: new Date().toISOString() },
      ],
      hostAccessFile: path.join(workspace, "host-access.json"),
      homeDir: workspace,
    });
    runtime.policy.allowHostCommands = true;
    runtime.policy.hostCommandLevel = "office";
    return runtime;
  }

  it("denies write-capable commands targeting a read-only mount", () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "lm-cmd-ws-"));
    const mount = fs.mkdtempSync(path.join(os.tmpdir(), "lm-cmd-mount-"));
    const bin = path.join(workspace, "officecli");
    fs.writeFileSync(bin, "");
    const prev = process.env.LAWMIND_OFFICECLI;
    process.env.LAWMIND_OFFICECLI = bin;
    try {
      const runtime = runtimeWithMount(workspace, mount);
      // 参数只用文件系统路径：officecli 的 `/body` 选择器另有单独的过滤逻辑
      // （见下方 read-only 用例与评审结论），不属于本用例要覆盖的根规则。
      const denied = authorizeHostCommand(runtime, {
        command: "officecli",
        args: ["set", path.join(mount, "合同.docx")],
      });
      expect(denied.ok).toBe(false);
      if (!denied.ok) {
        expect(denied.error).toContain("参数路径不在已授权目录内");
      }

      // 同一台机器上，工作区内的同类调用仍然放行。
      const allowed = authorizeHostCommand(runtime, {
        command: "officecli",
        args: ["set", path.join(workspace, "artifacts", "草稿.docx")],
      });
      expect(allowed.ok).toBe(true);
    } finally {
      if (prev === undefined) {
        delete process.env.LAWMIND_OFFICECLI;
      } else {
        process.env.LAWMIND_OFFICECLI = prev;
      }
      fs.rmSync(workspace, { recursive: true, force: true });
      fs.rmSync(mount, { recursive: true, force: true });
    }
  });

  it("forces write-capable cwd back into the workspace so relative args cannot reach a mount", () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "lm-cmd-ws-"));
    const mount = fs.mkdtempSync(path.join(os.tmpdir(), "lm-cmd-mount-"));
    const bin = path.join(workspace, "officecli");
    fs.writeFileSync(bin, "");
    const prev = process.env.LAWMIND_OFFICECLI;
    process.env.LAWMIND_OFFICECLI = bin;
    try {
      const runtime = runtimeWithMount(workspace, mount);
      const result = authorizeHostCommand(runtime, {
        command: "officecli",
        args: ["set", "相对路径.docx"],
        cwd: mount,
      });
      expect(result.ok).toBe(true);
      if (result.ok && "cwd" in result) {
        expect(result.cwd).toBe(path.resolve(workspace));
      }
    } finally {
      if (prev === undefined) {
        delete process.env.LAWMIND_OFFICECLI;
      } else {
        process.env.LAWMIND_OFFICECLI = prev;
      }
      fs.rmSync(workspace, { recursive: true, force: true });
      fs.rmSync(mount, { recursive: true, force: true });
    }
  });

  it("keeps read-only commands able to reach mounts", () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "lm-cmd-ws-"));
    const mount = fs.mkdtempSync(path.join(os.tmpdir(), "lm-cmd-mount-"));
    fs.writeFileSync(path.join(workspace, "mdfind"), "");
    const prev = process.env.PATH;
    process.env.PATH = workspace;
    try {
      const runtime = runtimeWithMount(workspace, mount);
      const result = authorizeHostCommand(runtime, {
        command: "mdfind",
        args: ["-onlyin", mount, "合同"],
      });
      // 这条同时证明挂载点确实进了 roots —— 否则上一个用例会「因为挂载点不在
      // roots 里」而假通过。
      expect(result.ok).toBe(true);
    } finally {
      if (prev === undefined) {
        delete process.env.PATH;
      } else {
        process.env.PATH = prev;
      }
      fs.rmSync(workspace, { recursive: true, force: true });
      fs.rmSync(mount, { recursive: true, force: true });
    }
  });

  /**
   * officecli 的第二个位置参数是文档选择器，不是文件系统路径。
   * 不区分的话，`--find/--replace` 编辑（必然带 `/body` 或 `/`）会被全部误拒。
   */
  it("treats officecli document selectors as scope, not as filesystem paths", () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "lm-cmd-ws-"));
    const bin = path.join(workspace, "officecli");
    fs.writeFileSync(bin, "");
    const prev = process.env.LAWMIND_OFFICECLI;
    process.env.LAWMIND_OFFICECLI = bin;
    try {
      const runtime = runtimeWithMount(workspace, workspace);
      const selectors = [
        "/", // 整篇文档
        "/body",
        "/body/p[3]",
        "/body/tbl[1]/tr[2]",
        "/header[1]",
        "/footer[1]",
        "/comments/comment[@commentId=1]",
        "/sheet[1]",
        "/Sheet1",
        "/styles",
      ];
      for (const selector of selectors) {
        const result = authorizeHostCommand(runtime, {
          command: "officecli",
          args: [
            "set",
            path.join(workspace, "草稿.docx"),
            selector,
            "--find",
            "a",
            "--replace",
            "b",
          ],
        });
        expect(result.ok, `选择器被误判为路径：${selector}`).toBe(true);
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

  it("still rejects non-selector absolute paths for officecli", () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "lm-cmd-ws-"));
    const bin = path.join(workspace, "officecli");
    fs.writeFileSync(bin, "");
    const prev = process.env.LAWMIND_OFFICECLI;
    process.env.LAWMIND_OFFICECLI = bin;
    try {
      const runtime = runtimeWithMount(workspace, workspace);
      // 这些看起来像绝对路径，但不是 OOXML 部件选择器，必须继续按路径校验。
      for (const arg of ["/etc/passwd", "/bodyguard/x", "/tmp/out.docx"]) {
        const result = authorizeHostCommand(runtime, {
          command: "officecli",
          args: ["set", path.join(workspace, "草稿.docx"), arg],
        });
        expect(result.ok, `越界路径被放行：${arg}`).toBe(false);
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

  it("does not grant the selector exemption to non-officecli commands", () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "lm-cmd-ws-"));
    fs.writeFileSync(path.join(workspace, "mdfind"), "");
    const prev = process.env.PATH;
    process.env.PATH = workspace;
    try {
      const runtime = runtimeWithMount(workspace, workspace);
      const result = authorizeHostCommand(runtime, { command: "mdfind", args: ["/body"] });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain("参数路径不在已授权目录内");
      }
    } finally {
      if (prev === undefined) {
        delete process.env.PATH;
      } else {
        process.env.PATH = prev;
      }
      fs.rmSync(workspace, { recursive: true, force: true });
    }
  });
});
