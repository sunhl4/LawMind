import { describe, expect, it } from "vitest";
import type { LawMindWorkspacePolicy } from "../policy/workspace-policy.js";
import { accumulateFactPin, extractFactPinItems, mergeFactPinItems } from "./compact-fact-pin.js";
import { resolveContextTuning } from "./context-tuning.js";
import type { AgentMessage } from "./types.js";

function pinsTuning(pins: unknown) {
  return resolveContextTuning({ schemaVersion: 1, context: { pins } } as LawMindWorkspacePolicy)
    .pins;
}

describe("extractFactPinItems — 日历截止日", () => {
  it("没有「期限」二字的起诉截止日仍整句钉住", () => {
    const items = extractFactPinItems("须于2026年9月30日前提起仲裁。价款分两次支付。");
    expect(items.map((item) => item.kind)).toContain("deadline");
    expect(items.some((item) => item.text.includes("2026年9月30日前"))).toBe(true);
  });

  it("指导案例整句可钉", () => {
    const items = extractFactPinItems("赔偿口径参照指导案例24号。");
    expect(items.map((item) => item.kind)).toContain("citation");
    expect(items.some((item) => item.text.includes("指导案例24号"))).toBe(true);
  });

  it("签订日期不是期限", () => {
    const items = extractFactPinItems("本合同签订于2024年1月1日。");
    expect(items.filter((item) => item.kind === "deadline")).toHaveLength(0);
  });
});

describe("compact-fact-pin — 调参（policy context.pins.*）真的生效", () => {
  it("factMaxItems / factTotalCharCap 由 policy 决定", () => {
    const text = [
      "仲裁时效为一年。",
      "月补偿 9800 元。",
      "乙方不得解除保密义务。",
      "依据《劳动合同法》第23条。",
      "违约金上限为 5 万元。",
    ].join("");
    const items = extractFactPinItems(text);
    expect(items.length).toBeGreaterThan(2);

    const tight = pinsTuning({ factMaxItems: 1, factTotalCharCap: 100 });
    const capped = mergeFactPinItems([], items, tight);
    expect(capped).toHaveLength(1);

    // 默认则保留更多（行为不变）。
    expect(mergeFactPinItems([], items).length).toBeGreaterThan(1);
  });

  it("超过 factItemCharCap 的句子整句不钉", () => {
    const sentence = `${"冗长的背景描述，".repeat(20)}该期限为 30 日。`;
    const tight = pinsTuning({ factItemCharCap: 30 });
    expect(extractFactPinItems(sentence, tight)).toEqual([]);
    const whole = "仲裁时效为一年。";
    expect(extractFactPinItems(whole, tight).map((item) => item.text)).toEqual([whole]);
  });

  it("factEnabled=false 时不再累积，但已有台账保留", () => {
    const msg: AgentMessage = { role: "user", content: "仲裁时效为一年。", timestamp: "t" };
    const session = {
      conversationHistory: [msg],
      factPin: { items: extractFactPinItems(msg.content), updatedAt: "t" },
    };
    const before = session.factPin.items.length;
    const result = accumulateFactPin(session, [msg], pinsTuning({ factEnabled: false }));
    expect(result.added).toBe(0);
    expect(session.factPin.items).toHaveLength(before);
  });

  it("factCitationAnchorMax 由 policy 决定（0 = 不召回引用锚点）", () => {
    const toolMsg: AgentMessage = {
      role: "tool",
      content: JSON.stringify({ data: "《劳动合同法》第23条 与 《劳动合同法》第24条" }),
      timestamp: "t",
    };
    const session = { conversationHistory: [toolMsg] };
    const result = accumulateFactPin(session, [toolMsg], pinsTuning({ factCitationAnchorMax: 0 }));
    expect(result.total).toBe(0);
  });
});
