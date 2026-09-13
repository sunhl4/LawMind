import { describe, expect, it } from "vitest";
import { resolveRelForAbs, toWorkspaceRelativePath } from "./lawmind-workspace-relpath";

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

describe("resolveRelForAbs", () => {
  it("maps workspace and project files", () => {
    expect(resolveRelForAbs("/tmp/ws", "/tmp/proj", "/tmp/ws/cases/a/b.docx")).toEqual({
      root: "workspace",
      rel: "cases/a/b.docx",
    });
    expect(resolveRelForAbs("/tmp/ws", "/tmp/proj", "/tmp/proj/nda.docx")).toEqual({
      root: "project",
      rel: "nda.docx",
    });
  });

  it("returns null outside both roots or for the root itself", () => {
    expect(resolveRelForAbs("/tmp/ws", "/tmp/proj", "/Users/me/Downloads/x.docx")).toBeNull();
    expect(resolveRelForAbs("/tmp/ws", null, "/tmp/ws")).toEqual({ root: "workspace", rel: "" });
  });
});
