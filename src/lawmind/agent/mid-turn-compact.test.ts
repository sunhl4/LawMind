import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { LawMindWorkspacePolicy } from "../policy/workspace-policy.js";
import { compactDigestPath } from "./compact.js";
import { resolveContextTuning } from "./context-tuning.js";
import {
  applyMidTurnCompact,
  elideOversizedMessages,
  MID_TURN_COMPACT_MAX,
  midTurnBudgetOverTrigger,
  shouldCompactMidTurn,
} from "./mid-turn-compact.js";
import type { AgentMessage, AgentSession } from "./types.js";

function policyWith(context: unknown): LawMindWorkspacePolicy {
  return { schemaVersion: 1, context: context as LawMindWorkspacePolicy["context"] };
}

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  }
});

function makeWorkspace(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-midturn-"));
  tempDirs.push(dir);
  return dir;
}

function sessionWith(messages: AgentMessage[], matterId?: string): AgentSession {
  return {
    sessionId: "s-midturn",
    actorId: "lawyer",
    turns: [],
    matterId,
    conversationHistory: messages,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function longHistory(pairs: number): AgentMessage[] {
  const out: AgentMessage[] = [{ role: "system", content: "sys", timestamp: "t" }];
  for (let i = 0; i < pairs; i += 1) {
    out.push(
      { role: "user", content: `历史轮 ${i}：继续讨论付款节奏`, timestamp: "t" },
      { role: "assistant", content: `历史答 ${i}：可分期。`, timestamp: "t" },
    );
  }
  return out;
}

describe("shouldCompactMidTurn", () => {
  it("第一次采样前不整理（回合开始那次已经跑过）", () => {
    expect(
      shouldCompactMidTurn({
        roundIndex: 1,
        used: 95_000,
        effectiveLimit: 95_000,
        level: "compact",
        compactionsDone: 0,
      }),
    ).toBe(false);
    // 模型一上来就退让也一样：第 1 轮不重写历史，交给反弹处理。
    expect(
      shouldCompactMidTurn({
        roundIndex: 1,
        used: 95_000,
        effectiveLimit: 95_000,
        level: "compact",
        compactionsDone: 0,
        force: true,
      }),
    ).toBe(false);
  });

  it("越线（或达到触发比例）才整理，且受每回合上限约束", () => {
    const base = { roundIndex: 2, used: 80_000, effectiveLimit: 95_000 };
    expect(shouldCompactMidTurn({ ...base, level: "warn", compactionsDone: 0 })).toBe(false);
    expect(shouldCompactMidTurn({ ...base, level: "compact", compactionsDone: 0 })).toBe(true);
    expect(
      shouldCompactMidTurn({
        ...base,
        used: 86_000,
        level: "warn",
        compactionsDone: 0,
      }),
    ).toBe(true);
    expect(
      shouldCompactMidTurn({
        ...base,
        level: "compact",
        compactionsDone: MID_TURN_COMPACT_MAX,
      }),
    ).toBe(false);
    // 模型已证明没空间：跳过比例检查，但要服从上限。
    expect(
      shouldCompactMidTurn({ ...base, used: 1, level: "ok", compactionsDone: 0, force: true }),
    ).toBe(true);
    expect(
      shouldCompactMidTurn({
        ...base,
        used: 1,
        level: "ok",
        compactionsDone: MID_TURN_COMPACT_MAX,
        force: true,
      }),
    ).toBe(false);
  });

  it("midTurnBudgetOverTrigger：compact 级一律越线，其余按比例", () => {
    expect(midTurnBudgetOverTrigger({ used: 0, effectiveLimit: 95_000, level: "compact" })).toBe(
      true,
    );
    expect(midTurnBudgetOverTrigger({ used: 85_500, effectiveLimit: 95_000, level: "warn" })).toBe(
      true,
    );
    expect(midTurnBudgetOverTrigger({ used: 80_000, effectiveLimit: 95_000, level: "warn" })).toBe(
      false,
    );
    expect(
      midTurnBudgetOverTrigger({
        used: 40_000,
        effectiveLimit: 95_000,
        level: "ok",
        triggerRatio: 0.4,
      }),
    ).toBe(true);
  });

  it("provider 回报的真实占用高于估算时用它触发（估算偏小不再拖到满窗）", () => {
    const base = {
      roundIndex: 2,
      effectiveLimit: 95_000,
      level: "warn" as const,
      compactionsDone: 0,
    };
    expect(shouldCompactMidTurn({ ...base, used: 50_000 })).toBe(false);
    // 估算 50k，但 provider 说上一轮就已占 90k → 必须现在整理。
    expect(shouldCompactMidTurn({ ...base, used: 50_000, measuredUsed: 90_000 })).toBe(true);
    // 真实占用更小时不放宽：估算偏大也该整理（保守方向）。
    expect(shouldCompactMidTurn({ ...base, used: 90_000, measuredUsed: 10_000 })).toBe(true);
  });
});

describe("elideOversizedMessages（no_reduction 兜底）", () => {
  function sessionWith(
    contents: Array<{ role: "user" | "assistant"; text: string }>,
  ): AgentSession {
    const now = "t";
    return {
      sessionId: "s-elide",
      actorId: "lawyer",
      turns: [],
      conversationHistory: [
        { role: "system", content: "sys", timestamp: now },
        ...contents.map((c) => ({ role: c.role, content: c.text, timestamp: now })),
      ],
      createdAt: now,
      updatedAt: now,
    };
  }

  it("超大正文就地中间省略，头尾都留（不是砍尾）", () => {
    const head = "合同首部：甲方某某公司，案号（2026）京01民初123号。";
    const middle = "冗长条款正文。".repeat(3_000);
    const tail = "合同尾部：诉请金额 100 万元，具状人张三。";
    const session = sessionWith([
      { role: "user", text: head + middle + tail },
      { role: "assistant", text: "已读，请确认审查重点。" },
      { role: "assistant", text: "（随后两轮仍是当下在办的上下文）" },
    ]);

    const out = elideOversizedMessages(session, 32_000);
    expect(out.elidedCount).toBe(1);
    expect(out.charsRemoved).toBeGreaterThan(0);
    const content = session.conversationHistory[1]?.content ?? "";
    // 法律文书两端信息最密：两端必须都在（对齐 elideMiddle 的取向）。
    expect(content).toContain(head);
    expect(content).toContain(tail);
    expect(content).toContain("中间省略");
    expect(content.length).toBeLessThan((head + middle + tail).length);
  });

  it("不动尾部若干条（那是当下正在办的那几轮）", () => {
    const huge = "请".repeat(20_000);
    const session = sessionWith([
      { role: "user", text: huge },
      ...Array.from({ length: 8 }, () => ({ role: "user" as const, text: huge })),
    ]);
    elideOversizedMessages(session, 16_000);
    const tailMsg = session.conversationHistory[session.conversationHistory.length - 1];
    expect(tailMsg?.content).toBe(huge);
  });

  it("不碰 tool 消息（配对安全）", () => {
    const huge = "x".repeat(50_000);
    const now = "t";
    const session: AgentSession = {
      sessionId: "s",
      actorId: "lawyer",
      turns: [],
      conversationHistory: [
        { role: "system", content: "sys", timestamp: now },
        { role: "tool", content: huge, timestamp: now },
        { role: "user", content: huge, timestamp: now },
        { role: "assistant", content: "尾1", timestamp: now },
        { role: "assistant", content: "尾2", timestamp: now },
        { role: "assistant", content: "尾3", timestamp: now },
        { role: "assistant", content: "尾4", timestamp: now },
        { role: "assistant", content: "尾5", timestamp: now },
        { role: "assistant", content: "尾6", timestamp: now },
        { role: "assistant", content: "尾7", timestamp: now },
      ],
      createdAt: now,
      updatedAt: now,
    };
    elideOversizedMessages(session, 16_000);
    expect(session.conversationHistory[1]?.content).toBe(huge);
  });
});

describe("applyMidTurnCompact", () => {
  it("越线时在工具轮边界压缩，保留尾部、写 digest、置重注与审计位", () => {
    const workspaceDir = makeWorkspace();
    const session = sessionWith(longHistory(40), "m-midturn");
    const before = session.conversationHistory.length;

    const outcome = applyMidTurnCompact(session, workspaceDir, {
      maxHistoryMessages: 6,
      roundIndex: 2,
      compactionsDone: 0,
      contextTokens: 16_000,
      triggerRatio: 0.05,
    });

    expect(outcome.applied).toBe(true);
    if (!outcome.applied) {
      return;
    }
    expect(outcome.droppedMessageCount).toBeGreaterThan(0);
    expect(session.conversationHistory.length).toBeLessThan(before);
    expect(session.lastCompactBoundary?.midTurn).toBe(true);
    expect(session.lastCompactBoundary?.roundIndex).toBe(2);
    // 红线重注已注入 → 标记被消费（下一轮采样仍看得到约束）。
    expect(session.needsCompactReinjection).toBe(false);
    expect(
      session.conversationHistory.some((m) => (m.content ?? "").includes("压缩后红线重注")),
    ).toBe(true);
    expect(fs.existsSync(compactDigestPath(workspaceDir, "m-midturn"))).toBe(true);
  });

  it("未越线时不动历史", () => {
    const workspaceDir = makeWorkspace();
    const session = sessionWith(longHistory(2), "m-ok");
    const before = session.conversationHistory.map((m) => m.content);

    const outcome = applyMidTurnCompact(session, workspaceDir, {
      maxHistoryMessages: 100,
      roundIndex: 2,
      compactionsDone: 0,
      contextTokens: 128_000,
    });

    expect(outcome).toEqual({ applied: false, reason: "below_trigger" });
    expect(session.conversationHistory.map((m) => m.content)).toEqual(before);
  });

  it("本回合整理次数到顶时记 cap，而不是 below_trigger", () => {
    const workspaceDir = makeWorkspace();
    const session = sessionWith(longHistory(40), "m-cap-reason");
    const before = session.conversationHistory.map((m) => m.content);
    const outcome = applyMidTurnCompact(session, workspaceDir, {
      maxHistoryMessages: 6,
      roundIndex: 2,
      compactionsDone: MID_TURN_COMPACT_MAX,
      contextTokens: 16_000,
      triggerRatio: 0.05,
    });
    expect(outcome).toEqual({ applied: false, reason: "cap" });
    expect(session.conversationHistory.map((m) => m.content)).toEqual(before);
  });

  it("尾巴自身已超窗口（压了不减）时不动历史，也不把摘要堆进去", () => {
    const workspaceDir = makeWorkspace();
    const session = sessionWith(longHistory(1), "m-thin");
    const before = session.conversationHistory.length;

    // force：跳过比例检查直接尝试腾空间，命中的是「压了也不减」这条兜底。
    const outcome = applyMidTurnCompact(session, workspaceDir, {
      maxHistoryMessages: 100,
      roundIndex: 3,
      compactionsDone: 0,
      contextTokens: 16_000,
      force: true,
    });

    expect(outcome).toEqual({ applied: false, reason: "no_reduction" });
    expect(session.conversationHistory.length).toBe(before);
    expect(session.needsCompactReinjection).toBeUndefined();
  });
});

describe("applyMidTurnCompact — 调参（policy context.midTurn.*）真的生效", () => {
  /** history = [system, ...texts]，与 elide 单测同一形状。 */
  function elideSession(texts: string[]): AgentSession {
    const now = "t";
    return {
      sessionId: "s-elide-tuning",
      actorId: "lawyer",
      turns: [],
      conversationHistory: [
        { role: "system", content: "sys", timestamp: now },
        ...texts.map((text) => ({ role: "user" as const, content: text, timestamp: now })),
      ],
      createdAt: now,
      updatedAt: now,
    };
  }

  it("maxPerTurn 由 policy 决定：调成 1 后第二/第三次不再整理", () => {
    const workspaceDir = makeWorkspace();
    const session = sessionWith(longHistory(40), "m-cap");
    const tuning = resolveContextTuning(policyWith({ midTurn: { maxPerTurn: 1 } }));
    expect(
      shouldCompactMidTurn({
        roundIndex: 2,
        used: 20_000,
        effectiveLimit: 16_000,
        level: "compact",
        compactionsDone: 1,
        maxCompactions: tuning.midTurn.maxPerTurn,
      }),
    ).toBe(false);
    // 默认（3）在同样 compactionsDone=1 时仍允许整理：证明读的是 policy 而不是常量。
    expect(
      shouldCompactMidTurn({
        roundIndex: 2,
        used: 20_000,
        effectiveLimit: 16_000,
        level: "compact",
        compactionsDone: 1,
      }),
    ).toBe(true);

    const outcome = applyMidTurnCompact(session, workspaceDir, {
      maxHistoryMessages: 6,
      roundIndex: 2,
      compactionsDone: 0,
      contextTokens: 16_000,
      triggerRatio: 0.05,
      tuning,
    });
    expect(outcome.applied).toBe(true);
  });

  it("elideKeepTail 由 policy 决定：调大后尾部消息不再被省略", () => {
    const huge = "请".repeat(20_000);
    const texts = () => Array.from({ length: 4 }, () => huge);
    const session = elideSession(texts());
    // 默认保护尾部 2 条 → history = [system, c0..c3]，只有 c0/c1 会被省略。
    elideOversizedMessages(session, 16_000);
    expect(session.conversationHistory[1]?.content).toContain("中间省略");
    expect(session.conversationHistory[2]?.content).toContain("中间省略");
    expect(session.conversationHistory[3]?.content).toBe(huge);
    expect(session.conversationHistory[4]?.content).toBe(huge);

    // 保护尾部 0 条 → 四条都可省。
    const session2 = elideSession(texts());
    const out = elideOversizedMessages(
      session2,
      16_000,
      resolveContextTuning(policyWith({ midTurn: { elideKeepTail: 0 } })),
    );
    expect(out.elidedCount).toBe(4);
    expect(session2.conversationHistory[4]?.content).toContain("中间省略");
  });

  it("elideThresholdRatio 由 policy 决定：门槛抬高后同一正文不再被省略", () => {
    const huge = "请".repeat(5_000);
    const texts = () => Array.from({ length: 4 }, () => huge);
    // 默认门槛 = max(4000, 16000*0.125=2000) = 4000 < 5000 → 省略。
    expect(elideOversizedMessages(elideSession(texts()), 16_000).elidedCount).toBeGreaterThan(0);

    // 门槛抬到 16000*1 = 16000 > 5000 → 不省略。
    const tuning = resolveContextTuning(
      policyWith({ midTurn: { elideThresholdRatio: 1, elideThresholdMinChars: 200 } }),
    );
    const session = elideSession(texts());
    expect(elideOversizedMessages(session, 16_000, tuning).elidedCount).toBe(0);
    expect(session.conversationHistory[1]?.content).toBe(huge);
  });
});
