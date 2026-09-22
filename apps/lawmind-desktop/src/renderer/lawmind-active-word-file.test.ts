import { afterEach, describe, expect, it } from "vitest";
import {
  resolveImplicitWordPinsForChat,
  setActiveWorkbenchWordFile,
} from "./lawmind-active-word-file.ts";

describe("resolveImplicitWordPinsForChat", () => {
  afterEach(() => {
    setActiveWorkbenchWordFile(null);
  });

  it("attaches the open workbench Word when the dialog says 修改合同", () => {
    setActiveWorkbenchWordFile({
      root: "project",
      relPath: "泰国医疗人工智能战略合作框架协议.docx",
    });
    expect(
      resolveImplicitWordPinsForChat({
        text: "修改合同，立场甲方，导出",
        existing: [],
      }),
    ).toEqual([
      {
        root: "project",
        relPath: "泰国医疗人工智能战略合作框架协议.docx",
        kind: "file",
      },
    ]);
  });

  it("does not attach when a Word pin is already present", () => {
    setActiveWorkbenchWordFile({
      root: "project",
      relPath: "other.docx",
    });
    expect(
      resolveImplicitWordPinsForChat({
        text: "修改合同",
        existing: [{ root: "project", relPath: "已钉.docx", kind: "file" }],
      }),
    ).toEqual([]);
  });

  it("does not attach for ordinary chat", () => {
    setActiveWorkbenchWordFile({
      root: "project",
      relPath: "合同.docx",
    });
    expect(resolveImplicitWordPinsForChat({ text: "今天开庭准备什么？", existing: [] })).toEqual(
      [],
    );
  });
});
