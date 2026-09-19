import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildHostAccessRuntime, resolveHostPath } from "./access-broker.js";
import { writeHostAccessFile } from "./host-store.js";
import type { HostMount } from "./types.js";

const temps: string[] = [];

function tmpDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  temps.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of temps.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function mount(absPath: string, extra?: Partial<HostMount>): HostMount {
  return {
    id: extra?.id ?? "m1",
    absPath,
    addedAt: "2026-09-12T00:00:00.000Z",
    ...extra,
  };
}

describe("resolveHostPath", () => {
  it("allows workspace read/write and rejects escape", () => {
    const workspace = tmpDir("lm-host-ws-");
    fs.writeFileSync(path.join(workspace, "a.md"), "hi");
    const runtime = buildHostAccessRuntime({
      workspaceDir: workspace,
      sessionId: "s1",
      hostMounts: [],
      hostAccessFile: path.join(workspace, "host-access.json"),
      homeDir: tmpDir("lm-host-home-"),
    });
    const ok = resolveHostPath(runtime, path.join(workspace, "a.md"));
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.rootKind).toBe("workspace");
      expect(ok.writable).toBe(true);
    }
    const escape = resolveHostPath(runtime, path.join(os.tmpdir(), "nope.txt"));
    expect(escape.ok).toBe(false);
    if (!escape.ok) {
      expect(escape.error).toBe("escape");
    }
  });

  it("reads mounts and forbids mount writes", () => {
    const workspace = tmpDir("lm-host-ws-");
    const paper = tmpDir("lm-host-paper-");
    fs.writeFileSync(path.join(paper, "PdZn.md"), "body");
    const runtime = buildHostAccessRuntime({
      workspaceDir: workspace,
      sessionId: "s1",
      hostMounts: [mount(paper)],
      hostAccessFile: path.join(workspace, "host-access.json"),
      homeDir: tmpDir("lm-host-home-"),
    });
    const ok = resolveHostPath(runtime, path.join(paper, "PdZn.md"));
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.rootKind).toBe("mount");
      expect(ok.writable).toBe(false);
    }
    const write = resolveHostPath(runtime, path.join(paper, "PdZn.md"), { write: true });
    expect(write.ok).toBe(false);
    if (!write.ok) {
      expect(write.error).toBe("write_forbidden");
    }
  });

  it("resolves a relative path under the mounted folder, not the process cwd", () => {
    const workspace = tmpDir("lm-host-ws-");
    const desktop = tmpDir("lm-host-desktop-");
    const folder = path.join(desktop, "诉讼", "刘学江侵权纠纷");
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(path.join(folder, "起诉状.txt"), "诉请");
    const runtime = buildHostAccessRuntime({
      workspaceDir: workspace,
      sessionId: "s1",
      hostMounts: [mount(desktop)],
      hostAccessFile: path.join(workspace, "host-access.json"),
      homeDir: tmpDir("lm-host-home-"),
    });
    const ok = resolveHostPath(runtime, "诉讼/刘学江侵权纠纷");
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.abs).toBe(fs.realpathSync(folder));
      expect(ok.rootKind).toBe("mount");
    }
    const missing = resolveHostPath(runtime, "诉讼/不存在");
    expect(missing.ok).toBe(false);
    if (!missing.ok) {
      expect(missing.error).toBe("not_found");
    }
  });

  it("migrates projectDir to the first mount", () => {
    const workspace = tmpDir("lm-host-ws-");
    const project = tmpDir("lm-host-proj-");
    const store = path.join(workspace, "host-access.json");
    writeHostAccessFile({ schemaVersion: 1, mounts: [], persistentGrants: [] }, store);
    const runtime = buildHostAccessRuntime({
      workspaceDir: workspace,
      sessionId: "s1",
      projectDir: project,
      hostAccessFile: store,
      homeDir: tmpDir("lm-host-home-"),
    });
    expect(runtime.mounts[0]?.absPath).toBe(path.resolve(project));
    fs.writeFileSync(path.join(project, "x.txt"), "x");
    expect(resolveHostPath(runtime, path.join(project, "x.txt")).ok).toBe(true);
  });

  it("denies ~/.ssh even with a grant", () => {
    const workspace = tmpDir("lm-host-ws-");
    const home = tmpDir("lm-host-home-");
    const ssh = path.join(home, ".ssh");
    fs.mkdirSync(ssh);
    const key = path.join(ssh, "id_ed25519");
    fs.writeFileSync(key, "SECRET");
    const runtime = buildHostAccessRuntime({
      workspaceDir: workspace,
      sessionId: "s1",
      hostMounts: [mount(home)],
      hostGrants: [
        {
          id: "g1",
          absPath: key,
          kind: "read",
          duration: "always",
          addedAt: "2026-09-12T00:00:00.000Z",
        },
      ],
      hostAccessFile: path.join(workspace, "host-access.json"),
      homeDir: home,
    });
    const denied = resolveHostPath(runtime, key);
    expect(denied.ok).toBe(false);
    if (!denied.ok) {
      expect(denied.error).toBe("deny_list");
    }
  });

  it("denies .env on a desktop mount", () => {
    const workspace = tmpDir("lm-host-ws-");
    const desktop = tmpDir("lm-host-desk-");
    const envFile = path.join(desktop, ".env");
    fs.writeFileSync(envFile, "KEY=1");
    const runtime = buildHostAccessRuntime({
      workspaceDir: workspace,
      sessionId: "s1",
      hostMounts: [mount(desktop)],
      hostAccessFile: path.join(workspace, "host-access.json"),
      homeDir: tmpDir("lm-host-home-"),
    });
    const denied = resolveHostPath(runtime, envFile);
    expect(denied.ok).toBe(false);
    if (!denied.ok) {
      expect(denied.error).toBe("deny_list");
    }
  });

  it("blocks symlink escape into a denied file", () => {
    const workspace = tmpDir("lm-host-ws-");
    const home = tmpDir("lm-host-home-");
    const ssh = path.join(home, ".ssh");
    fs.mkdirSync(ssh);
    const key = path.join(ssh, "id_rsa");
    fs.writeFileSync(key, "SECRET");
    const paper = tmpDir("lm-host-paper-");
    const link = path.join(paper, "notes.md");
    fs.symlinkSync(key, link);
    const runtime = buildHostAccessRuntime({
      workspaceDir: workspace,
      sessionId: "s1",
      hostMounts: [mount(paper)],
      hostAccessFile: path.join(workspace, "host-access.json"),
      homeDir: home,
    });
    const denied = resolveHostPath(runtime, link);
    expect(denied.ok).toBe(false);
    if (!denied.ok) {
      expect(denied.error).toBe("deny_list");
    }
  });

  it("rejects a mount bound to another matter", () => {
    const workspace = tmpDir("lm-host-ws-");
    fs.mkdirSync(path.join(workspace, "cases", "matter-a"), { recursive: true });
    fs.mkdirSync(path.join(workspace, "cases", "matter-b"), { recursive: true });
    const other = tmpDir("lm-host-other-");
    fs.writeFileSync(path.join(other, "secret-client.md"), "other");
    const runtime = buildHostAccessRuntime({
      workspaceDir: workspace,
      sessionId: "s1",
      matterId: "matter-a",
      hostMounts: [mount(other, { id: "b", matterId: "matter-b" })],
      hostAccessFile: path.join(workspace, "host-access.json"),
      homeDir: tmpDir("lm-host-home-"),
    });
    const denied = resolveHostPath(runtime, path.join(other, "secret-client.md"));
    expect(denied.ok).toBe(false);
    if (!denied.ok) {
      expect(denied.error).toBe("cross_matter_denied");
    }
  });

  it("applies the ethical wall when opposing parties share a session", () => {
    const workspace = tmpDir("lm-host-ws-");
    fs.mkdirSync(path.join(workspace, "cases", "m-a"), { recursive: true });
    fs.mkdirSync(path.join(workspace, "cases", "m-b"), { recursive: true });
    fs.writeFileSync(
      path.join(workspace, "cases", "m-a", "CASE.md"),
      "## 1. 基本信息\n\n- 客户 / clientId: 甲公司\n- 对方当事人: 乙公司\n\n## 2. 其他\n",
    );
    fs.writeFileSync(
      path.join(workspace, "cases", "m-b", "CASE.md"),
      "## 1. 基本信息\n\n- 客户 / clientId: 乙公司\n- 对方当事人: 甲公司\n\n## 2. 其他\n",
    );
    const folderB = tmpDir("lm-host-b-");
    fs.writeFileSync(path.join(folderB, "b.md"), "b");
    const runtime = buildHostAccessRuntime({
      workspaceDir: workspace,
      sessionId: "s1",
      matterId: "m-a",
      hostMounts: [mount(folderB, { id: "mb", matterId: "m-b" })],
      hostAccessFile: path.join(workspace, "host-access.json"),
      homeDir: tmpDir("lm-host-home-"),
    });
    runtime.policy.allowCrossMatterMounts = true;
    const denied = resolveHostPath(runtime, path.join(folderB, "b.md"));
    expect(denied.ok).toBe(false);
    if (!denied.ok) {
      expect(denied.error).toBe("ethical_wall");
    }
  });

  it("returns needs_grant in locate mode for an outside path", () => {
    const workspace = tmpDir("lm-host-ws-");
    const outside = tmpDir("lm-host-out-");
    const file = path.join(outside, "paper.pdf");
    fs.writeFileSync(file, "pdf");
    const runtime = buildHostAccessRuntime({
      workspaceDir: workspace,
      sessionId: "s1",
      hostMounts: [],
      hostAccessFile: path.join(workspace, "host-access.json"),
      homeDir: tmpDir("lm-host-home-"),
    });
    runtime.policy.mode = "locate";
    const result = resolveHostPath(runtime, file, { allowLocateHint: true });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("needs_grant");
      expect(result.message).toContain("paper.pdf");
    }
  });
});
