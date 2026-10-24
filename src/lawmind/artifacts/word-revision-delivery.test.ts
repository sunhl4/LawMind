import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildWordRevisionFilename,
  exportDirForSource,
  planTrackedWordDelivery,
  resolveWordBaselineAbs,
  stripWordRevisionStamp,
} from "./word-revision-delivery.js";

const dirs: string[] = [];

afterEach(() => {
  for (const d of dirs.splice(0)) {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

describe("word-revision-delivery", () => {
  it("strips a prior date/version stamp before restamping", () => {
    expect(stripWordRevisionStamp("框架协议_20260827_01")).toBe("框架协议");
    expect(stripWordRevisionStamp("框架协议_20260827_150405")).toBe("框架协议");
    expect(stripWordRevisionStamp("框架协议")).toBe("框架协议");
  });

  it("names the first export 原名_日期_01", () => {
    const name = buildWordRevisionFilename(
      "泰国医疗人工智能战略合作框架协.docx",
      new Date("2026-08-27T12:00:00"),
    );
    expect(name).toBe("泰国医疗人工智能战略合作框架协_20260827_01.docx");
  });

  it("increments 02 when the same-day 01 already exists", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lm-word-rev-"));
    dirs.push(dir);
    const at = new Date("2026-08-27T12:00:00");
    const first = buildWordRevisionFilename("nda.docx", at, { dirForUniqueness: dir });
    expect(first).toBe("nda_20260827_01.docx");
    fs.writeFileSync(path.join(dir, first), "x");
    const second = buildWordRevisionFilename("nda.docx", at, { dirForUniqueness: dir });
    expect(second).toBe("nda_20260827_02.docx");
  });

  it("resolves a project-only Word baseline and plans a sibling output", () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-word-ws-"));
    const project = fs.mkdtempSync(path.join(os.tmpdir(), "lm-word-proj-"));
    dirs.push(ws, project);
    const leaf = "泰国医疗人工智能战略合作框架协.docx";
    fs.writeFileSync(path.join(project, leaf), "docx");
    const resolved = resolveWordBaselineAbs({
      workspaceDir: ws,
      projectDir: project,
      raw: leaf,
    });
    expect(resolved?.root).toBe("project");
    expect(resolved?.abs).toBe(path.join(project, leaf));

    const planned = planTrackedWordDelivery({
      workspaceDir: ws,
      projectDir: project,
      baselineRel: leaf,
      baselineRoot: "project",
      at: new Date("2026-08-27T08:00:00"),
    });
    expect(planned.outDir).toBe(project);
    expect(planned.outputFileName).toBe("泰国医疗人工智能战略合作框架协_20260827_01.docx");
    expect(planned.baselineRoot).toBe("project");
  });

  it("writes next to a workspace baseline instead of artifacts/", () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-word-ws-"));
    dirs.push(ws);
    const rel = "contracts/合作协议.docx";
    fs.mkdirSync(path.join(ws, "contracts"), { recursive: true });
    fs.writeFileSync(path.join(ws, rel), "docx");
    const planned = planTrackedWordDelivery({
      workspaceDir: ws,
      baselineRel: rel,
      at: new Date("2026-08-27T08:00:00"),
    });
    expect(planned.outDir).toBe(path.join(ws, "contracts"));
    expect(planned.outputFileName).toBe("合作协议_20260827_01.docx");
    expect(planned.outputFileName).not.toMatch(/_[0-9a-f]{8}\.docx$/i);
  });

  it("reuses the sibling already written for this draft", () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-word-reuse-"));
    dirs.push(ws);
    const rel = "contracts/合作协议.docx";
    fs.mkdirSync(path.join(ws, "contracts"), { recursive: true });
    fs.writeFileSync(path.join(ws, rel), "docx");
    const at = new Date("2026-08-27T08:00:00");
    const first = planTrackedWordDelivery({ workspaceDir: ws, baselineRel: rel, at });
    const existing = path.join(first.outDir, first.outputFileName);
    fs.writeFileSync(existing, "docx");
    const again = planTrackedWordDelivery({
      workspaceDir: ws,
      baselineRel: rel,
      at,
      existingOutputAbs: existing,
    });
    expect(again.outputFileName).toBe(first.outputFileName);
    const bumped = planTrackedWordDelivery({ workspaceDir: ws, baselineRel: rel, at });
    expect(bumped.outputFileName).toBe("合作协议_20260827_02.docx");
  });
});

describe("exportDirForSource（副本落点）", () => {
  it("原件在工作区里：写在原件旁", () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-exp-ws-"));
    dirs.push(ws);
    fs.mkdirSync(path.join(ws, "contracts"), { recursive: true });
    const src = path.join(ws, "contracts", "合作协议.docx");
    fs.writeFileSync(src, "x");
    expect(exportDirForSource({ workspaceDir: ws, sourceAbs: src })).toBe(
      path.join(ws, "contracts"),
    );
  });

  it("原件在会话的工作区外：导到工作区 artifacts", () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-exp-ws-"));
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "lm-exp-out-"));
    dirs.push(ws, outside);
    const src = path.join(outside, "别的文件夹.docx");
    fs.writeFileSync(src, "x");
    expect(exportDirForSource({ workspaceDir: ws, sourceAbs: src })).toBe(
      path.join(ws, "artifacts"),
    );
  });

  it("有案件时导到案件 artifacts", () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-exp-ws-"));
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "lm-exp-out-"));
    dirs.push(ws, outside);
    const src = path.join(outside, "别的文件夹.docx");
    fs.writeFileSync(src, "x");
    expect(exportDirForSource({ workspaceDir: ws, matterId: "m-1", sourceAbs: src })).toBe(
      path.join(ws, "cases", "m-1", "artifacts"),
    );
  });

  it("不知道原件时按工作区导出位置处理", () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-exp-ws-"));
    dirs.push(ws);
    expect(exportDirForSource({ workspaceDir: ws })).toBe(path.join(ws, "artifacts"));
  });

  it("项目夹里的原件仍在原文件旁（会话挂的本机文件夹）", () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-exp-ws-"));
    const project = fs.mkdtempSync(path.join(os.tmpdir(), "lm-exp-proj-"));
    dirs.push(ws, project);
    const src = path.join(project, "本机合同.docx");
    fs.writeFileSync(src, "x");
    expect(exportDirForSource({ workspaceDir: ws, projectDir: project, sourceAbs: src })).toBe(
      project,
    );
  });
});
