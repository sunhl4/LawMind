/**
 * 压缩保真度基准的准入测试。
 *
 * 两件事必须被钉住，且都不是「跑一遍看起来对」：
 *
 * 1. **基准本身可信**：金标串必须在语料里真的出现（否则基准在测空气）、
 *    每轮真的触发了压缩（否则断言无意义）、critical 全存活。
 * 2. **事实台账「宁缺毋滥」**：只钉有明确特征的原话，**不钉 distractor**。
 *    实测踩过：期限模式太松时，填充语「逐条核对期限与金额」被当成期限钉住，
 *    12 条上限被噪声占满、真正的时效反被挤出去（Chroma 的 distractor 效应：
 *    一个无关项就够掉分）。所以「不钉垃圾」是硬不变量，不是风格偏好。
 */

import { describe, expect, it } from "vitest";
import {
  accumulateFactPin,
  extractFactPinItems,
  FACT_PIN_ITEM_CHAR_CAP,
  FACT_PIN_MAX_ITEMS,
  FACT_PIN_TOTAL_CHAR_CAP,
  mergeFactPinItems,
} from "../agent/compact-fact-pin.js";
import type { AgentMessage } from "../agent/types.js";
import { LABOR_NONCOMPETE_CASE, type FidelityCase } from "./compaction-fidelity-cases.js";
import { buildFidelityReportMarkdown, runCompactionFidelity } from "./compaction-fidelity.js";

describe("extractFactPinItems · 只钉有明确特征的原话", () => {
  it("四类各自能认出来", () => {
    const kinds = (text: string): string[] =>
      extractFactPinItems(text)
        .map((i) => i.kind)
        .toSorted();
    expect(kinds("劳动仲裁申请时效是一年，从当事人知道权利被侵害之日起算。")).toEqual(["deadline"]);
    expect(kinds("补偿标准不能低于法定下限")).toEqual(["constraint"]);
    expect(kinds("依据《劳动合同法》第23条。")).toEqual(["citation"]);
    expect(kinds("每月 9,800 元，先考虑发 12 个月。")).toEqual(["amount"]);
  });

  it("不钉 distractor：只说「期限」而没有时间量词的不算期限事实", () => {
    // 这正是实测踩过的坑：填充语占满台账，把真时效挤出去。
    expect(extractFactPinItems("请继续按前述要求推进，并逐条核对期限与金额。")).toEqual([]);
    expect(extractFactPinItems("已核对，按前述标准继续，偏差处已标注来源条款。")).toEqual([]);
    expect(extractFactPinItems("这一条关于期限上限的规定要看清楚。")).toEqual([]);
  });

  it("疑问句不是约束（「是否必须…？」是在问，不是在要求）", () => {
    expect(extractFactPinItems("是否必须通知对方？")).toEqual([]);
    expect(extractFactPinItems("这个必须改吗？")).toEqual([]);
  });

  it("钉的是**整句原话**，不是抽出来的数字（便于模型直接引用）", () => {
    const items = extractFactPinItems(
      "另外提醒：劳动仲裁申请时效是一年，从当事人知道权利被侵害之日起算。",
    );
    expect(items).toHaveLength(1);
    expect(items[0]?.text).toContain("劳动仲裁申请时效是一年");
    expect(items[0]?.text).toContain("之日起算");
  });

  it("单条有长度帽", () => {
    const long = `${"关于期限的说明".repeat(60)}。`;
    const items = extractFactPinItems(long);
    for (const item of items) {
      expect(item.text.length).toBeLessThanOrEqual(FACT_PIN_ITEM_CHAR_CAP);
    }
  });
});

describe("mergeFactPinItems · 去重与双帽", () => {
  const item = (kind: "deadline" | "constraint" | "citation" | "amount", text: string) => ({
    id: `${kind}:${text}`,
    kind,
    text,
    at: "2026-01-01T00:00:00.000Z",
  });

  it("双向子串视为重复：长句已含短句时不重复钉", () => {
    const existing = [item("deadline", "劳动仲裁申请时效是一年，从权利被侵害之日起算")];
    const incoming = [item("deadline", "仲裁申请时效是一年")];
    const merged = mergeFactPinItems(existing, incoming);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.text).toContain("从权利被侵害之日起算");
  });

  it("优先级：期限 > 硬约束 > 引用 > 金额（丢了哪类最像事故）", () => {
    const merged = mergeFactPinItems(
      [],
      [
        item("amount", "每月 9,800 元"),
        item("citation", "《劳动合同法》第23条"),
        item("constraint", "不得解除保密义务"),
        item("deadline", "时效是一年"),
      ],
    );
    expect(merged.map((m) => m.kind)).toEqual(["deadline", "constraint", "citation", "amount"]);
  });

  it("条数与总字符双帽：不把系统段养成第二个上下文", () => {
    const many = Array.from({ length: 40 }, (_, i) =>
      item("amount", `第 ${i} 项金额 1,${100 + i} 元`),
    );
    const merged = mergeFactPinItems([], many);
    expect(merged.length).toBeLessThanOrEqual(FACT_PIN_MAX_ITEMS);
    const total = merged.reduce((n, m) => n + m.text.length, 0);
    expect(total).toBeLessThanOrEqual(FACT_PIN_TOTAL_CHAR_CAP);
  });
});

describe("accumulateFactPin", () => {
  it("只从律师发言抽取（助手写的数字不算律师的话）", () => {
    const session = {
      conversationHistory: [] as AgentMessage[],
      factPin: undefined as
        | {
            items: Array<{
              id: string;
              kind: "deadline" | "constraint" | "citation" | "amount";
              text: string;
              at: string;
            }>;
            updatedAt: string;
          }
        | undefined,
    };
    const msgs: AgentMessage[] = [
      { role: "assistant", content: "补偿每月 9,800 元。", timestamp: "t" },
      { role: "user", content: "补偿每月 9,800 元。", timestamp: "t" },
    ];
    accumulateFactPin(session, msgs);
    expect(session.factPin?.items).toHaveLength(1);
    expect(session.factPin?.items[0]?.kind).toBe("amount");
  });

  it("重复累积不膨胀（去重生效）", () => {
    const session = {
      conversationHistory: [] as AgentMessage[],
      factPin: undefined as
        | {
            items: Array<{
              id: string;
              kind: "deadline" | "constraint" | "citation" | "amount";
              text: string;
              at: string;
            }>;
            updatedAt: string;
          }
        | undefined,
    };
    const msg: AgentMessage = { role: "user", content: "补偿每月 9,800 元。", timestamp: "t" };
    for (let i = 0; i < 6; i += 1) {
      accumulateFactPin(session, [msg]);
    }
    expect(session.factPin?.items).toHaveLength(1);
  });
});

describe("runCompactionFidelity", () => {
  it("关键事实全存活（这是我们要保证的那条线）", async () => {
    const report = await runCompactionFidelity(LABOR_NONCOMPETE_CASE);
    expect(report.isSynthetic).toBe(true);
    expect(report.provenance).toBe("synthetic-authored");
    // 每轮都真的压了，否则断言毫无意义（基准退化必须显式暴露）。
    for (const round of report.rounds) {
      expect(round.droppedMessageCount, `第 ${round.round} 轮没丢弃消息`).toBeGreaterThan(0);
    }
    expect(report.rounds).toHaveLength(4);
    expect(report.critical.lost, "关键事实丢失").toEqual([]);
    expect(report.critical.survivedAllRounds).toBe(report.critical.total);
    expect(report.passes).toBe(true);
  });

  it("非关键事实只测量、不据此判失败（测量值本身是诊断信息）", async () => {
    const report = await runCompactionFidelity(LABOR_NONCOMPETE_CASE);
    // 立场和未决问题不进事实台账。它们现在跟在归档路径后面，原串还在文件里。
    // 丢了也不判失败；这份合成案因为归档可回读，所以可以一条都不丢。
    expect(report.nonCritical.measured).toBeGreaterThan(0);
    expect(report.nonCritical.survivedAllRounds).toBe(report.nonCritical.measured);
    expect(report.nonCritical.lost).toEqual([]);
    expect(report.passes).toBe(true);
  });

  it("全程可回读的事实记成 null，不记成第 0 轮丢失", async () => {
    const report = await runCompactionFidelity(LABOR_NONCOMPETE_CASE);
    for (const fact of LABOR_NONCOMPETE_CASE.facts) {
      expect(report.firstLossRound[fact.id]).toBeNull();
      expect(report.rounds.at(-1)?.survived).toContain(fact.id);
    }
  });

  it("留存体积随轮次有界（不靠囤着不放取胜）", async () => {
    const report = await runCompactionFidelity(LABOR_NONCOMPETE_CASE);
    const last = report.rounds.at(-1);
    // 钉子 + 红线 + 尾部都在里面，但总量必须远小于原始历史（那不是压缩）。
    expect(last?.retainedChars).toBeLessThan(20_000);
    expect(last?.retainedMessages).toBeLessThanOrEqual(30);
  });

  it("语料装配错误时**大声失败**，不静默测空气", async () => {
    const broken: FidelityCase = {
      ...LABOR_NONCOMPETE_CASE,
      id: "broken",
      facts: [
        ...LABOR_NONCOMPETE_CASE.facts,
        {
          id: "ghost",
          kind: "citation",
          text: "《不存在的法》第999条",
          critical: true,
          note: "语料里根本没有这句：基准必须拒绝跑，而不是报「丢了」。",
        },
      ],
    };
    await expect(runCompactionFidelity(broken)).rejects.toThrow(/装配错误|不存在/);
  });

  it("报告自证合成语料（律师 / 运维不得当现场证据读）", async () => {
    const report = await runCompactionFidelity(LABOR_NONCOMPETE_CASE);
    const md = buildFidelityReportMarkdown([report]);
    expect(md).toContain("这不是现场证据");
    expect(md).toContain("真实评测集需律师在真案上标注");
    expect(report.warnings.some((w) => w.includes("不能当现场证据"))).toBe(true);
  });
});
