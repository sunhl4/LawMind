import { describe, expect, it } from "vitest";
import {
  rememberDetachedFileTab,
  takeDetachedFileTab,
} from "./lawmind-detached-file-tabs";

describe("detached file tab registry", () => {
  it("remembers a moved tab and returns it exactly once", () => {
    rememberDetachedFileTab("workspace-pane:middle:workspace:notes/a.md", {
      root: "workspace",
      relPath: " notes/a.md ",
    });

    expect(takeDetachedFileTab(" workspace-pane:middle:workspace:notes/a.md ")).toEqual({
      root: "workspace",
      relPath: "notes/a.md",
    });
    // 第二次必须为空：同一份回程票不能把标签重复打开。
    expect(takeDetachedFileTab("workspace-pane:middle:workspace:notes/a.md")).toBeNull();
  });

  it("ignores empty keys and paths", () => {
    rememberDetachedFileTab("", { root: "workspace", relPath: "a.md" });
    rememberDetachedFileTab("workspace-pane:middle:m-1", { root: "workspace", relPath: "  " });
    expect(takeDetachedFileTab("workspace-pane:middle:m-1")).toBeNull();
  });
});
