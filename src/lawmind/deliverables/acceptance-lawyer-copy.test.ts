import { describe, expect, it } from "vitest";
import {
  buildAcceptanceChatPrompt,
  formatRenderGateRefusal,
  humanizeAcceptanceLabel,
} from "./acceptance-lawyer-copy.js";
import type { AcceptanceReport } from "./types.js";

describe("acceptance lawyer copy", () => {
  it("drops the section index and the keyword parenthetical", () => {
    expect(
      humanizeAcceptanceLabel(
        "section.0.合同主体",
        "写明出租人与承租人（关键词：合同主体 / 甲方）",
      ),
    ).toBe("还缺：写明出租人与承租人");
  });

  it("names export gaps instead of a component", () => {
    const text = formatRenderGateRefusal({
      acceptance: {
        checks: [
          {
            key: "section.2.租金",
            label: "租金与支付（关键词：租金）",
            passed: false,
            severity: "blocker",
            hint: "未发现对应章节。",
          },
          {
            key: "placeholders.resolved",
            label: "文中仍有未填项",
            passed: false,
            severity: "blocker",
          },
          {
            key: "criteria.coverage",
            label: "验收标准覆盖",
            passed: false,
            severity: "warning",
          },
        ],
      },
      reasoning: {
        required: true,
        ready: false,
        checks: [
          {
            key: "min_issues",
            label: "至少包含 2 个争点（当前 0）",
            passed: false,
            severity: "blocker",
          },
        ],
      },
    });
    expect(text.startsWith("还不能导出。")).toBe(true);
    expect(text).toContain("还缺：租金与支付");
    expect(text).toContain("标题或节首写上：租金");
    expect(text).toContain("文中仍有未填项");
    expect(text).toContain("提醒：必要章节还没齐，验收标准对不上");
    expect(text).toContain("至少包含 2 个争点（当前 0）");
    expect(text).not.toContain("LawmindAcceptanceGate");
    expect(text).not.toContain("双门禁");
    expect(text).not.toContain("关键词");
  });

  it("asks the conversation to fill the blockers", () => {
    const report: AcceptanceReport = {
      taskId: "t",
      ready: false,
      checks: [
        {
          key: "spec.not_found",
          label: "未登记",
          passed: false,
          severity: "blocker",
        },
      ],
      blockerCount: 1,
      warningCount: 0,
      placeholderCount: 0,
      placeholderSamples: [],
      generatedAt: "2026-09-24T00:00:00.000Z",
    };
    expect(buildAcceptanceChatPrompt(report)).toContain("未标明这是哪一类文书");
  });
});
