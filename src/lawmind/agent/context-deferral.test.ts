import { describe, expect, it } from "vitest";
import {
  CONTEXT_DEFERRAL_BOUNCE_MARKER,
  dropContextDeferralBounces,
  formatContextDeferralBounce,
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
  });

  it("不把正常交付 / 法律正文里的「预算」误判", () => {
    expect(
      isContextBudgetDeferralReply("已按检索结果写完解除条款与三方义务分配，交付见在办。"),
    ).toBe(false);
    // 只命中「预算」而没有把活儿退回律师：不是退让。
    expect(isContextBudgetDeferralReply("本案预算分次支付，首期款见附件台账。")).toBe(false);
    // 只命中「另开一轮」而没有上下文水位：不是退让。
    expect(isContextBudgetDeferralReply("若对方拒绝，可另开一轮谈判并重新报价。")).toBe(false);
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
