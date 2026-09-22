import { describe, expect, it } from "vitest";
import {
  classifyContractAttachment,
  isMailImageAttachment,
  isReviewableContractAttachment,
  isTrackedWordAttachment,
} from "./mail-contract-formats.js";

describe("mail-contract-formats", () => {
  it("treats .doc and .docx as first-class tracked Word baselines", () => {
    expect(classifyContractAttachment("a.docx")).toBe("tracked_word");
    expect(classifyContractAttachment("a.doc")).toBe("tracked_word");
    expect(isTrackedWordAttachment("合同.doc")).toBe(true);
    expect(isTrackedWordAttachment("合同.docx")).toBe(true);
  });

  it("classifies other formats", () => {
    expect(classifyContractAttachment("a.wps")).toBe("convertible_word");
    expect(classifyContractAttachment("a.pdf")).toBe("analyzable");
    expect(classifyContractAttachment("scan.PNG")).toBe("analyzable");
    expect(classifyContractAttachment("clip.mp4")).toBe("other");
  });

  it("flags reviewable and image helpers", () => {
    expect(isReviewableContractAttachment("合同.pdf")).toBe(true);
    expect(isMailImageAttachment("a.jpg")).toBe(true);
    expect(isMailImageAttachment("a.pdf")).toBe(false);
  });
});
