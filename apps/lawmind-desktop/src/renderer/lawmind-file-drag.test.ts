import { describe, expect, it } from "vitest";
import {
  collectDroppedAbsItems,
  encodeLawmindFsDrag,
  fileUrlToAbsPath,
  isChatFileDrop,
  isOsFileDrag,
  parseFileUriList,
  parseLawmindFsDrag,
  LAWMID_FS_DRAG_MIME,
} from "./lawmind-file-drag";

describe("lawmind-file-drag", () => {
  it("round-trips a file payload", () => {
    const raw = encodeLawmindFsDrag({
      root: "workspace",
      relPath: "cases/demo/a.md",
      kind: "file",
    });
    expect(parseLawmindFsDrag(raw)).toEqual({
      root: "workspace",
      relPath: "cases/demo/a.md",
      kind: "file",
    });
    expect(LAWMID_FS_DRAG_MIME).toContain("lawmind");
  });

  it("rejects invalid payloads", () => {
    expect(parseLawmindFsDrag(null)).toBeNull();
    expect(parseLawmindFsDrag("{}")).toBeNull();
    expect(parseLawmindFsDrag('{"root":"x","relPath":"a","kind":"file"}')).toBeNull();
  });

  it("parses file: URLs and uri-lists", () => {
    expect(fileUrlToAbsPath("file:///Users/me/合同.docx")).toBe("/Users/me/合同.docx");
    expect(fileUrlToAbsPath("file:///C:/Users/me/a.docx")).toBe("C:/Users/me/a.docx");
    expect(fileUrlToAbsPath("/Users/me/plain.docx")).toBe("/Users/me/plain.docx");
    expect(parseFileUriList("file:///Users/a/a.docx\nfile:///Users/a/b.pdf")).toEqual([
      "/Users/a/a.docx",
      "/Users/a/b.pdf",
    ]);
  });

  it("collects OS drop paths from File.path and treats Files as a chat drop", () => {
    const file = new File(["x"], "nda.docx");
    Object.defineProperty(file, "path", { value: "/tmp/ws/contracts/nda.docx" });
    const dt = {
      types: ["Files"],
      files: [file],
      items: [],
      getData: () => "",
    } as unknown as DataTransfer;
    expect(isOsFileDrag(dt)).toBe(true);
    expect(isChatFileDrop(dt)).toBe(true);
    expect(collectDroppedAbsItems(dt)).toEqual([
      { absPath: "/tmp/ws/contracts/nda.docx", kind: "file" },
    ]);
  });
});


describe("lawmind-file-drag", () => {
  it("round-trips a file payload", () => {
    const raw = encodeLawmindFsDrag({
      root: "workspace",
      relPath: "cases/demo/a.md",
      kind: "file",
    });
    expect(parseLawmindFsDrag(raw)).toEqual({
      root: "workspace",
      relPath: "cases/demo/a.md",
      kind: "file",
    });
    expect(LAWMID_FS_DRAG_MIME).toContain("lawmind");
  });

  it("rejects invalid payloads", () => {
    expect(parseLawmindFsDrag(null)).toBeNull();
    expect(parseLawmindFsDrag("{}")).toBeNull();
    expect(parseLawmindFsDrag('{"root":"x","relPath":"a","kind":"file"}')).toBeNull();
  });
});
