import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveLawyerLocalFile } from "./lawyer-local-file.js";

const dirs: string[] = [];

afterEach(() => {
  for (const d of dirs.splice(0)) {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

describe("resolveLawyerLocalFile", () => {
  it("finds a project-root Word by filename when it is not in the workspace", () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-loc-ws-"));
    const project = fs.mkdtempSync(path.join(os.tmpdir(), "lm-loc-proj-"));
    dirs.push(ws, project);
    const leaf = "泰国医疗人工智能战略合作框架协.docx";
    fs.writeFileSync(path.join(project, leaf), "docx");
    const found = resolveLawyerLocalFile({
      workspaceDir: ws,
      projectDir: project,
      raw: leaf,
      wordOnly: true,
    });
    expect(found?.root).toBe("project");
    expect(found?.abs).toBe(path.join(project, leaf));
  });

  it("finds a nested project Word by basename", () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-loc-ws-"));
    const project = fs.mkdtempSync(path.join(os.tmpdir(), "lm-loc-proj-"));
    dirs.push(ws, project);
    const rel = "contracts/nda.docx";
    fs.mkdirSync(path.join(project, "contracts"), { recursive: true });
    fs.writeFileSync(path.join(project, rel), "docx");
    const found = resolveLawyerLocalFile({
      workspaceDir: ws,
      projectDir: project,
      raw: "nda.docx",
      wordOnly: true,
    });
    expect(found?.rel).toBe(rel);
    expect(found?.root).toBe("project");
  });

  it("matches a truncated Word stem to the unique full filename", () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-loc-ws-"));
    const project = fs.mkdtempSync(path.join(os.tmpdir(), "lm-loc-proj-"));
    dirs.push(ws, project);
    const full = "泰国医疗人工智能战略合作框架协议.docx";
    fs.writeFileSync(path.join(project, full), "docx");
    const found = resolveLawyerLocalFile({
      workspaceDir: ws,
      projectDir: project,
      raw: "泰国医疗人工智能战略合作框架协.docx",
    });
    expect(found?.rel).toBe(full);
  });
});
