/**
 * Codex 对齐 · 无任务回合判定。
 *
 * 真实事故回归：会话停在改稿门禁后，律师只发 `k`，引擎顺着上一轮历史里的
 * 改稿指令把整条流水线重跑了一遍（19 次工具调用）。这里钉住三件事：
 * 1. 单字 / 纯确认 = 无任务；
 * 2. 明确续作指令（继续 / 接着 / 导出…）才算续作；
 * 3. 无任务原话不绑办件，但也不销毁上一轮清单（留待「继续」）。
 */

import { describe, expect, it } from "vitest";
import { pruneTurnPlanForNewInstruction, type AgentTurnPlan } from "../agent/turn-plan-model.js";
import { compileIntent } from "./compile-intent.js";
import {
  isBareAckUtterance,
  isExplicitContinueUtterance,
  isNoTaskUtterance,
} from "./utterance-kind.js";

const NO_TASK_SAMPLES = [
  "k",
  "K",
  "ok",
  "OK",
  "okay",
  "好",
  "好的",
  "嗯",
  "嗯嗯",
  "可以",
  "收到",
  "1",
  "👍",
  "",
];
const CONTINUE_SAMPLES = ["继续", "接着", "再改一下", "导出", "出稿", "打开结果", "按这个"];
const TASK_SAMPLES = ["按批注改这份合同", "帮我看看这份协议", "不对", "不是合同审核，是看律师函"];

describe("no-task utterance", () => {
  it("单字与纯确认是无任务，明确续作指令不是", () => {
    for (const text of NO_TASK_SAMPLES) {
      expect(isNoTaskUtterance(text), `no-task: ${text}`).toBe(true);
      expect(isExplicitContinueUtterance(text), `continue: ${text}`).toBe(false);
    }
    for (const text of CONTINUE_SAMPLES) {
      expect(isNoTaskUtterance(text), `no-task: ${text}`).toBe(false);
      expect(isExplicitContinueUtterance(text), `continue: ${text}`).toBe(true);
    }
    for (const text of TASK_SAMPLES) {
      expect(isNoTaskUtterance(text), `no-task: ${text}`).toBe(false);
    }
    expect(isBareAckUtterance("k")).toBe(true);
    expect(isBareAckUtterance("按批注改这份合同")).toBe(false);
  });

  it("k 不绑办件，即使上一轮是合同审查", () => {
    const compiled = compileIntent({
      instruction: "k",
      previousCapabilityId: "contract.review",
    });
    expect(compiled.capabilityId).toBeUndefined();
    expect(compiled.source).toBe("unbound");
  });

  it("k 保留上一轮清单但不驱动它；继续才接着办", () => {
    const plan: AgentTurnPlan = {
      items: [
        { step: "通读附件原文与批注", status: "in_progress" },
        { step: "最小锚定落改", status: "pending" },
      ],
      updatedAt: "2026-09-20T06:00:00.000Z",
    };
    expect(pruneTurnPlanForNewInstruction(plan, "k")?.items).toHaveLength(2);
    expect(pruneTurnPlanForNewInstruction(plan, "继续")?.items).toHaveLength(2);
    // 换任务仍然丢弃旧清单
    expect(pruneTurnPlanForNewInstruction(plan, "帮我看看这份起诉状")).toBeUndefined();
  });
});
