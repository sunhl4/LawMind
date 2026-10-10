/**
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";
import { isBinaryPreviewKind, resolvePreviewKind } from "./preview-kind";

describe("resolvePreviewKind", () => {
  it("maps docx to word and other office to fallback", () => {
    expect(resolvePreviewKind("a/合同.docx")).toBe("word");
    expect(resolvePreviewKind("a/合同.DOCX")).toBe("word");
    expect(resolvePreviewKind("a/旧稿.doc")).toBe("doc");
    expect(resolvePreviewKind("a/表.xls")).toBe("fallback");
    expect(resolvePreviewKind("a/片.pptx")).toBe("fallback");
  });

  it("maps pdf / xlsx / media / eml / zip / image / text", () => {
    expect(resolvePreviewKind("判决书.pdf")).toBe("pdf");
    expect(resolvePreviewKind("费用.xlsx")).toBe("xlsx");
    expect(resolvePreviewKind("庭审.mp3")).toBe("media");
    expect(resolvePreviewKind("庭审.mp4")).toBe("media");
    expect(resolvePreviewKind("往来.eml")).toBe("eml");
    expect(resolvePreviewKind("证据包.zip")).toBe("zip");
    expect(resolvePreviewKind("证据.png")).toBe("image");
    expect(resolvePreviewKind("notes.md")).toBe("text");
    expect(resolvePreviewKind("README")).toBe("text");
  });

  it("marks non-text kinds as binary for tab dirty checks", () => {
    expect(isBinaryPreviewKind("text")).toBe(false);
    expect(isBinaryPreviewKind("word")).toBe(true);
    expect(isBinaryPreviewKind("pdf")).toBe(true);
  });
});
