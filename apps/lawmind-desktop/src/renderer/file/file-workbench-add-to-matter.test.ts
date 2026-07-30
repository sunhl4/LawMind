import { describe, expect, it } from "vitest";
import { parentDirsToRefresh, remapTabsAfterWorkspaceMove } from "./file-workbench-add-to-matter";

describe("file-workbench-add-to-matter helpers", () => {
  it("remaps open tabs after a workspace move", () => {
    const tabs = [
      { id: "workspace:docs/a.md", path: "docs/a.md", name: "a.md" },
      { id: "workspace:docs/a.md/nested", path: "docs/a.md/nested", name: "nested" },
      { id: "workspace:other.md", path: "other.md", name: "other.md" },
    ];
    const next = remapTabsAfterWorkspaceMove(tabs, "docs/a.md", "cases/m1/a.md");
    expect(next[0]).toMatchObject({ path: "cases/m1/a.md", name: "a.md" });
    expect(next[1]?.path).toBe("cases/m1/a.md/nested");
    expect(next[2]?.path).toBe("other.md");
  });

  it("lists parent dirs to refresh", () => {
    expect(parentDirsToRefresh("docs/a.md", "cases/m1")).toEqual(["docs", "cases/m1"]);
  });
});
