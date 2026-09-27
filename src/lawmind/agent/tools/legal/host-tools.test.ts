import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { rememberLocateHit } from "../../../host-access/host-store.js";
import type { AgentContext } from "../../types.js";
import { importHostFileTool, readHostFileTool, searchHostTool } from "./host-tools.js";

const temps: string[] = [];

function tmp(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  temps.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of temps.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function ctx(workspaceDir: string, extra?: Partial<AgentContext>): AgentContext {
  return {
    workspaceDir,
    sessionId: "sess-1",
    actorId: "lawyer",
    hostAccessFile: path.join(workspaceDir, "host-access.json"),
    ...extra,
  };
}

describe("host tools", () => {
  it("search_host finds a file in a mounted folder and read_host_file returns body", async () => {
    const workspace = tmp("lm-ht-ws-");
    const paper = tmp("lm-ht-paper-");
    fs.writeFileSync(path.join(paper, "PdZn-notes.md"), "PdZn alloy paper");
    const agent = ctx(workspace, {
      hostMounts: [{ id: "paper", absPath: paper, addedAt: "2026-09-12T00:00:00.000Z" }],
    });
    const found = await searchHostTool.execute({ query: "PdZn" }, agent);
    expect(found.ok).toBe(true);
    const hits = (found.data as { hits: Array<{ displayName: string; absPath?: string }> }).hits;
    expect(hits.some((h) => h.displayName.includes("PdZn"))).toBe(true);

    const read = await readHostFileTool.execute({ path: path.join(paper, "PdZn-notes.md") }, agent);
    expect(read.ok).toBe(true);
    expect((read.data as { content: string }).content).toContain("alloy");
  });

  it("import_host_file copies into the matter and leaves the source intact", async () => {
    const workspace = tmp("lm-ht-ws-");
    const paper = tmp("lm-ht-paper-");
    const src = path.join(paper, "memo.txt");
    fs.writeFileSync(src, "memo-body");
    const agent = ctx(workspace, {
      matterId: "matter-a",
      hostMounts: [{ id: "paper", absPath: paper, addedAt: "2026-09-12T00:00:00.000Z" }],
    });
    const result = await importHostFileTool.execute({ path: src }, agent);
    expect(result.ok).toBe(true);
    const dest = path.join(workspace, "cases", "matter-a", "materials", "memo.txt");
    expect(fs.readFileSync(dest, "utf8")).toBe("memo-body");
    expect(fs.readFileSync(src, "utf8")).toBe("memo-body");
  });

  it("import_host_file copies a folder into a workspace under the LawMind data directory", async () => {
    const appSupport = tmp("lm-ht-app-");
    const workspace = path.join(appSupport, "LawMind", "workspace");
    fs.mkdirSync(workspace, { recursive: true });
    const paper = tmp("lm-ht-folder-");
    const folder = path.join(paper, "刘学江侵权纠纷");
    fs.mkdirSync(path.join(folder, "证据"), { recursive: true });
    fs.writeFileSync(path.join(folder, "起诉状.txt"), "诉请");
    fs.writeFileSync(path.join(folder, "证据", "收据.txt"), "5000");
    fs.writeFileSync(path.join(folder, ".env"), "SECRET=1");
    const agent = ctx(workspace, {
      matterId: "matter-a",
      hostMounts: [{ id: "paper", absPath: paper, addedAt: "2026-09-12T00:00:00.000Z" }],
    });
    const result = await importHostFileTool.execute({ path: folder }, agent);
    expect(result.ok).toBe(true);
    const dest = path.join(workspace, "cases", "matter-a", "materials", "刘学江侵权纠纷");
    expect(fs.readFileSync(path.join(dest, "起诉状.txt"), "utf8")).toBe("诉请");
    expect(fs.readFileSync(path.join(dest, "证据", "收据.txt"), "utf8")).toBe("5000");
    expect(fs.existsSync(path.join(dest, ".env"))).toBe(false);
    expect(fs.readFileSync(path.join(folder, "起诉状.txt"), "utf8")).toBe("诉请");
  });

  it("import_host_file accepts the lawyer's relative path and case display name", async () => {
    const workspace = tmp("lm-ht-name-");
    const desktop = tmp("lm-ht-desk-");
    const folder = path.join(desktop, "诉讼", "刘学江侵权纠纷");
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(path.join(folder, "起诉状.txt"), "诉请");
    fs.mkdirSync(path.join(workspace, "cases", "m-liu"), { recursive: true });
    fs.writeFileSync(
      path.join(workspace, "cases", "m-liu", "CASE.md"),
      "## 1. 基本信息\n\n- 案件名称：刘学江侵权案\n",
      "utf8",
    );
    const agent = ctx(workspace, {
      matterId: "m-liu",
      hostMounts: [{ id: "desk", absPath: desktop, addedAt: "2026-09-12T00:00:00.000Z" }],
    });
    const result = await importHostFileTool.execute(
      { path: "诉讼/刘学江侵权纠纷", matter_id: "刘学江侵权案" },
      agent,
    );
    expect(result.ok).toBe(true);
    expect(
      fs.readFileSync(
        path.join(workspace, "cases", "m-liu", "materials", "刘学江侵权纠纷", "起诉状.txt"),
        "utf8",
      ),
    ).toBe("诉请");
    expect(fs.existsSync(path.join(workspace, "cases", "刘学江侵权案"))).toBe(false);
  });

  it("read_host_file reads a workspace-external plain file directly (默认放开，不再要授权)", async () => {
    const workspace = tmp("lm-ht-ws-");
    const outside = tmp("lm-ht-out-");
    const file = path.join(outside, "solo.pdf");
    fs.writeFileSync(file, "x");
    const agent = ctx(workspace, { hostMounts: [] });
    const result = await readHostFileTool.execute({ path: file }, agent);
    expect(result.ok).toBe(true);
    expect(result.approvalRequest).toBeUndefined();
    expect((result.data as { content: string }).content).toBe("x");
  });

  it("read_host_file still hard-denies secret paths outside the workspace (授权也救不回)", async () => {
    const workspace = tmp("lm-ht-ws-");
    const outside = tmp("lm-ht-out-");
    const secret = path.join(outside, ".env");
    fs.writeFileSync(secret, "SECRET=1");
    const agent = ctx(workspace, { hostMounts: [] });
    const denied = await readHostFileTool.execute({ path: secret }, agent);
    expect(denied.ok).toBe(false);
    // 硬拒绝名单不是「待授权」：不走 grant 流程。
    expect(denied.approvalRequest).toBeUndefined();
    expect(String(denied.error)).toContain("密钥");
    // 即使律师点了确认，硬拒绝名单仍然不让读。
    const stillDenied = await readHostFileTool.execute(
      { path: secret, grant_duration: "always", __approved: true },
      agent,
    );
    expect(stillDenied.ok).toBe(false);
  });

  it("read_host_file still denies a mount bound to an opposing party (利益冲突隔离)", async () => {
    const workspace = tmp("lm-ht-ws-");
    fs.mkdirSync(path.join(workspace, "cases", "m-a"), { recursive: true });
    fs.mkdirSync(path.join(workspace, "cases", "m-b"), { recursive: true });
    fs.writeFileSync(
      path.join(workspace, "cases", "m-a", "CASE.md"),
      "## 1. 基本信息\n\n- 客户 / clientId: 甲公司\n- 对方当事人: 乙公司\n\n## 2. 其他\n",
      "utf8",
    );
    fs.writeFileSync(
      path.join(workspace, "cases", "m-b", "CASE.md"),
      "## 1. 基本信息\n\n- 客户 / clientId: 乙公司\n- 对方当事人: 甲公司\n\n## 2. 其他\n",
      "utf8",
    );
    const folderB = tmp("lm-ht-b-");
    fs.writeFileSync(path.join(folderB, "b.md"), "b");
    const agent = ctx(workspace, {
      matterId: "m-a",
      hostMounts: [
        { id: "mb", absPath: folderB, addedAt: "2026-09-12T00:00:00.000Z", matterId: "m-b" },
      ],
    });
    const denied = await readHostFileTool.execute({ path: path.join(folderB, "b.md") }, agent);
    expect(denied.ok).toBe(false);
    expect(String(denied.error)).toContain("利益冲突");
  });

  it("search_host authorized hits expose absPath but never locateAbs", async () => {
    const workspace = tmp("lm-ht-ws-");
    const paper = tmp("lm-ht-paper-");
    fs.writeFileSync(path.join(paper, "PdZn-notes.md"), "PdZn alloy paper");
    const agent = ctx(workspace, {
      hostMounts: [{ id: "paper", absPath: paper, addedAt: "2026-09-12T00:00:00.000Z" }],
    });
    const found = await searchHostTool.execute({ query: "PdZn" }, agent);
    const hits = (
      found.data as { hits: Array<{ absPath?: string; locateAbs?: string; hitId?: string }> }
    ).hits;
    expect(hits.some((h) => h.absPath && !h.locateAbs && h.hitId)).toBe(true);
  });

  it("read_host_file via hit_id reads the plain file directly (无需再等授权)", async () => {
    const workspace = tmp("lm-ht-ws-");
    const outside = tmp("lm-ht-out-");
    const file = path.join(outside, "PdZn-notes.md");
    fs.writeFileSync(file, "PdZn alloy paper");
    const agent = ctx(workspace, { hostMounts: [] });
    rememberLocateHit(agent.sessionId, "hit-loc-1", file);
    // 默认放开：工作区外的普通文件按命中编号直接读，不再先弹授权。
    const read = await readHostFileTool.execute({ hit_id: "hit-loc-1" }, agent);
    expect(read.ok).toBe(true);
    expect(read.approvalRequest).toBeUndefined();
    expect((read.data as { content: string }).content).toContain("alloy");
  });

  it("read_host_file lists a mounted directory recursively", async () => {
    const workspace = tmp("lm-ht-ws-list-");
    const paper = tmp("lm-ht-paper-list-");
    fs.mkdirSync(path.join(paper, "notes"), { recursive: true });
    fs.writeFileSync(path.join(paper, "notes", "memo.md"), "body");
    const agent = ctx(workspace, {
      hostMounts: [{ id: "paper", absPath: paper, addedAt: "2026-09-12T00:00:00.000Z" }],
    });
    const listed = await readHostFileTool.execute({ path: paper }, agent);
    expect(listed.ok).toBe(true);
    const data = listed.data as { kind?: string; entries?: Array<{ path: string }> };
    expect(data.kind).toBe("directory");
    expect(
      data.entries?.some((e) => e.path === "notes/memo.md" || e.path.endsWith("notes/memo.md")),
    ).toBe(true);
  });
});
