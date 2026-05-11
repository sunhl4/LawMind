import { describe, expect, it } from "vitest";
import {
  filterExplorerEntries,
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
  });

  it("workspace root files", () => {
    expect(shouldShowExplorerFile("workspace", "MEMORY.md")).toBe(true);
    expect(shouldShowExplorerFile("workspace", "assistants.json")).toBe(false);
    expect(shouldShowExplorerFile("workspace", "foo.ts")).toBe(false);
  });

  it("under cases shows tech sources", () => {
    expect(shouldShowExplorerFile("workspace", "cases/m/script.ts")).toBe(true);
  });

  it("filterExplorerEntries", () => {
    const entries = [
      { name: "MEMORY.md", path: "MEMORY.md", kind: "file" as const },
      { name: "audit", path: "audit", kind: "directory" as const },
      { name: "cases", path: "cases", kind: "directory" as const },
    ];
    const out = filterExplorerEntries("workspace", "", entries);
    expect(out.map((e) => e.name).toSorted()).toEqual(["MEMORY.md", "cases"].toSorted());
  });

  it("shouldShowExplorerDirectory", () => {
    expect(shouldShowExplorerDirectory("workspace", "cases")).toBe(true);
    expect(shouldShowExplorerDirectory("workspace", "sessions")).toBe(false);
  });
});
