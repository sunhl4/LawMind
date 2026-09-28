import { describe, expect, it } from "vitest";
import {
  DOC_NEEDS_DOCX_CODE,
  DOC_NEEDS_DOCX_MESSAGE,
  isBinaryWordDocBaseline,
} from "./doc-revision-gate.js";

describe("doc-revision-gate", () => {
  it("flags only binary .doc paths", () => {
    expect(isBinaryWordDocBaseline("合同.doc")).toBe(true);
    expect(isBinaryWordDocBaseline("合同.DOC")).toBe(true);
    expect(isBinaryWordDocBaseline("合同.docx")).toBe(false);
    expect(isBinaryWordDocBaseline("合同.docm")).toBe(false);
  });

  it("keeps a stable lawyer-facing stop message", () => {
    expect(DOC_NEEDS_DOCX_CODE).toBe("doc_needs_docx");
    expect(DOC_NEEDS_DOCX_MESSAGE).toMatch(/另存为同名的 \.docx/);
    expect(DOC_NEEDS_DOCX_MESSAGE).not.toMatch(/textutil|LibreOffice|自动/);
  });
});
