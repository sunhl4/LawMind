import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  deriveJudgementItemSeries,
  isJudgementItemPromotable,
} from "../delivery/judgement-ratchet.js";
import {
  appendGuardianItemOutcomes,
  countTasksAwaitingExternalSignal,
  deriveFiredByTask,
  guardianItemOutcomesPath,
  readGuardianItemOutcomes,
  summarizeGuardianItemOutcomes,
  type GuardianItemOutcome,
} from "./item-outcome.js";

const tmp: string[] = [];
afterEach(() => {
  for (const d of tmp) {
    fs.rmSync(d, { recursive: true, force: true });
  }
  tmp.length = 0;
});

function tmpWs(): string {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-item-outcome-"));
  tmp.push(ws);
  return ws;
}

function row(
  o: Partial<GuardianItemOutcome> & { taskId: string; itemKey: string },
): GuardianItemOutcome {
  return {
    ts: "2026-09-21T00:00:00.000Z",
    tier: "judge",
    decidedBy: "model",
    supported: true,
    ...o,
  };
}

describe("G2 逐项结果落盘：口径与容错", () => {
  it("文件不存在 → present: false，不抛、不编 0", () => {
    const read = readGuardianItemOutcomes(tmpWs());
    expect(read.present).toBe(false);
    expect(read.rows).toEqual([]);
  });

  it("空数组不写盘（不产生空文件）", () => {
    const ws = tmpWs();
    expect(appendGuardianItemOutcomes(ws, [])).toBe(0);
    expect(fs.existsSync(guardianItemOutcomesPath(ws))).toBe(false);
  });

  it("写入后可读回，且写入行数正确", () => {
    const ws = tmpWs();
    const wrote = appendGuardianItemOutcomes(ws, [
      row({ taskId: "t1", itemKey: "pr.pay" }),
      row({ taskId: "t1", itemKey: "pr.deposit", tier: "machine", decidedBy: "machine" }),
    ]);
    expect(wrote).toBe(2);
    const read = readGuardianItemOutcomes(ws);
    expect(read.present).toBe(true);
    expect(read.rows.map((r) => r.itemKey)).toEqual(["pr.pay", "pr.deposit"]);
  });

  it("坏行 / 半写行跳过并计数，不抛", () => {
    const ws = tmpWs();
    const file = guardianItemOutcomesPath(ws);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(
      file,
      [
        JSON.stringify(row({ taskId: "t1", itemKey: "pr.pay" })),
        "{ 半写行",
        JSON.stringify({ ts: "x" }), // 缺字段
        JSON.stringify({ ...row({ taskId: "t1", itemKey: "pr.cap" }), tier: "外星级" }),
        "",
        JSON.stringify(row({ taskId: "t1", itemKey: "pr.subject" })),
      ].join("\n"),
      "utf8",
    );
    const read = readGuardianItemOutcomes(ws);
    // 非空行 5 条（空行不计）；坏行 3 条：半写行、缺字段、非法 tier。
    expect(read.totalLines).toBe(5);
    expect(read.skippedLines).toBe(3);
    expect(read.rows.map((r) => r.itemKey)).toEqual(["pr.pay", "pr.subject"]);
  });

  it("`supported: null` 是合法记录（区分「没判出来」与「判未覆盖」）", () => {
    const ws = tmpWs();
    appendGuardianItemOutcomes(ws, [
      row({
        taskId: "t1",
        itemKey: "pr.cap",
        tier: "lawyer",
        decidedBy: "lawyer",
        supported: null,
      }),
    ]);
    const read = readGuardianItemOutcomes(ws);
    expect(read.rows[0]?.supported).toBeNull();
    expect(read.skippedLines).toBe(0);
  });

  it("`supported` 写成字符串 → 该行按坏行跳过（不猜它想表达什么）", () => {
    const ws = tmpWs();
    const file = guardianItemOutcomesPath(ws);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(
      file,
      `${JSON.stringify({ ...row({ taskId: "t1", itemKey: "pr.pay" }), supported: "yes" })}\n`,
      "utf8",
    );
    const read = readGuardianItemOutcomes(ws);
    expect(read.rows).toEqual([]);
    expect(read.skippedLines).toBe(1);
  });
});

describe("G2 deriveFiredByTask：只把「判未覆盖」算作报项，且 clean 必须外生", () => {
  it("**缺外生信号时返回 []** —— 这是正确行为，不是缺陷", () => {
    const ws = tmpWs();
    appendGuardianItemOutcomes(ws, [row({ taskId: "t1", itemKey: "pr.pay", supported: false })]);
    // 没有 cleanDeliveryByTask：宁可让棘轮没数据（不升级），也不给假数据（乱升级）。
    expect(deriveFiredByTask(ws)).toEqual([]);
  });

  it("有外生信号时按任务聚合报项项 id，并采用外生 clean 判定", () => {
    const ws = tmpWs();
    appendGuardianItemOutcomes(ws, [
      row({ taskId: "t1", itemKey: "pr.pay", supported: false }),
      row({ taskId: "t1", itemKey: "pr.subject", supported: false }),
      row({ taskId: "t1", itemKey: "pr.price", supported: true }),
    ]);
    const fired = deriveFiredByTask(ws, {
      cleanDeliveryByTask: new Map([["t1", false]]),
    });
    expect(fired).toEqual([
      { taskId: "t1", itemIds: ["pr.pay", "pr.subject"], cleanDelivery: false },
    ]);
  });

  it("外生信号说「该项是误报」（task 干净）时，cleanDelivery 为 true", () => {
    const ws = tmpWs();
    appendGuardianItemOutcomes(ws, [row({ taskId: "t1", itemKey: "pr.pay", supported: false })]);
    const fired = deriveFiredByTask(ws, {
      cleanDeliveryByTask: new Map([["t1", true]]),
    });
    expect(fired).toEqual([{ taskId: "t1", itemIds: ["pr.pay"], cleanDelivery: true }]);
  });

  it("只产出有外生信号的任务；信号缺失的任务整条不出现", () => {
    const ws = tmpWs();
    appendGuardianItemOutcomes(ws, [
      row({ taskId: "t1", itemKey: "pr.pay", supported: false }),
      row({ taskId: "t2", itemKey: "pr.subject", supported: false }),
    ]);
    const fired = deriveFiredByTask(ws, {
      cleanDeliveryByTask: new Map([["t1", true]]),
    });
    expect(fired.map((r) => r.taskId)).toEqual(["t1"]);
  });

  it("`supported: null`（没判出来）**不算**报项——否则会污染误报率", () => {
    const ws = tmpWs();
    appendGuardianItemOutcomes(ws, [
      row({ taskId: "t1", itemKey: "pr.pay", supported: null }),
      row({
        taskId: "t1",
        itemKey: "pr.cap",
        tier: "lawyer",
        decidedBy: "lawyer",
        supported: null,
      }),
    ]);
    expect(deriveFiredByTask(ws, { cleanDeliveryByTask: new Map([["t1", true]]) })).toEqual([]);
  });

  it("`unavailable: true` 也不算报项（验证器坏了 ≠ 判出问题）", () => {
    const ws = tmpWs();
    appendGuardianItemOutcomes(ws, [
      row({
        taskId: "t1",
        itemKey: "loan.rate",
        tier: "machine",
        decidedBy: "machine",
        supported: false,
        unavailable: true,
      }),
    ]);
    expect(deriveFiredByTask(ws, { cleanDeliveryByTask: new Map([["t1", true]]) })).toEqual([]);
  });

  it("countTasksAwaitingExternalSignal 让「信号没接通」可见（而非被误读成质量不够）", () => {
    const ws = tmpWs();
    appendGuardianItemOutcomes(ws, [
      row({ taskId: "t1", itemKey: "pr.pay", supported: false }),
      row({ taskId: "t2", itemKey: "pr.subject", supported: false }),
      row({ taskId: "t3", itemKey: "pr.price", supported: true }),
    ]);
    expect(countTasksAwaitingExternalSignal(ws)).toBe(2);
  });

  it("文件不存在 → []（不编空战绩）", () => {
    expect(deriveFiredByTask(tmpWs())).toEqual([]);
    expect(countTasksAwaitingExternalSignal(tmpWs())).toBe(0);
  });
});

describe("G2 summarizeGuardianItemOutcomes：报告口径", () => {
  it("分母只算「有结论」的样本；无已决样本时 rate 为 null 而非 0", () => {
    const ws = tmpWs();
    appendGuardianItemOutcomes(ws, [
      row({ taskId: "t1", itemKey: "pr.pay", supported: false }),
      row({ taskId: "t1", itemKey: "pr.pay", supported: false }),
      row({ taskId: "t2", itemKey: "pr.pay", supported: true }),
      // 没判出来的样本：只进 samples，不进分母。
      row({ taskId: "t3", itemKey: "pr.pay", supported: null }),
    ]);
    appendGuardianItemOutcomes(ws, [
      row({
        taskId: "t4",
        itemKey: "pr.cap",
        tier: "lawyer",
        decidedBy: "lawyer",
        supported: null,
      }),
    ]);
    const s = summarizeGuardianItemOutcomes(ws);
    const pay = s.byItem.find((r) => r.itemKey === "pr.pay");
    expect(pay?.samples).toBe(4);
    expect(pay?.decided).toBe(3);
    expect(pay?.notCovered).toBe(2);
    expect(pay?.notCoveredRate).toBeCloseTo(2 / 3, 5);

    const cap = s.byItem.find((r) => r.itemKey === "pr.cap");
    expect(cap?.decided).toBe(0);
    // 关键：不是 0，是 null —— 不编「0% 未覆盖」的故事。
    expect(cap?.notCoveredRate).toBeNull();
  });

  it("冲突与不可用分开计数", () => {
    const ws = tmpWs();
    appendGuardianItemOutcomes(ws, [
      row({
        taskId: "t1",
        itemKey: "pr.deposit",
        tier: "machine",
        decidedBy: "machine",
        conflict: true,
      }),
      row({
        taskId: "t1",
        itemKey: "loan.rate",
        tier: "machine",
        decidedBy: "machine",
        supported: false,
        unavailable: true,
      }),
    ]);
    const s = summarizeGuardianItemOutcomes(ws);
    expect(s.byItem.find((r) => r.itemKey === "pr.deposit")?.conflicts).toBe(1);
    expect(s.byItem.find((r) => r.itemKey === "loan.rate")?.unavailable).toBe(1);
  });
});

describe("G2 闭环：逐项结果真的能喂进棘轮", () => {
  it("deriveFiredByTask 的输出就是 deriveJudgementItemSeries 的输入（口径自洽）", () => {
    const ws = tmpWs();
    appendGuardianItemOutcomes(ws, [
      // t1：pr.pay 报项，外生信号说「律师没改」→ 该项是误报。
      row({ taskId: "t1", itemKey: "pr.pay", supported: false }),
      // t2：pr.pay 报项，外生信号说「律师改了」→ 真报项，不算误报。
      row({ taskId: "t2", itemKey: "pr.pay", supported: false }),
      // t3：pr.subject 报项（无关项）。
      row({ taskId: "t3", itemKey: "pr.subject", supported: false }),
    ]);
    const firedByTask = deriveFiredByTask(ws, {
      cleanDeliveryByTask: new Map([
        ["t1", true], // 唯一报项者 pr.pay 被算作误报
        ["t2", false], // 真报项
        ["t3", false],
      ]),
    });
    const series = deriveJudgementItemSeries({
      firedByTask,
      missedAndEditedCount: 0,
      advisorAcceptedItemIds: new Set(["pr.pay"]),
    });
    const pay = series.find((s) => s.itemId === "pr.pay");
    // pr.pay：报项 2 次（t1 独占且干净 → 误报 1 次）。
    expect(pay?.firedSamples).toBe(2);
    expect(pay?.firedClean).toBe(1);
    const verdict = isJudgementItemPromotable(pay!, {
      minSamples: 2,
      maxFalsePositiveRate: 0.5,
    });
    // 误报率 1/2 = 50%，不高于 50% 上限 → 可升。若上限更严则必须被拒。
    expect(verdict.falsePositiveRate).toBeCloseTo(0.5, 5);
    const strict = isJudgementItemPromotable(pay!, {
      minSamples: 2,
      maxFalsePositiveRate: 0.4,
    });
    expect(strict.promotable).toBe(false);
    expect(strict.reason).toBe("false_positive_rate_above_cap");
  });

  it("**回归**：clean 恒 false 的旧口径会让每项误报率恒为 0 → 必须测出来", () => {
    const ws = tmpWs();
    appendGuardianItemOutcomes(ws, [
      row({ taskId: "t1", itemKey: "pr.pay", supported: false }),
      row({ taskId: "t2", itemKey: "pr.pay", supported: false }),
    ]);
    // 外生信号全为「律师改了」→ 全是真报项，误报率必须算出来是 0，
    // 而非因为「任务里有项报项」就被当成干净。
    const series = deriveJudgementItemSeries({
      firedByTask: deriveFiredByTask(ws, {
        cleanDeliveryByTask: new Map([
          ["t1", false],
          ["t2", false],
        ]),
      }),
      missedAndEditedCount: 0,
      advisorAcceptedItemIds: new Set(["pr.pay"]),
    });
    const pay = series.find((s) => s.itemId === "pr.pay");
    expect(pay?.firedSamples).toBe(2);
    expect(pay?.firedClean).toBe(0);
  });

  it("未过顾问验收的项**不可升**（即便战绩完美）", () => {
    const verdict = isJudgementItemPromotable({
      itemId: "pr.pay",
      firedSamples: 50,
      firedClean: 0,
      missedAndEdited: 0,
      advisorAccepted: false,
    });
    expect(verdict.promotable).toBe(false);
  });

  it("顾问已验收 + 样本足够 + 误报为零 → 可升", () => {
    const verdict = isJudgementItemPromotable({
      itemId: "pr.deposit",
      firedSamples: 50,
      firedClean: 0,
      missedAndEdited: 0,
      advisorAccepted: true,
    });
    expect(verdict.promotable).toBe(true);
  });
});
