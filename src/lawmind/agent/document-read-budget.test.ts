import { describe, expect, it } from "vitest";
import { wrapUntrustedDocumentContent } from "../platform/content-trust.js";
import {
  UNTRUSTED_WRAPPER_OVERHEAD_CHARS,
  resolveDocumentPageChars,
  resolveDocumentReadBudgetChars,
  resolveFolderPerFileChars,
} from "./document-read-budget.js";
import { resolveToolResultHistoryTokens } from "./tool-result-history.js";

describe("document-read-budget", () => {
  it("derives the read budget from the model window (never a hardcoded small number)", () => {
    // 未知窗口回退 8k；128k 窗口 12.8k；超大窗口受工具结果预算封顶 25.6k。
    expect(resolveDocumentReadBudgetChars(undefined)).toBe(8_000);
    expect(resolveDocumentReadBudgetChars(128_000)).toBe(12_800);
    expect(resolveDocumentReadBudgetChars(1_000_000)).toBe(25_600);
    // 小窗口：保底 8k 让位于工具结果预算（16k 上下文 → 4k），否则必被裁剪。
    expect(resolveDocumentReadBudgetChars(16_000)).toBe(4_000);
  });

  it("stays within the tool-result budget the pipeline enforces", () => {
    // 读取预算不能超过工具结果预算，否则回包必被裁剪。
    for (const contextTokens of [undefined, 16_000, 32_000, 128_000, 200_000, 1_000_000]) {
      expect(resolveDocumentReadBudgetChars(contextTokens)).toBeLessThanOrEqual(
        resolveToolResultHistoryTokens(contextTokens),
      );
    }
  });

  it("deducts the anti-injection wrapper so the wrapped payload equals the budget", () => {
    const body = resolveDocumentPageChars(undefined);
    expect(resolveDocumentReadBudgetChars(undefined) - body).toBe(UNTRUSTED_WRAPPER_OVERHEAD_CHARS);
    expect(wrapUntrustedDocumentContent("x".repeat(body)).length).toBe(
      resolveDocumentReadBudgetChars(undefined),
    );
  });

  it("can skip the wrapper deduction for batch payloads that are not wrapped per item", () => {
    expect(resolveDocumentPageChars(undefined, { overheadChars: 0 })).toBe(
      resolveDocumentReadBudgetChars(undefined),
    );
  });

  it("splits the budget so a folder read fits at least two files per call", () => {
    const budget = resolveDocumentReadBudgetChars(undefined);
    const perFile = resolveFolderPerFileChars(undefined);
    expect(perFile).toBeLessThanOrEqual(budget);
    expect(perFile * 2).toBeLessThanOrEqual(budget + perFile);
    expect(perFile).toBeGreaterThanOrEqual(2_000);
  });
});
