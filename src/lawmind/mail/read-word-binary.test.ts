import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  extractTextWithRevisionsFromDocBytes,
  isBinaryWordDocPath,
  readBinaryWordDocText,
  stripWordControlChars,
} from "./read-word-binary.js";

const FIXTURE = fileURLToPath(new URL("./fixtures/tracked-changes-5-authors.doc", import.meta.url));

describe("read-word-binary", () => {
  it("detects binary .doc vs .docx", () => {
    expect(isBinaryWordDocPath("a.doc")).toBe(true);
    expect(isBinaryWordDocPath("a.docx")).toBe(false);
  });

  it("extracts body text from a real .doc container", async () => {
    const text = await readBinaryWordDocText(FIXTURE);
    expect(text).toContain("履约保函");
    expect(text).toContain("发包人、建设单位及其控股股东均有权提取");
  });

  it("reads five authors' tracked changes without merging them", () => {
    const result = extractTextWithRevisionsFromDocBytes(fs.readFileSync(FIXTURE));
    expect(result.hasTrackedChanges).toBe(true);
    expect(result.revisions.map((r) => r.author)).toEqual([
      "张律师",
      "李律师",
      "王律师",
      "赵律师",
      "陈律师",
    ]);
    expect(result.revisions.map((r) => r.kind)).toEqual(["del", "ins", "del", "ins", "del"]);
    expect(result.revisions.map((r) => r.text)).toEqual([
      "删除甲甲",
      "插入乙乙",
      "删除丙丙",
      "插入丁丁",
      "删除戊戊",
    ]);
    expect(result.revisions[0]?.date).toBe("2026-10-17T09:30:00.000Z");
  });

  it("accepts inserted runs and drops deleted runs", () => {
    const result = extractTextWithRevisionsFromDocBytes(fs.readFileSync(FIXTURE));
    expect(result.acceptedText).toContain("插入乙乙");
    expect(result.acceptedText).toContain("插入丁丁");
    expect(result.acceptedText).not.toContain("删除甲甲");
    expect(result.acceptedText).not.toContain("删除戊戊");
  });
});

describe("stripWordControlChars", () => {
  it("drops field instructions and keeps the visible result", () => {
    // 0x13 指令 0x14 结果 0x15：只留结果，PAGE 指令不得进正文。
    const raw = `第\u0013 PAGE \\* MERGEFORMAT \u001472\u0015页，付款基数`;
    expect(stripWordControlChars(raw)).toBe("第72页，付款基数");
  });

  it("turns cell marks into tabs and drops picture/OLE anchors", () => {
    expect(stripWordControlChars("甲\u0007乙\u0001丙")).toBe("甲\t乙丙");
  });

  it("removes control bytes that are illegal in docx xml", () => {
    // \u0002 \u0008 非法；\u0013..\u0014 是指令段，整段丢弃。
    const cleaned = stripWordControlChars("a\u0002b\u0008c\u0013\tx\u0014y");
    expect(cleaned).toBe("abcy");
    for (const ch of cleaned) {
      expect(ch.charCodeAt(0)).toBeGreaterThanOrEqual(0x09);
    }
  });
});
