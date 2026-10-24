import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  isWorkspaceDeliverableRel,
  resolveDefaultDeliverableLocation,
  workspaceDeliverableRel,
} from "./default-output-location.js";

const dirs: string[] = [];

afterEach(() => {
  for (const d of dirs.splice(0)) {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

function tmpDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

const at = new Date("2026-09-12T12:00:00");

describe("resolveDefaultDeliverableLocation", () => {
  it("uses an explicit file path inside the workspace", () => {
    const ws = tmpDir("lm-out-ws-");
    const result = resolveDefaultDeliverableLocation({
      workspaceDir: ws,
      explicitOutput: "docs/方案.docx",
      title: "忽略",
      extension: ".docx",
      at,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.planned.reason).toBe("explicit");
    expect(result.planned.outDir).toBe(path.join(ws, "docs"));
    expect(result.planned.filename).toBe("方案.docx");
  });

  it("rejects an explicit path that escapes workspace and project", () => {
    const ws = tmpDir("lm-out-ws-");
    const result = resolveDefaultDeliverableLocation({
      workspaceDir: ws,
      explicitOutput: "/etc/passwd.docx",
      title: "方案",
      extension: ".docx",
      at,
    });
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error).toContain("不在工作区");
  });

  it("writes next to a source file instead of artifacts/", () => {
    const ws = tmpDir("lm-out-ws-");
    const rel = "docs/lawmind/LAWMIND-HOST-ACCESS.md";
    fs.mkdirSync(path.join(ws, "docs/lawmind"), { recursive: true });
    fs.writeFileSync(path.join(ws, rel), "draft");
    const result = resolveDefaultDeliverableLocation({
      workspaceDir: ws,
      sourcePath: rel,
      title: "LawMind 文件可见范围扩展方案（含权限与合规设计）",
      extension: ".docx",
      at,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.planned.reason).toBe("beside_source");
    expect(result.planned.outDir).toBe(path.join(ws, "docs/lawmind"));
    expect(result.planned.filename).toBe(
      "LawMind 文件可见范围扩展方案（含权限与合规设计）_20260912_01.docx",
    );
    expect(result.planned.filename).not.toMatch(/_[0-9a-f]{8}\.docx$/i);
  });

  it("scopes a new deliverable to the matter artifacts folder", () => {
    const ws = tmpDir("lm-out-ws-");
    const result = resolveDefaultDeliverableLocation({
      workspaceDir: ws,
      matterId: "xinghui-sale-876",
      title: "代理词提纲",
      extension: ".docx",
      at,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.planned.reason).toBe("matter");
    expect(result.planned.outDir).toBe(path.join(ws, "cases", "xinghui-sale-876", "artifacts"));
    expect(result.planned.filename).toBe("代理词提纲_20260912_01.docx");
  });

  it("writes into the open project folder when no matter is bound", () => {
    const ws = tmpDir("lm-out-ws-");
    const project = tmpDir("lm-out-proj-");
    const result = resolveDefaultDeliverableLocation({
      workspaceDir: ws,
      projectDir: project,
      title: "客户汇报",
      extension: ".pptx",
      at,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.planned.reason).toBe("project");
    expect(result.planned.outDir).toBe(project);
    expect(result.planned.filename).toBe("客户汇报_20260912_01.pptx");
  });

  it("prefers an existing project artifacts/ subdirectory", () => {
    const ws = tmpDir("lm-out-ws-");
    const project = tmpDir("lm-out-proj-");
    fs.mkdirSync(path.join(project, "artifacts"));
    const result = resolveDefaultDeliverableLocation({
      workspaceDir: ws,
      projectDir: project,
      title: "客户汇报",
      extension: ".pptx",
      at,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.planned.outDir).toBe(path.join(project, "artifacts"));
  });

  it("keeps notes out of artifacts/ when kind is note", () => {
    const ws = tmpDir("lm-out-ws-");
    const result = resolveDefaultDeliverableLocation({
      workspaceDir: ws,
      matterId: "m-note",
      title: "工作笔记",
      extension: ".md",
      kind: "note",
      at,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.planned.reason).toBe("matter");
    expect(result.planned.outDir).toBe(path.join(ws, "cases", "m-note", "notes"));
    expect(result.planned.filename).toBe("工作笔记_20260912_01.md");
  });

  it("falls back to workspace artifacts/ with a date name, never a task hash", () => {
    const ws = tmpDir("lm-out-ws-");
    const result = resolveDefaultDeliverableLocation({
      workspaceDir: ws,
      title: "LawMind 文件可见范围扩展方案（含权限与合规设计）",
      extension: ".docx",
      at,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.planned.reason).toBe("workspace_artifacts");
    expect(result.planned.outDir).toBe(path.join(ws, "artifacts"));
    expect(result.planned.filename).toBe(
      "LawMind 文件可见范围扩展方案（含权限与合规设计）_20260912_01.docx",
    );
    expect(result.planned.filename).not.toMatch(/_[0-9a-f]{8}\./i);
  });

  it("对话产出永远落在工作区：没有「律师点名的落点」这条通路", () => {
    const ws = tmpDir("lm-out-ws-");
    const home = tmpDir("lm-out-home-");
    const desktop = path.join(home, "Desktop");
    fs.mkdirSync(desktop);

    // `namedPlaceDir` / `homeDir` 已从签名删除：外部落点连参数都不存在，
    // 所以「写到桌面」在类型层面就不可表达。
    const result = resolveDefaultDeliverableLocation({
      workspaceDir: ws,
      title: "合同审查意见",
      extension: ".docx",
      at,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.planned.reason).toBe("workspace_artifacts");
    expect(result.planned.outDir).toBe(path.join(ws, "artifacts"));
    expect(result.planned.filename).toBe("合同审查意见_20260912_01.docx");
    // 桌面里什么都没写。
    expect(fs.readdirSync(desktop)).toEqual([]);
  });

  it("显式 outputPath 指向工作区外：直接报错，不静默回落到 artifacts", () => {
    const ws = tmpDir("lm-out-ws-");
    const outside = tmpDir("lm-out-other-");
    const result = resolveDefaultDeliverableLocation({
      workspaceDir: ws,
      explicitOutput: path.join(outside, "意见书.docx"),
      title: "合同审查意见",
      extension: ".docx",
      at,
    });
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error).toContain("不在工作区");
    expect(fs.readdirSync(outside)).toEqual([]);
  });
});

describe("workspace deliverable rel", () => {
  it("accepts root artifacts and matter artifacts only", () => {
    expect(isWorkspaceDeliverableRel("artifacts/a.docx")).toBe(true);
    expect(isWorkspaceDeliverableRel("cases/m1/artifacts/a.docx")).toBe(true);
    expect(isWorkspaceDeliverableRel("cases/m1/CASE.md")).toBe(false);
    expect(isWorkspaceDeliverableRel("docs/a.docx")).toBe(false);
    expect(isWorkspaceDeliverableRel("../artifacts/a.docx")).toBe(false);
  });

  it("maps an absolute workspace path back to a preview rel", () => {
    const ws = tmpDir("lm-out-ws-");
    const abs = path.join(ws, "cases", "m1", "artifacts", "函_20260912_01.docx");
    expect(workspaceDeliverableRel(ws, abs)).toBe("cases/m1/artifacts/函_20260912_01.docx");
  });
});
