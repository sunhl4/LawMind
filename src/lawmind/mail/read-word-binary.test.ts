import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { isBinaryWordDocPath, readBinaryWordDocText } from "./read-word-binary.js";

describe("read-word-binary", () => {
  it("detects binary .doc vs .docx", () => {
    expect(isBinaryWordDocPath("a.doc")).toBe(true);
    expect(isBinaryWordDocPath("a.docx")).toBe(false);
  });

  it("extracts text from a real .doc without writing a sibling .docx", async () => {
    const sample =
      "/Users/shl/nvidia/LawMind/cases/临时讨论/mail/attachments/imap-00033dd9-1411872887/国浩审-20260730-合作协议_普华小华_20260625_sx004_.doc";
    if (!fs.existsSync(sample) || process.platform !== "darwin") {
      return;
    }
    const siblingDocx = sample.replace(/\.doc$/i, ".docx");
    const existedBefore = fs.existsSync(siblingDocx);
    const text = await readBinaryWordDocText(sample);
    expect(text).toMatch(/合作协议|小华|普华/);
    if (!existedBefore) {
      expect(fs.existsSync(siblingDocx)).toBe(false);
    }
  });
});
