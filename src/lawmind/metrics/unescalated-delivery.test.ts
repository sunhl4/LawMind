import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { isJudgementItemPromotable } from "../delivery/judgement-ratchet.js";
import { appendGuardianItemOutcomes } from "../guardian/item-outcome.js";
import { appendRuntimeEvent, recordDeliverEvent, resolveDeliverSignals } from "./runtime-events.js";
import {
  collectJudgementSeriesInput,
  collectPromotableJudgementItems,
  deriveCleanDeliveryByTask,
  listUnescalatedDeliveries,
  summarizeExternalSignalCoverage,
} from "./unescalated-delivery.js";

const tmp: string[] = [];
afterEach(() => {
  for (const d of tmp) {
    fs.rmSync(d, { recursive: true, force: true });
  }
  tmp.length = 0;
});

function tmpWs(): string {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-unescalated-"));
  tmp.push(ws);
  return ws;
}

/** 造一条「律师报项」的逐项结果。 */
function fireItem(ws: string, taskId: string, itemKey: string): void {
  appendGuardianItemOutcomes(ws, [
    {
      ts: "2026-09-21T00:00:00.000Z",
      taskId,
      itemKey,
      tier: "judge",
      decidedBy: "model",
      supported: false,
    },
  ]);
}

function deliver(
  ws: string,
  taskId: string,
  humanAcceptance: "accepted_clean" | "accepted_with_change" | "unknown",
  opts?: { interruptionReason?: string },
): void {
  recordDeliverEvent(ws, {
    taskId,
    firstPass: humanAcceptance === "accepted_clean",
    lintEscape: false,
    humanAcceptance,
    interruptionReason: (opts?.interruptionReason as never) ?? "all_gates_green",
  });
}

describe("G2 resolveDeliverSignals：外生性纪律", () => {
  it("律师批准 + 无意见 + 无改稿 → accepted_clean", () => {
    const s = resolveDeliverSignals({
      reviewStatus: "approved",
      reviewedBy: "lawyer-1",
      reviewNotesCount: 0,
      hasRewriteAmplitude: false,
      blockerCount: 0,
      warningCount: 0,
    });
    expect(s.humanAcceptance).toBe("accepted_clean");
    expect(s.interruptionReason).toBe("all_gates_green");
  });

  it("**系统自动批准不算外生信号** → unknown（SEAL：判定器不得给自己判卷）", () => {
    const s = resolveDeliverSignals({
      reviewStatus: "approved",
      reviewedBy: "system:auto_deliver",
      reviewNotesCount: 0,
      hasRewriteAmplitude: false,
      blockerCount: 0,
      warningCount: 0,
    });
    expect(s.humanAcceptance).toBe("unknown");
  });

  it("律师批准但写过意见 / 改过稿 → accepted_with_change", () => {
    const withNotes = resolveDeliverSignals({
      reviewStatus: "approved",
      reviewedBy: "lawyer-1",
      reviewNotesCount: 2,
      hasRewriteAmplitude: false,
      blockerCount: 0,
      warningCount: 0,
    });
    expect(withNotes.humanAcceptance).toBe("accepted_with_change");
    const withRewrite = resolveDeliverSignals({
      reviewStatus: "approved",
      reviewedBy: "lawyer-1",
      reviewNotesCount: 0,
      hasRewriteAmplitude: true,
      blockerCount: 0,
      warningCount: 0,
    });
    expect(withRewrite.humanAcceptance).toBe("accepted_with_change");
  });

  it("律师驳回 / 要求修改 → accepted_with_change（反面证据也是决定性信号）", () => {
    for (const status of ["rejected", "needs_changes"]) {
      const s = resolveDeliverSignals({
        reviewStatus: status,
        reviewedBy: "lawyer-1",
        reviewNotesCount: 0,
        hasRewriteAmplitude: false,
        blockerCount: 0,
        warningCount: 0,
      });
      expect(s.humanAcceptance).toBe("accepted_with_change");
    }
  });

  it("仍未审核（pending）→ unknown：**信号未到，不猜**", () => {
    const s = resolveDeliverSignals({
      reviewStatus: "pending",
      reviewNotesCount: 0,
      hasRewriteAmplitude: false,
      blockerCount: 0,
      warningCount: 0,
    });
    expect(s.humanAcceptance).toBe("unknown");
  });

  it("interruptionReason：无发现 → all_gates_green；仅 advisory → advisory_only", () => {
    expect(
      resolveDeliverSignals({
        reviewNotesCount: 0,
        hasRewriteAmplitude: false,
        blockerCount: 0,
        warningCount: 0,
      }).interruptionReason,
    ).toBe("all_gates_green");
    expect(
      resolveDeliverSignals({
        reviewNotesCount: 0,
        hasRewriteAmplitude: false,
        blockerCount: 0,
        warningCount: 3,
      }).interruptionReason,
    ).toBe("advisory_only");
  });

  it("有 blocker 却走到交付 → unknown（这一层解释不了，不假装知道）", () => {
    expect(
      resolveDeliverSignals({
        reviewNotesCount: 0,
        hasRewriteAmplitude: false,
        blockerCount: 1,
        warningCount: 0,
      }).interruptionReason,
    ).toBe("unknown");
  });
});

describe("G2 交付事件落盘：缺省一律 unknown", () => {
  it("不传新字段时 meta 里是 unknown，而不是假装 green / clean", () => {
    const ws = tmpWs();
    recordDeliverEvent(ws, { taskId: "t1", firstPass: true, lintEscape: false });
    const rows = listUnescalatedDeliveries(ws);
    expect(rows).toEqual([
      {
        taskId: "t1",
        ts: expect.any(String),
        interruptionReason: "unknown",
        humanAcceptance: "unknown",
      },
    ]);
  });

  it("没有 taskId 的交付事件被跳过（无法与逐项结果对齐，不编键）", () => {
    const ws = tmpWs();
    recordDeliverEvent(ws, { firstPass: true, lintEscape: false });
    expect(listUnescalatedDeliveries(ws)).toEqual([]);
  });

  it("非法取值的 meta 折成 unknown（不信任外部写入的文件）", () => {
    const ws = tmpWs();
    appendRuntimeEvent(ws, {
      kind: "deliver",
      taskId: "t1",
      meta: { humanAcceptance: "totally-clean", interruptionReason: "vibes" },
    });
    const rows = listUnescalatedDeliveries(ws);
    expect(rows[0]?.humanAcceptance).toBe("unknown");
    expect(rows[0]?.interruptionReason).toBe("unknown");
  });
});

describe("G2 deriveCleanDeliveryByTask：只产出有决定性信号的任务", () => {
  it("accepted_clean → true；accepted_with_change → false；unknown → 不出现", () => {
    const ws = tmpWs();
    deliver(ws, "t-clean", "accepted_clean");
    deliver(ws, "t-changed", "accepted_with_change");
    deliver(ws, "t-unknown", "unknown");
    const map = deriveCleanDeliveryByTask(ws);
    expect(map.get("t-clean")).toBe(true);
    expect(map.get("t-changed")).toBe(false);
    expect(map.has("t-unknown")).toBe(false);
    expect([...map.keys()].toSorted()).toEqual(["t-changed", "t-clean"]);
  });

  it("同一任务多条交付 → 取最后一条（律师可能先审后退）", () => {
    const ws = tmpWs();
    // 先干净接受，后一条改成「律师动过」→ 最终应判 false。
    deliver(ws, "t1", "accepted_clean");
    deliver(ws, "t1", "accepted_with_change", { interruptionReason: "advisory_only" });
    const map = deriveCleanDeliveryByTask(ws);
    expect(map.get("t1")).toBe(false);
  });

  it("没有任何交付事件 → 空 Map（不编空战绩）", () => {
    expect(deriveCleanDeliveryByTask(tmpWs()).size).toBe(0);
  });
});

describe("G2 覆盖率体检：让「信号没接通」可见", () => {
  it("全部 unknown 时 decidedRatio 为 0（而不是 null）—— 0 与 null 语义不同", () => {
    const ws = tmpWs();
    fireItem(ws, "t1", "pr.pay");
    fireItem(ws, "t2", "pr.pay");
    deliver(ws, "t1", "unknown");
    deliver(ws, "t2", "unknown");
    const c = summarizeExternalSignalCoverage(ws);
    expect(c.deliveredTasks).toBe(2);
    expect(c.decidedTasks).toBe(0);
    expect(c.unknownTasks).toBe(2);
    expect(c.decidedRatio).toBe(0);
    expect(c.unknownReasons).toEqual([{ interruptionReason: "all_gates_green", count: 2 }]);
  });

  it("连交付事件都没有 → decidedRatio 为 null（不是 0）", () => {
    const c = summarizeExternalSignalCoverage(tmpWs());
    expect(c.deliveredTasks).toBe(0);
    expect(c.decidedRatio).toBeNull();
  });

  it("部分决定性 → 比例正确", () => {
    const ws = tmpWs();
    fireItem(ws, "t1", "pr.pay");
    fireItem(ws, "t2", "pr.pay");
    deliver(ws, "t1", "accepted_clean");
    deliver(ws, "t2", "unknown", { interruptionReason: "advisory_only" });
    const c = summarizeExternalSignalCoverage(ws);
    expect(c.decidedTasks).toBe(1);
    expect(c.decidedRatio).toBeCloseTo(0.5, 5);
  });
});

describe("G2 端到端：外生信号接通后棘轮才可能产出可升级项", () => {
  it("缺外生信号 → 没有 series（棘轮空转，这是正确行为）", () => {
    const ws = tmpWs();
    fireItem(ws, "t1", "pr.pay");
    deliver(ws, "t1", "unknown");
    const { series } = collectJudgementSeriesInput(ws, {
      missedAndEditedCount: 0,
      advisorAcceptedItemIds: new Set(["pr.pay"]),
    });
    expect(series).toEqual([]);
  });

  it("外生信号接通 → series 产出，且**误报率不再恒为 0**", () => {
    const ws = tmpWs();
    // t1：pr.pay 报项，律师没改 → 误报。
    fireItem(ws, "t1", "pr.pay");
    deliver(ws, "t1", "accepted_clean");
    // t2：pr.pay 报项，律师改了 → 真报项。
    fireItem(ws, "t2", "pr.pay");
    deliver(ws, "t2", "accepted_with_change");

    const { series, coverage } = collectJudgementSeriesInput(ws, {
      missedAndEditedCount: 0,
      advisorAcceptedItemIds: new Set(["pr.pay"]),
    });
    expect(coverage.decidedTasks).toBe(2);
    const pay = series.find((s) => s.itemId === "pr.pay");
    expect(pay?.firedSamples).toBe(2);
    expect(pay?.firedClean).toBe(1);
    // 关键回归：误报率必须是 1/2，而不是那个恒为 0 的错值。
    const verdict = isJudgementItemPromotable(pay!, { minSamples: 2, maxFalsePositiveRate: 0.4 });
    expect(verdict.falsePositiveRate).toBeCloseTo(0.5, 5);
    expect(verdict.promotable).toBe(false);
    expect(verdict.reason).toBe("false_positive_rate_above_cap");
  });

  it("**回归**：未过顾问验收的项仍然不可升（外生信号不能绕过验收）", () => {
    const ws = tmpWs();
    for (let i = 0; i < 30; i += 1) {
      fireItem(ws, `t${i}`, "pr.deposit");
      deliver(ws, `t${i}`, "accepted_clean");
    }
    const out = collectPromotableJudgementItems(ws, {
      missedAndEditedCount: 0,
      advisorAcceptedItemIds: new Set(), // 顾问未验收
    });
    expect(out.promotable).toEqual([]);
    expect(out.rejectedByReason.advisor_not_accepted).toEqual(["pr.deposit"]);
  });

  it("**回归**：样本足够 + 顾问已验收 + 误报为零 → 可升（真能产出）", () => {
    const ws = tmpWs();
    for (let i = 0; i < 30; i += 1) {
      fireItem(ws, `t${i}`, "pr.deposit");
      // 全部被律师改掉 → 零误报。
      deliver(ws, `t${i}`, "accepted_with_change");
    }
    const out = collectPromotableJudgementItems(ws, {
      missedAndEditedCount: 0,
      advisorAcceptedItemIds: new Set(["pr.deposit"]),
    });
    expect(out.promotable).toEqual(["pr.deposit"]);
    expect(out.coverage.decidedRatio).toBe(1);
  });
});
