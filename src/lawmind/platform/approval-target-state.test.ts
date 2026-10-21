/**
 * 审批卡「当前值」：能不能说清「这次是新建还是覆盖一份多久没动过的文件」。
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { describeApprovalTargetState } from "./approval-target-state.js";

const dirs: string[] = [];

function tmp(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lm-approval-target-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("describeApprovalTargetState", () => {
  it("says the file will be created when it does not exist", () => {
    const ws = tmp();
    const text = describeApprovalTargetState({
      workspaceDir: ws,
      toolName: "write_document",
      toolArgs: { file_path: "cases/m/notes/新笔记.md" },
    });
    expect(text).toContain("尚不存在");
    expect(text).toContain("新建");
  });

  it("reports size and age when it will overwrite an existing file", () => {
    const ws = tmp();
    const rel = "cases/m/drafts/合同.docx";
    fs.mkdirSync(path.dirname(path.join(ws, rel)), { recursive: true });
    fs.writeFileSync(path.join(ws, rel), "x".repeat(2048));
    const text = describeApprovalTargetState({
      workspaceDir: ws,
      toolName: "render_document",
      toolArgs: { output_path: rel },
      now: new Date(Date.now() + 10 * 60_000),
    });
    expect(text).toContain("合同.docx");
    expect(text).toContain("已存在");
    expect(text).toContain("KB");
    expect(text).toContain("覆盖");
  });

  it("does not pretend to know workspace-external files", () => {
    const ws = tmp();
    const text = describeApprovalTargetState({
      workspaceDir: ws,
      toolName: "import_host_file",
      toolArgs: { path: "/Users/someone/Desktop/证据.pdf" },
    });
    expect(text).toContain("工作区外");
  });

  it("returns undefined when the tool names no path at all", () => {
    const ws = tmp();
    expect(
      describeApprovalTargetState({
        workspaceDir: ws,
        toolName: "search_workspace",
        toolArgs: { query: "违约金" },
      }),
    ).toBeUndefined();
  });
});
