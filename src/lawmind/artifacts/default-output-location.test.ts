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

  it("writes to a lawyer-named Desktop instead of workspace artifacts", () => {
    const ws = tmpDir("lm-out-ws-");
    const home = tmpDir("lm-out-home-");
    const desktop = path.join(home, "Desktop");
    fs.mkdirSync(desktop);
    const result = resolveDefaultDeliverableLocation({
      workspaceDir: ws,
      namedPlaceDir: desktop,
      homeDir: home,
      title: "合同审查意见",
      extension: ".docx",
      at,
      protectSourcePath: path.join(desktop, "采购合同.docx"),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.planned.reason).toBe("named_place");
    expect(result.planned.outDir).toBe(desktop);
    expect(result.planned.filename).toBe("合同审查意见_20260912_01.docx");
    expect(result.planned.outputPath).not.toBe(path.join(desktop, "采购合同.docx"));
  });

  it("does not treat an arbitrary folder as a named place", () => {
    const ws = tmpDir("lm-out-ws-");
    const other = tmpDir("lm-out-other-");
    const result = resolveDefaultDeliverableLocation({
      workspaceDir: ws,
      namedPlaceDir: other,
      title: "合同审查意见",
      extension: ".docx",
      at,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.planned.reason).toBe("workspace_artifacts");
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
