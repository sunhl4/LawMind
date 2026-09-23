import { describe, expect, it } from "vitest";
import { COMPACT_REINJECTION_MARKER } from "./compact-insert.js";
import {
  estimateMessageTokens,
  estimateTextTokens,
  estimateTokenBudget,
  estimateTokenBudgetBreakdown,
} from "./context-budget.js";
import type { AgentMessage, AgentSession } from "./types.js";
import { wrapWorldStateSection } from "./world-state.js";

function sessionWithChars(chars: number): AgentSession {
  return {
    sessionId: "s-budget",
    actorId: "lawyer",
    turns: [],
    conversationHistory: [
      {
        role: "user",
        content: "x".repeat(chars),
        timestamp: "2026-01-01T00:00:00.000Z",
      },
    ],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("estimateTokenBudget", () => {
  it("uses model contextTokens for effectiveLimit", () => {
    const session = sessionWithChars(100);
    const small = estimateTokenBudget(session, null, { contextTokens: 32_768 });
    const large = estimateTokenBudget(session, null, { contextTokens: 131_072 });
    expect(large.effectiveLimit).toBeGreaterThan(small.effectiveLimit);
  });

  it("marks compact when usage exceeds effective limit", () => {
    // Force compact: huge message vs tiny window after reserves.
    const session = sessionWithChars(400_000);
    const budget = estimateTokenBudget(session, null, { contextTokens: 16_000 });
    expect(budget.level).toBe("compact");
  });

  it("counts samplingPromptTail toward used tokens", () => {
    const session = sessionWithChars(100);
    const without = estimateTokenBudget(session, null, { contextTokens: 32_768 });
    session.samplingPromptTail = "合".repeat(200);
    const withTail = estimateTokenBudget(session, null, { contextTokens: 32_768 });
    expect(withTail.used).toBe(without.used + 200);
  });

  it("小窗口的预留随窗口缩放：32k 不再只剩 8k 可用", () => {
    const session = sessionWithChars(100);
    // 写死 20k + 13k 时 32k 窗口会被压到 8k 下限（回合内压缩腾不出空间）。
    const small = estimateTokenBudget(session, null, { contextTokens: 32_000 });
    expect(small.effectiveLimit).toBe(24_000);
    const tiny = estimateTokenBudget(session, null, { contextTokens: 16_000 });
    expect(tiny.effectiveLimit).toBe(12_000);
    // 大窗口保持既有预留绝对值（行为不变）。
    const large = estimateTokenBudget(session, null, { contextTokens: 200_000 });
    expect(large.effectiveLimit).toBe(200_000 - 33_000);
  });

  it("快照带上 warnRatio，且可由 policy 调（旧默认 0.85）", () => {
    const session = sessionWithChars(100);
    expect(estimateTokenBudget(session, null, { contextTokens: 32_000 }).warnRatio).toBe(0.85);

    const policy = {
      schemaVersion: 1,
      context: { warnRatio: 0.7, midTurnCompactTriggerRatio: 0.9 },
    } as const;
    const tuned = estimateTokenBudget(session, policy, { contextTokens: 32_000 });
    expect(tuned.warnRatio).toBe(0.7);
    // 68k 字符 ≈ 17k token / 24k 可用 = 0.708：过了 0.7 的线，但没过默认 0.85。
    const nearLine = sessionWithChars(68_000);
    expect(estimateTokenBudget(nearLine, policy, { contextTokens: 32_000 }).level).toBe("warn");
    expect(estimateTokenBudget(nearLine, null, { contextTokens: 32_000 }).level).toBe("ok");
  });

  it("小窗口预留比例 / 有效窗口下限可由 policy 调", () => {
    const session = sessionWithChars(100);
    const policy = {
      schemaVersion: 1,
      context: {
        smallWindowReserveRatio: 0.5,
        minEffectiveLimitTokens: 2_000,
      },
    } as const;
    // 32k 窗口、预留 = 32k*0.5 = 16k → 可用 16k（默认是 24k）。
    expect(estimateTokenBudget(session, policy, { contextTokens: 32_000 }).effectiveLimit).toBe(
      16_000,
    );
  });
});

describe("estimateTokenBudgetBreakdown", () => {
  it("各桶之和严格等于 used（含本轮上下文尾部）", () => {
    const session: AgentSession = {
      sessionId: "s-breakdown",
      actorId: "lawyer",
      turns: [],
      conversationHistory: [
        { role: "system", content: "系统提示".repeat(50), timestamp: "t" },
        { role: "user", content: "审查这份合同", timestamp: "t" },
        { role: "assistant", content: "先读材料。", timestamp: "t" },
        {
          role: "tool",
          content: JSON.stringify({ ok: true, data: "材料正文".repeat(30) }),
          timestamp: "t",
        },
      ],
      createdAt: "t",
      updatedAt: "t",
    };
    session.samplingPromptTail = "## 当前案件 [m1]\n\n索引";

    const breakdown = estimateTokenBudgetBreakdown(session);
    const budget = estimateTokenBudget(session, null, { contextTokens: 128_000 });
    expect(breakdown.total).toBe(budget.used);
  });

  it("合成压缩消息归 digest，律师真实提问归 lawyer", () => {
    const session: AgentSession = {
      sessionId: "s-buckets",
      actorId: "lawyer",
      turns: [],
      conversationHistory: [
        { role: "system", content: "sys", timestamp: "t" },
        { role: "user", content: "律师真说过的话", timestamp: "t" },
        { role: "user", content: "【压缩前对话蒸馏】丢弃 3 条……要点", timestamp: "t" },
        { role: "user", content: `## ${COMPACT_REINJECTION_MARKER}`, timestamp: "t" },
        { role: "assistant", content: "助手回复", timestamp: "t" },
        { role: "tool", content: "{}", timestamp: "t" },
      ],
      createdAt: "t",
      updatedAt: "t",
    };
    const byId = new Map(
      estimateTokenBudgetBreakdown(session).buckets.map((b) => [b.id, b.tokens]),
    );
    expect(byId.get("lawyer")).toBe(7);
    expect(byId.get("digest")).toBeGreaterThan(0);
    expect(byId.get("assistant")).toBe(4);
    expect(byId.get("toolResults")).toBeGreaterThan(0);
  });

  it("世界状态段落按 id 拆开：pins / plan / craft 各自成桶", () => {
    const system = [
      "静态提示正文",
      wrapWorldStateSection("pins", "钉选合同路径 cases/m/合同.docx"),
      wrapWorldStateSection("plan", "- [进行中] 读合同"),
      wrapWorldStateSection("craft", "红线重注内容"),
      wrapWorldStateSection("deliverable", "交付物：审查意见"),
    ].join("\n\n");
    const session: AgentSession = {
      sessionId: "s-ws",
      actorId: "lawyer",
      turns: [],
      conversationHistory: [{ role: "system", content: system, timestamp: "t" }],
      createdAt: "t",
      updatedAt: "t",
    };
    const byId = new Map(
      estimateTokenBudgetBreakdown(session).buckets.map((b) => [b.id, b.tokens]),
    );
    expect(byId.get("pins")).toBeGreaterThanOrEqual(
      estimateTextTokens("钉选合同路径 cases/m/合同.docx"),
    );
    expect(byId.get("plan")).toBeGreaterThanOrEqual(estimateTextTokens("- [进行中] 读合同"));
    expect(byId.get("craft")).toBeGreaterThanOrEqual(estimateTextTokens("红线重注内容"));
    // policy/deliverable/permission/matter 归 workspace，不进 rules。
    expect(byId.get("workspace")).toBeGreaterThanOrEqual(estimateTextTokens("交付物：审查意见"));
    // 标记（`<!--lm-ws:id-->`）算在各段自己头上：rules 只剩静态正文 + 段间空行。
    expect(byId.get("rules")).toBeGreaterThanOrEqual(estimateTextTokens("静态提示正文"));
    expect(byId.get("rules")).toBeLessThan(estimateTextTokens("静态提示正文") + 8);
  });
});

describe("estimateTextTokens (CJK-aware)", () => {
  it("counts Chinese text at ~1 token per character (not chars/4)", () => {
    const text = "合".repeat(100);
    expect(estimateTextTokens(text)).toBe(100);
  });

  it("keeps ASCII at ~4 chars per token", () => {
    expect(estimateTextTokens("x".repeat(400))).toBe(100);
  });

  it("sums CJK and ASCII segments separately for mixed text", () => {
    // 5 个 CJK 字（合同金额万）+ 5 个 ASCII（空格、数字）→ 5 + ceil(5/4)。
    expect(estimateTextTokens("合同金额 100 万")).toBe(7);
  });

  it("counts fullwidth punctuation and surrogate-pair ideographs as one token each", () => {
    expect(estimateTextTokens("，。！")).toBe(3);
    expect(estimateTextTokens("𠀀")).toBe(1);
    expect(estimateTextTokens("𠀀a")).toBe(2);
  });

  it("honors a custom charsPerToken for the non-CJK segment", () => {
    expect(estimateTextTokens("x".repeat(10), 2)).toBe(5);
    expect(estimateTextTokens("合同" + "x".repeat(10), 2)).toBe(7);
  });
});

describe("estimateMessageTokens (CJK-aware)", () => {
  it("estimates Chinese conversation history at character magnitude", () => {
    const messages: AgentMessage[] = [
      { role: "user", content: "合".repeat(100), timestamp: "t" },
      { role: "assistant", content: "x".repeat(40), timestamp: "t" },
    ];
    // 100 个汉字 ≈ 100 token + 40 ASCII ≈ 10 token；旧口径会低估为 35。
    expect(estimateMessageTokens(messages)).toBe(110);
  });
});
