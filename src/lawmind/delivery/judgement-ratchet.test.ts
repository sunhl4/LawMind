import { describe, expect, it } from "vitest";
import {
  DEFAULT_JUDGEMENT_PROMOTION,
  deriveJudgementItemSeries,
  describeJudgementPromotion,
  isJudgementItemPromotable,
  resolveJudgementPromotionThresholds,
  resolvePromotableJudgementItems,
  type JudgementItemSeries,
} from "./judgement-ratchet.js";

function series(over: Partial<JudgementItemSeries> = {}): JudgementItemSeries {
  return {
    itemId: "lint.deposit_cap",
    firedSamples: 100,
    firedClean: 2,
    missedAndEdited: 0,
    advisorAccepted: true,
    ...over,
  };
}

describe("P4 判断项棘轮 — 硬前提", () => {
  it("法律顾问未验收 → 一律拒绝（不可被样本量绕过）", () => {
    const v = isJudgementItemPromotable(
      series({ advisorAccepted: false, firedSamples: 100_000, firedClean: 0 }),
    );
    expect(v.promotable).toBe(false);
    expect(v.reason).toBe("advisor_not_accepted");
    expect(v.detail).toContain("拦停权");
  });

  it("顾问未验收且样本不足时，报的是顾问原因（硬前提优先于统计）", () => {
    const v = isJudgementItemPromotable(series({ advisorAccepted: false, firedSamples: 1 }));
    expect(v.reason).toBe("advisor_not_accepted");
  });
});

describe("P4 棘轮三条不变量（与 isAutonomyUnlocked 一致）", () => {
  it("不变量①：样本量不足拒绝", () => {
    const v = isJudgementItemPromotable(
      series({ firedSamples: DEFAULT_JUDGEMENT_PROMOTION.minSamples - 1, firedClean: 0 }),
    );
    expect(v.promotable).toBe(false);
    expect(v.reason).toBe("insufficient_samples");
    expect(v.samples).toBe(DEFAULT_JUDGEMENT_PROMOTION.minSamples - 1);
  });

  it("不变量①：恰好达到门槛 → 通过（边界包含）", () => {
    const v = isJudgementItemPromotable(
      series({ firedSamples: DEFAULT_JUDGEMENT_PROMOTION.minSamples, firedClean: 0 }),
    );
    expect(v.promotable).toBe(true);
  });

  it("不变量②：**缺序列不解锁** —— missedAndEdited=null 拒绝", () => {
    const v = isJudgementItemPromotable(series({ missedAndEdited: null }));
    expect(v.promotable).toBe(false);
    expect(v.reason).toBe("escape_series_missing");
    expect(v.detail).toContain("越少报越好");
  });

  it("不变量②：missedAndEdited=0（有序列但为空）**可以**通过 —— 与 null 不同", () => {
    // 这正是 isAutonomyUnlocked 里 "Missing series (null) or empty series (0) both refuse"
    // 的**有意差异**：交付侧 0 与 null 都拒；判断侧空序列是合法数据
    //（该项从未漏报就是好战绩），null 才是「没有这个维度的数据」。
    const v = isJudgementItemPromotable(series({ missedAndEdited: 0 }));
    expect(v.promotable).toBe(true);
  });

  it("不变量③：**退化自动回锁** —— 误报率上升则结果自动变 false，无需任何回滚逻辑", () => {
    const good = series({ firedSamples: 50, firedClean: 1 }); // 2%
    const degraded = series({ firedSamples: 50, firedClean: 20 }); // 40%
    expect(isJudgementItemPromotable(good).promotable).toBe(true);
    expect(isJudgementItemPromotable(degraded).promotable).toBe(false);
    // 同一函数、同一入参形状，只有数据变了 —— 纯函数即棘轮
    expect(isJudgementItemPromotable(good).promotable).toBe(true);
  });

  it("不变量③：误报率恰好等于上限 → 通过（`>` 而非 `>=`）", () => {
    const v = isJudgementItemPromotable(
      series({ firedSamples: 100, firedClean: 10 }), // 恰好 10%
    );
    expect(v.falsePositiveRate).toBeCloseTo(0.1, 10);
    expect(v.promotable).toBe(true);
  });

  it("误报率超上限 → 拒绝，且 detail 报出实际值与上限", () => {
    const v = isJudgementItemPromotable(series({ firedSamples: 100, firedClean: 11 }));
    expect(v.promotable).toBe(false);
    expect(v.reason).toBe("false_positive_rate_above_cap");
    expect(v.detail).toContain("11.0%");
    expect(v.detail).toContain("10.0%");
    expect(v.detail).toContain("拦住本该放行的稿");
  });
});

describe("P4 阈值可配（policy）", () => {
  it("默认值与 DEFAULT 一致", () => {
    expect(resolveJudgementPromotionThresholds(null)).toEqual(DEFAULT_JUDGEMENT_PROMOTION);
  });

  it("policy 覆盖生效", () => {
    const t = resolveJudgementPromotionThresholds({
      judgementPromotion: { minSamples: 5, maxFalsePositiveRate: 0.5 },
    });
    expect(t).toEqual({ minSamples: 5, maxFalsePositiveRate: 0.5 });
    // 阈值放宽后同一份数据可以通过
    expect(
      isJudgementItemPromotable(series({ firedSamples: 6, firedClean: 3 }), t).promotable,
    ).toBe(true);
  });

  it("非法值被忽略，回落默认（不因脏配置放宽门禁）", () => {
    const t = resolveJudgementPromotionThresholds({
      judgementPromotion: { minSamples: -1, maxFalsePositiveRate: Number.NaN },
    });
    expect(t).toEqual(DEFAULT_JUDGEMENT_PROMOTION);
  });
});

describe("P4 零样本与异常输入", () => {
  it("firedSamples=0 → 误报率为 null（不编造 0%），且样本不足拒绝", () => {
    const v = isJudgementItemPromotable(
      series({ firedSamples: 0, firedClean: 0, missedAndEdited: 0 }),
    );
    expect(v.falsePositiveRate).toBeNull();
    expect(v.promotable).toBe(false);
    expect(v.reason).toBe("insufficient_samples");
  });

  it("firedClean 大于 firedSamples（脏数据）→ 夹到 1.0 并拒绝，不产生 >1 的比例", () => {
    const v = isJudgementItemPromotable(series({ firedSamples: 100, firedClean: 999 }));
    // 夹取后是 100%，仍超上限被拒 —— 不掩盖问题，只是变成可解释的形状
    expect(v.falsePositiveRate).toBe(1);
    expect(v.promotable).toBe(false);
    expect(v.reason).toBe("false_positive_rate_above_cap");
  });

  it("负数样本被夹到 0（不产生负比例）", () => {
    const v = isJudgementItemPromotable(series({ firedSamples: -5, firedClean: -2 }));
    expect(v.samples).toBe(0);
    expect(v.falsePositiveRate).toBeNull();
  });
});

describe("P4 批量判决", () => {
  it("按原因分组，且 promotable 只含真正可升的项", () => {
    const out = resolvePromotableJudgementItems([
      series({ itemId: "ok" }),
      series({ itemId: "no-advisor", advisorAccepted: false }),
      series({ itemId: "few", firedSamples: 2 }),
      series({ itemId: "no-series", missedAndEdited: null }),
      series({ itemId: "noisy", firedSamples: 100, firedClean: 50 }),
    ]);
    expect(out.promotable).toEqual(["ok"]);
    expect(out.rejectedByReason.advisor_not_accepted).toEqual(["no-advisor"]);
    expect(out.rejectedByReason.insufficient_samples).toEqual(["few"]);
    expect(out.rejectedByReason.escape_series_missing).toEqual(["no-series"]);
    expect(out.rejectedByReason.false_positive_rate_above_cap).toEqual(["noisy"]);
  });

  it("空输入 → 无可升级项，不抛", () => {
    const out = resolvePromotableJudgementItems([]);
    expect(out.promotable).toEqual([]);
    expect(out.verdicts).toEqual([]);
  });

  it("describeJudgementPromotion 对空输入诚实（不报「全部通过」）", () => {
    expect(describeJudgementPromotion([])[0]).toContain("尚无判断项战绩");
  });

  it("describeJudgementPromotion 逐项一行，含样本与误报率", () => {
    const lines = describeJudgementPromotion([
      isJudgementItemPromotable(series({ itemId: "a" })),
      isJudgementItemPromotable(series({ itemId: "b", firedSamples: 0, firedClean: 0 })),
    ]);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("[可升] a");
    expect(lines[1]).toContain("（无样本）");
  });
});

describe("P4 从决策样本派生序列（含归因保守性）", () => {
  it("**独占归因**：同任务只有一项报过时，才把 clean 记作该项的误报", () => {
    const list = deriveJudgementItemSeries({
      firedByTask: [
        { taskId: "t1", itemIds: ["a"], cleanDelivery: true },
        // 两项同时报 → clean 不归因给任何一方（宁可少算，不要算错）
        { taskId: "t2", itemIds: ["a", "b"], cleanDelivery: true },
      ],
      missedAndEditedCount: 0,
      advisorAcceptedItemIds: new Set(),
    });
    const a = list.find((r) => r.itemId === "a")!;
    const b = list.find((r) => r.itemId === "b")!;
    expect(a.firedSamples).toBe(2);
    expect(a.firedClean).toBe(1); // 只有 t1 计入
    expect(b.firedSamples).toBe(1);
    expect(b.firedClean).toBe(0); // t2 不归因
  });

  it("同任务重复报同一项只计一次（去重）", () => {
    const list = deriveJudgementItemSeries({
      firedByTask: [{ taskId: "t1", itemIds: ["a", "a", "a"], cleanDelivery: true }],
      missedAndEditedCount: 0,
      advisorAcceptedItemIds: new Set(),
    });
    expect(list[0]?.firedSamples).toBe(1);
    expect(list[0]?.firedClean).toBe(1);
  });

  it("未 clean 的交付不计入 firedClean（它们是「报了且律师认可」）", () => {
    const list = deriveJudgementItemSeries({
      firedByTask: [
        { taskId: "t1", itemIds: ["a"], cleanDelivery: false },
        { taskId: "t2", itemIds: ["a"], cleanDelivery: false },
      ],
      missedAndEditedCount: 3,
      advisorAcceptedItemIds: new Set(["a"]),
    });
    expect(list[0]?.firedSamples).toBe(2);
    expect(list[0]?.firedClean).toBe(0);
    expect(isJudgementItemPromotable(list[0]).promotable).toBe(false); // 样本不足
  });

  it("空 itemIds 的任务被跳过", () => {
    const list = deriveJudgementItemSeries({
      firedByTask: [{ taskId: "t1", itemIds: [], cleanDelivery: true }],
      missedAndEditedCount: 0,
      advisorAcceptedItemIds: new Set(),
    });
    expect(list).toEqual([]);
  });

  it("missedAndEditedCount=null 透传为 null（缺序列）", () => {
    const list = deriveJudgementItemSeries({
      firedByTask: [{ taskId: "t1", itemIds: ["a"], cleanDelivery: false }],
      missedAndEditedCount: null,
      advisorAcceptedItemIds: new Set(["a"]),
    });
    expect(list[0]?.missedAndEdited).toBeNull();
  });

  it("advisorAccepted 只对集合内的项为真", () => {
    const list = deriveJudgementItemSeries({
      firedByTask: [
        { taskId: "t1", itemIds: ["accepted"], cleanDelivery: false },
        { taskId: "t2", itemIds: ["not-accepted"], cleanDelivery: false },
      ],
      missedAndEditedCount: 0,
      advisorAcceptedItemIds: new Set(["accepted"]),
    });
    expect(list.find((r) => r.itemId === "accepted")?.advisorAccepted).toBe(true);
    expect(list.find((r) => r.itemId === "not-accepted")?.advisorAccepted).toBe(false);
  });

  it("输出按 itemId 稳定排序（可复现）", () => {
    const list = deriveJudgementItemSeries({
      firedByTask: [
        { taskId: "t1", itemIds: ["z"], cleanDelivery: false },
        { taskId: "t2", itemIds: ["a"], cleanDelivery: false },
      ],
      missedAndEditedCount: 0,
      advisorAcceptedItemIds: new Set(),
    });
    expect(list.map((r) => r.itemId)).toEqual(["a", "z"]);
  });

  it("**本仓真实数据派生**：无任何战绩 → 无可升级项（诚实结果）", () => {
    // 与 P0 体检结论一致：当前工作区没有逃逸语料，所以没有项能拿到拦停权。
    const list = deriveJudgementItemSeries({
      firedByTask: [],
      missedAndEditedCount: null,
      advisorAcceptedItemIds: new Set(),
    });
    expect(list).toEqual([]);
    expect(resolvePromotableJudgementItems(list).promotable).toEqual([]);
  });
});
