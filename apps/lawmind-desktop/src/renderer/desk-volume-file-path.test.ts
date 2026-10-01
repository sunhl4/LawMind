import { describe, expect, it } from "vitest";
import {
  isDeskNativeOfficePath,
  isDeskPreviewablePath,
  isDeskWordPath,
  resolveDeskVolumeWorkspacePath,
} from "./desk-volume-file-path";

describe("resolveDeskVolumeWorkspacePath", () => {
  it("prefixes matter-scoped materials paths", () => {
    expect(resolveDeskVolumeWorkspacePath("m1", "materials/合同.docx")).toBe(
      "cases/m1/materials/合同.docx",
    );
  });

  it("keeps cases/ and workspace-root paths", () => {
    expect(resolveDeskVolumeWorkspacePath("m1", "cases/m1/deliverables/函.docx")).toBe(
      "cases/m1/deliverables/函.docx",
    );
    expect(resolveDeskVolumeWorkspacePath("m1", "artifacts/起诉状.docx")).toBe("artifacts/起诉状.docx");
  });

  it("maps absolute paths under the workspace", () => {
    expect(
      resolveDeskVolumeWorkspacePath("m1", "/Users/me/ws/cases/m1/materials/a.docx", "/Users/me/ws"),
    ).toBe("cases/m1/materials/a.docx");
  });

  it("rejects traversal", () => {
    expect(resolveDeskVolumeWorkspacePath("m1", "materials/../secrets.txt")).toBeNull();
  });
});

describe("desk volume path kinds", () => {
  it("classifies word / office / previewable", () => {
    expect(isDeskWordPath("a.docx")).toBe(true);
    expect(isDeskNativeOfficePath("a.pdf")).toBe(true);
    expect(isDeskPreviewablePath("notes/a.md")).toBe(true);
    expect(isDeskPreviewablePath("plain")).toBe(false);
  });
});
