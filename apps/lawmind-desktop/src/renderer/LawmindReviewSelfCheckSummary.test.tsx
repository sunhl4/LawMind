/**
 * @vitest-environment jsdom
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { LawmindReviewSelfCheckSummary } from "./LawmindReviewSelfCheckSummary";
import type { LegalLintReport } from "../../../../src/lawmind/lint/types.ts";

function report(partial: Partial<LegalLintReport>): LegalLintReport {
  return {
    schemaVersion: 1,
    checkedAt: "2026-08-29T00:00:00.000Z",
    coverageNote: "本次机械核对 10 项。通过 ≠ 法律正确。",
    ruleCount: 10,
    findings: [],
    blockerCount: 0,
    warningCount: 0,
    failedRules: [],
    summaryZh: "机械核对未见已知缺陷。",
    ...partial,
  };
}

describe("LawmindReviewSelfCheckSummary", () => {
  it("shows mechanical lint blockers", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(
        <LawmindReviewSelfCheckSummary
          acceptance={null}
          citation={null}
          lintReport={report({ blockerCount: 2, warningCount: 1 })}
        />,
      );
    });
    expect(host.querySelector('[data-testid="lm-review-lint-line"]')?.textContent).toBe(
      "机械核对：2 项须处理",
    );
    act(() => {
      root.unmount();
    });
    host.remove();
  });

  it("shows the self-revise residual line in lawyer Chinese", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(
        <LawmindReviewSelfCheckSummary
          acceptance={null}
          citation={null}
          lintReport={report({ blockerCount: 0, warningCount: 1 })}
          selfRevise={{ summaryZh: "已做格式规范化 1 处；3 处需你定夺" }}
        />,
      );
    });
    expect(host.querySelector('[data-testid="lm-review-self-revise-line"]')?.textContent).toBe(
      "已做格式规范化 1 处；3 处需你定夺",
    );
    act(() => {
      root.unmount();
    });
    host.remove();
  });
});
