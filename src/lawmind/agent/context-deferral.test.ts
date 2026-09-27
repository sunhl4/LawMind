import { describe, expect, it } from "vitest";
import {
  CONTEXT_DEFERRAL_BOUNCE_MARKER,
  dropContextDeferralBounces,
  formatContextDeferralBounce,
  formatContextDeferralHandoff,
  isContextBudgetDeferralReply,
  isContextDeferralBounceMessage,
} from "./context-deferral.js";

/** 客户事故原文（截图）：竞业限制解除条款 / 三方义务分配，请另开一轮。 */
const CUSTOMER_DEFERRAL =
  "说明：本轮上下文预算已接近上限，若需我起草或修改具体条款（竞业限制解除条款、三方义务分配），请另开一轮并告知协议主体结构，我会直接落到 Word 稿。";

describe("isContextBudgetDeferralReply", () => {
  it("识别客户事故原文", () => {
    expect(isContextBudgetDeferralReply(CUSTOMER_DEFERRAL)).toBe(true);
  });

  it("识别其它把活儿退回律师的变体", () => {
    expect(isContextBudgetDeferralReply("上下文已接近上限，请重开会话再继续。")).toBe(true);
    expect(isContextBudgetDeferralReply("窗口快满了，建议分次交办。")).toBe(true);
    expect(isContextBudgetDeferralReply("token 不足，下一轮再发材料吧。")).toBe(true);
    // 放宽后要覆盖的真实变体（早期只认「另开一轮」等少数说法，这些会溜到律师面前）。
    expect(isContextBudgetDeferralReply("说明：本轮内容过多，建议分两次处理，先给主体部分。")).toBe(
      true,
    );
    expect(isContextBudgetDeferralReply("为避免篇幅过长，本次先到这里，下次继续。")).toBe(true);
    expect(isContextBudgetDeferralReply("会话窗口有限，建议分批交办。")).toBe(true);
    expect(isContextBudgetDeferralReply("本条指令涉及材料较多，可否拆段处理？")).toBe(true);
  });

  it("放宽后仍不误伤：法律正文里的「分批 / 分段 / 分次」不算退让", () => {
    // 这两组词在合同与程序里都常见，只有同时命中「水线」类词才算退让。
    expect(isContextBudgetDeferralReply("价款分两次支付，首期 30%。")).toBe(false);
    expect(isContextBudgetDeferralReply("判决分两段说理，第二段关于违约金。")).toBe(false);
    expect(isContextBudgetDeferralReply("建议分批次交货，每批验收后付款。")).toBe(false);
    expect(isContextBudgetDeferralReply("仲裁请求可分段主张，先主张货款。")).toBe(false);
  });

  it("不把正常交付 / 法律正文里的「预算」误判", () => {
    expect(
      isContextBudgetDeferralReply("已按检索结果写完解除条款与三方义务分配，交付见在办。"),
    ).toBe(false);
    // 只命中「预算」而没有把活儿退回律师：不是退让。
    expect(isContextBudgetDeferralReply("本案预算分次支付，首期款见附件台账。")).toBe(false);
    // 只命中「另开一轮」而没有上下文水位：不是退让。
    expect(isContextBudgetDeferralReply("若对方拒绝，可另开一轮谈判并重新报价。")).toBe(false);
    // 水位词 + 合同里的「分两次支付」不是把活儿退回律师。
    expect(
      isContextBudgetDeferralReply("合同内容较多，价款分两次支付，首期于签署后五个工作日内付清。"),
    ).toBe(false);
    expect(isContextBudgetDeferralReply("")).toBe(false);
    expect(isContextBudgetDeferralReply("好的。")).toBe(false);
  });
});

describe("formatContextDeferralBounce", () => {
  it("以标记开头，并写明运行时负责整理、不得退回律师", () => {
    const text = formatContextDeferralBounce();
    expect(text.startsWith(CONTEXT_DEFERRAL_BOUNCE_MARKER)).toBe(true);
    expect(text).toContain("工具轮边界");
    expect(text).toContain("另开一轮");
  });
});

describe("formatContextDeferralHandoff", () => {
  it("只写可核对的事实，不替模型掩饰、也不编进度", () => {
    const text = formatContextDeferralHandoff({
      toolCallsExecuted: 7,
      planOpen: ["写解除条款", "分配三方义务"],
      compactCount: 3,
    });
    expect(text).toContain("本轮已执行 7 次工具调用");
    expect(text).toContain("清单未完成：写解除条款；分配三方义务");
    expect(text).toContain("这段对话已整理过 3 次上下文");
    // 必须给出正确的继续方式（带上文新对话），而不是让律师自己猜。
    expect(text).toContain("另起新对话（带上文）");
    expect(text).toContain("草稿、案件档案与待办都留在原处");
    // 不假装完成。
    expect(text).not.toContain("已完成");
  });

  it("没有清单时如实说没有，不编一个", () => {
    const text = formatContextDeferralHandoff({ toolCallsExecuted: 0 });
    expect(text).toContain("没有留下可核对的清单");
    expect(text).not.toContain("这段对话已整理过");
  });

  it("清单过长时截断并标明还有更多", () => {
    const text = formatContextDeferralHandoff({
      toolCallsExecuted: 1,
      planOpen: Array.from({ length: 12 }, (_, i) => `步骤${i}`),
    });
    expect(text).toContain("步骤7");
    expect(text).not.toContain("步骤8");
    expect(text).toContain("等");
  });
});

describe("dropContextDeferralBounces", () => {
  it("只清退让反弹，不碰律师真实提问与 same-turn verify 打回", () => {
    const messages = [
      { role: "user" as const, content: "起草竞业限制解除条款", timestamp: "t" },
      { role: "assistant" as const, content: "…", timestamp: "t" },
      {
        role: "user" as const,
        content: formatContextDeferralBounce(),
        timestamp: "t",
        hiddenFromLawyer: true,
      },
      {
        role: "user" as const,
        content: "【同一回合验收未过】验证器未绿",
        timestamp: "t",
        hiddenFromLawyer: true,
      },
    ];
    const kept = dropContextDeferralBounces(messages);
    expect(kept.map((m) => m.content)).toEqual([
      "起草竞业限制解除条款",
      "…",
      "【同一回合验收未过】验证器未绿",
    ]);
    expect(
      isContextDeferralBounceMessage(messages[2] ?? { role: "user", content: "", timestamp: "" }),
    ).toBe(true);
    expect(
      isContextDeferralBounceMessage(messages[3] ?? { role: "user", content: "", timestamp: "" }),
    ).toBe(false);
  });

  it("律师真实消息即使提到上下文预算也不会被当成反弹清掉", () => {
    const lawyer = {
      role: "user" as const,
      content: "上下文预算已接近上限，请另开一轮",
      timestamp: "t",
    };
    expect(isContextDeferralBounceMessage(lawyer)).toBe(false);
    expect(dropContextDeferralBounces([lawyer])).toHaveLength(1);
  });
});
