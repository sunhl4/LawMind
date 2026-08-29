import { describe, expect, it } from "vitest";
import { toWorkspaceRelativePath } from "./lawmind-workspace-relpath";

describe("toWorkspaceRelativePath", () => {
  it("strips workspace prefix", () => {
    expect(
      toWorkspaceRelativePath("/Users/me/ws", "/Users/me/ws/artifacts/a.docx"),
    ).toBe("artifacts/a.docx");
  });

  it("keeps already-relative paths", () => {
    expect(toWorkspaceRelativePath("/Users/me/ws", "artifacts/a.docx")).toBe("artifacts/a.docx");
  });

  it("returns null when outside workspace", () => {
    expect(toWorkspaceRelativePath("/Users/me/ws", "/tmp/a.docx")).toBeNull();
  });
});
