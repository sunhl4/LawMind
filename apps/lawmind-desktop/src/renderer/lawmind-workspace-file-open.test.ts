/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from "vitest";
import {
  LAWMIND_OPEN_WORKSPACE_FILE_EVENT,
  matterIdOwnedByOpenedFile,
  offsetForLine,
  requestOpenWorkspaceFile,
} from "./lawmind-workspace-file-open";

describe("matterIdOwnedByOpenedFile", () => {
  it("uses the case folder and ignores other files", () => {
    expect(matterIdOwnedByOpenedFile("cases/普华-小华/合同.docx")).toBe("普华-小华");
    expect(matterIdOwnedByOpenedFile("非技术相关/采购合同模板/保洁类合同模板.docx", "project")).toBeNull();
    expect(matterIdOwnedByOpenedFile("canvas/核对-task.canvas.tsx")).toBeNull();
  });

  it("maps a 1-based line onto the textarea offsets", () => {
    const text = "甲\n乙丙\n丁";
    expect(offsetForLine(text, 2, 2)).toEqual({ start: 3, end: 4 });
    expect(offsetForLine(text, 99, 1).start).toBe(text.lastIndexOf("丁"));
  });

  it("asks the editor to open a text file on a line", () => {
    const seen: Array<{ relPath?: string; line?: number; column?: number }> = [];
    const onOpen = (event: Event) => {
      seen.push((event as CustomEvent<{ relPath?: string; line?: number; column?: number }>).detail);
    };
    window.addEventListener(LAWMIND_OPEN_WORKSPACE_FILE_EVENT, onOpen);
    requestOpenWorkspaceFile("notes/memo.md", "workspace", { line: 8, column: 2 });
    window.removeEventListener(LAWMIND_OPEN_WORKSPACE_FILE_EVENT, onOpen);
    expect(seen[0]).toEqual({ relPath: "notes/memo.md", root: "workspace", line: 8, column: 2 });
  });
});
