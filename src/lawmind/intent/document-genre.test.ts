import { describe, expect, it } from "vitest";
import {
  classifyDocumentGenre,
  dominantDocumentGenre,
  genresConflictContractVsPleading,
  wordRevisionShouldInjectFamilyChecklist,
} from "./document-genre.js";

describe("document-genre", () => {
  it("classifies Chinese legal filenames with high precision", () => {
    expect(classifyDocumentGenre("民事起诉状.docx")).toBe("pleading");
    expect(classifyDocumentGenre("买卖合同.docx")).toBe("contract");
    expect(classifyDocumentGenre("催告函.docx")).toBe("letter");
    expect(classifyDocumentGenre("进项发票.pdf")).toBe("invoice");
    expect(classifyDocumentGenre("开庭传票.pdf")).toBe("court_notice");
    expect(classifyDocumentGenre("开庭传票.jpg")).toBe("court_notice");
    expect(classifyDocumentGenre("客户谈话记录.txt")).toBe("talk");
    expect(classifyDocumentGenre("身份证正面.jpg")).toBe("identity");
    expect(classifyDocumentGenre("营业执照.pdf")).toBe("identity");
    expect(classifyDocumentGenre("隐私政策.docx")).toBe("privacy");
    expect(classifyDocumentGenre("费用.xlsx")).toBe("spreadsheet");
  });

  it("lets pleading headers beat contract clauses in the same peek", () => {
    const peek =
      "民事起诉状\n原告：甲\n被告：乙\n诉讼请求：解除《买卖合同》并支付违约金。甲方乙方鉴于。";
    expect(classifyDocumentGenre("材料.docx", peek)).toBe("pleading");
    expect(classifyDocumentGenre("补充协议.docx", peek)).toBe("pleading");
  });

  it("does not reclassify a contract filename because the peek mentions an invoice number", () => {
    const peek = "甲方：A。乙方：B。发票号码：12345678。第七条 违约责任。";
    expect(classifyDocumentGenre("买卖合同.docx", peek)).toBe("contract");
  });

  it("keeps a real contract when peek has 甲方/乙方 without 诉讼请求", () => {
    const peek = "甲方：A公司。乙方：B公司。鉴于双方合作，特订立本协议。第七条 违约责任。";
    expect(classifyDocumentGenre("合作.docx", peek)).toBe("contract");
  });

  it("treats sticky pleading as dominant over unknown attachments", () => {
    expect(dominantDocumentGenre(["unknown", "pleading", "unknown"])).toBe("pleading");
    expect(genresConflictContractVsPleading(["contract", "pleading"])).toBe(true);
  });

  it("skips contract-family Word checklists on pleadings and letters", () => {
    expect(wordRevisionShouldInjectFamilyChecklist("帮我改一下", ["民事起诉状.docx"])).toBe(false);
    expect(wordRevisionShouldInjectFamilyChecklist("修改合同", ["买卖合同.docx"])).toBe(true);
  });
});
