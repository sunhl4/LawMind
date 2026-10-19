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

  it("names the real reasons a .doc body may be unreadable", () => {
    expect(DOC_NEEDS_DOCX_CODE).toBe("doc_needs_docx");
    expect(DOC_NEEDS_DOCX_MESSAGE).toMatch(/加密|Word 6\/95|损坏/);
    // 仍然给一条可执行的路：另存为 .docx。
    expect(DOC_NEEDS_DOCX_MESSAGE).toMatch(/\.docx/);
    // 不再把「装插件」「另存副本」说成前提。
    expect(DOC_NEEDS_DOCX_MESSAGE).not.toMatch(/textutil|LibreOffice|加载项/);
  });
});
