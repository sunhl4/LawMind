import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildWordRevisionFilename,
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
});
