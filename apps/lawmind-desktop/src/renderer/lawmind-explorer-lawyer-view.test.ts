import { describe, expect, it } from "vitest";
import {
  filterExplorerEntries,
  isLawyerCasesPath,
  pathHasHiddenSegment,
  shouldShowExplorerDirectory,
  shouldShowExplorerFile,
} from "./lawmind-explorer-lawyer-view.ts";

describe("lawmind-explorer-lawyer-view", () => {
  it("hides system dirs by segment", () => {
    expect(pathHasHiddenSegment("memory")).toBe(true);
    expect(pathHasHiddenSegment("cases/foo")).toBe(false);
    expect(pathHasHiddenSegment("cases/foo/memory-backup")).toBe(false);
    expect(pathHasHiddenSegment("node_modules/x")).toBe(true);
    expect(pathHasHiddenSegment("cases/foo/mail")).toBe(true);
    expect(pathHasHiddenSegment("templates")).toBe(true);
    expect(pathHasHiddenSegment("notes/draft")).toBe(false);
  });

  it("cases path helper", () => {
    expect(isLawyerCasesPath("cases")).toBe(true);
    expect(isLawyerCasesPath("cases/m1/合同.docx")).toBe(true);
    expect(isLawyerCasesPath("随手笔记.md")).toBe(false);
    expect(isLawyerCasesPath("我的文档/函件.docx")).toBe(false);
  });

  it("workspace root: show lawyer docs, hide config", () => {
    expect(shouldShowExplorerFile("workspace", "随手笔记.md")).toBe(true);
    expect(shouldShowExplorerFile("workspace", "函件.docx")).toBe(true);
    expect(shouldShowExplorerFile("workspace", "MEMORY.md")).toBe(false);
    expect(shouldShowExplorerFile("workspace", "assistants.json")).toBe(false);
    expect(shouldShowExplorerFile("workspace", "foo.ts")).toBe(false);
    expect(shouldShowExplorerDirectory("workspace", "我的文档")).toBe(true);
    expect(shouldShowExplorerDirectory("workspace", "templates")).toBe(false);
    expect(shouldShowExplorerDirectory("workspace", "cases")).toBe(true);
  });

  it("under cases shows materials but hides engine files", () => {
    expect(shouldShowExplorerFile("workspace", "cases/m/CASE.md")).toBe(true);
    expect(shouldShowExplorerFile("workspace", "cases/m/合同.pdf")).toBe(true);
    expect(shouldShowExplorerFile("workspace", "cases/m/script.ts")).toBe(false);
    expect(shouldShowExplorerFile("workspace", "cases/m/matter.json")).toBe(false);
    expect(shouldShowExplorerDirectory("workspace", "cases/m/mail")).toBe(false);
  });

  it("filterExplorerEntries hides system roots but keeps user folders and cases", () => {
    const entries = [
      { name: "MEMORY.md", path: "MEMORY.md", kind: "file" as const },
      { name: "随手笔记.md", path: "随手笔记.md", kind: "file" as const },
      { name: "audit", path: "audit", kind: "directory" as const },
      { name: "cases", path: "cases", kind: "directory" as const },
      { name: "templates", path: "templates", kind: "directory" as const },
      { name: "我的文档", path: "我的文档", kind: "directory" as const },
    ];
    const out = filterExplorerEntries("workspace", "", entries);
    expect(out.map((e) => e.name).toSorted()).toEqual(["cases", "我的文档", "随手笔记.md"].toSorted());
  });
});
