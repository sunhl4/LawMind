import { describe, expect, it } from "vitest";
import { fileTabLabelParts, fileTypeTone } from "./file-type-mark";

describe("fileTypeTone", () => {
  it("maps the file types lawyers open side by side", () => {
    expect(fileTypeTone("SQD.pdf")).toBe("pdf");
    expect(fileTypeTone("吉利项目价格拆解（国浩）20260228v1.xlsx")).toBe("sheet");
    expect(fileTypeTone("合同.docx")).toBe("word");
    expect(fileTypeTone("庭审.mp4")).toBe("media");
    expect(fileTypeTone("往来.eml")).toBe("mail");
    expect(fileTypeTone("notes.md")).toBe("text");
    expect(fileTypeTone("README")).toBe("file");
  });

  it("keeps the extension outside the ellipsis", () => {
    expect(fileTabLabelParts("吉利项目价格拆解（国浩）20260228v1.xlsx")).toEqual({
      stem: "吉利项目价格拆解（国浩）20260228v1",
      ext: ".xlsx",
    });
    expect(fileTabLabelParts("SQD.pdf")).toEqual({ stem: "SQD", ext: ".pdf" });
    expect(fileTabLabelParts("README")).toEqual({ stem: "README", ext: "" });
  });
});
