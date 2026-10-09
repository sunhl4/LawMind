import { describe, expect, it } from "vitest";
import {
  ISSUE_LEDGER_MARKER,
  formatIssueLedgerBlock,
  instructionNeedsIssueLedger,
} from "./issue-ledger.js";

describe("issue ledger", () => {
  it("applies to a review of agreements and to a Chinese contract review", () => {
    expect(
      instructionNeedsIssueLedger(
        "Review the attached employment agreement and summarize restrictive covenants in a structured memo.",
      ),
    ).toBe(true);
    expect(
      instructionNeedsIssueLedger(
        "Review the draft separation agreement and flag issues in a categorized memo.",
      ),
    ).toBe(true);
    expect(instructionNeedsIssueLedger("请审查这份采购合同")).toBe(true);
  });

  it("does not apply to a numeric file the lawyer named", () => {
    expect(instructionNeedsIssueLedger("把金额写入 amount.txt，文件里只能有数字。")).toBe(false);
  });

  it("names the three things the memo must keep", () => {
    const block = formatIssueLedgerBlock();
    expect(block).toContain(ISSUE_LEDGER_MARKER);
    expect(block).toContain("不能省");
    expect(block).toContain("冲突");
    expect(block).toContain("未见");
    expect(block).toContain("改法");
    expect(block).toContain("write_document");
    expect(block).toContain("效力与执行风险");
  });
});
