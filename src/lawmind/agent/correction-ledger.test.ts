import { describe, expect, it } from "vitest";
import { buildCorrectionRecord, summarizeCorrectionRecords } from "./correction-ledger.js";

describe("correction ledger (docs/量子启发.md §二(5), 可执行清单 #4)", () => {
  it("records an「不对」with anchors, cone anchors, and revert results", () => {
    const record = buildCorrectionRecord({
      sessionId: "s1",
      turnId: "t1",
      lawyerNote: "补偿金额不对",
      namedAnchors: ["amount:economic_compensation", "amount:economic_compensation"],
      coneAnchors: ["amount:economic_compensation", "amount:wage"],
      reverts: [
        { anchor: "amount:economic_compensation", ok: true },
        { anchor: "amount:wage", ok: true },
      ],
    });
    expect(record.namedAnchors).toEqual(["amount:economic_compensation"]);
    expect(record.coneAnchors).toEqual(["amount:economic_compensation", "amount:wage"]);
    expect(record.outcome).toBe("reverted");
    expect(record.reason).toBeNull();
    expect(record.lawyerNote).toBe("补偿金额不对");
  });

  it("derives partial when some reverts fail and keeps the failure detail", () => {
    const record = buildCorrectionRecord({
      lawyerNote: "称谓用错了",
      namedAnchors: ["party:承包人"],
      reverts: [
        { anchor: "party:承包人", ok: false, detail: "同一替换词出现 3 次，次数对不上，未动" },
      ],
    });
    expect(record.outcome).toBe("partial");
    expect(summarizeCorrectionRecords([record]).revertFailed).toBe(1);
  });

  it("keeps kept-with-no-data visible instead of silently dropping the correction", () => {
    const record = buildCorrectionRecord({ lawyerNote: "管辖写错了" });
    expect(record.outcome).toBe("kept");
    expect(record.reverts).toEqual([]);
    const digest = summarizeCorrectionRecords([record]);
    expect(digest.byOutcome.kept).toBe(1);
    expect(digest.revertAttempts).toBe(0);
  });

  it("never auto-labels the reason, even when the note mentions money", () => {
    const records = [
      buildCorrectionRecord({ lawyerNote: "金额不对，应该是二十万" }),
      buildCorrectionRecord({ lawyerNote: "改成 8.8 万更顺口" }),
    ];
    expect(records.map((record) => record.reason)).toEqual([null, null]);
    expect(summarizeCorrectionRecords(records).unclassified).toBe(2);
  });

  it("normalizes whitespace in the note and drops empty anchors", () => {
    const record = buildCorrectionRecord({
      lawyerNote: "  这个\n金额  不对  ",
      namedAnchors: ["  ", "amount:wage", "amount:wage"],
    });
    expect(record.lawyerNote).toBe("这个 金额 不对");
    expect(record.namedAnchors).toEqual(["amount:wage"]);
  });

  it("truncates the stored note to a bounded single line", () => {
    const record = buildCorrectionRecord({ lawyerNote: "不".repeat(500) });
    expect(record.lawyerNote.length).toBe(160);
  });

  it("summarizes a mixed batch", () => {
    const digest = summarizeCorrectionRecords([
      buildCorrectionRecord({
        reverts: [
          { anchor: "amount:wage", ok: true },
          { anchor: "amount:interest", ok: true },
        ],
      }),
      buildCorrectionRecord({
        reverts: [{ anchor: "party:发包人", ok: false, detail: "次数不齐" }],
      }),
      buildCorrectionRecord({ lawyerNote: "删掉这段表格" }),
    ]);
    expect(digest.total).toBe(3);
    expect(digest.byOutcome).toEqual({ reverted: 1, partial: 1, kept: 1 });
    expect(digest.revertAttempts).toBe(3);
    expect(digest.revertOk).toBe(2);
    expect(digest.revertFailed).toBe(1);
    expect(digest.unclassified).toBe(3);
  });
});
