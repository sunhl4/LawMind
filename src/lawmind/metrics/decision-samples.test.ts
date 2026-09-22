import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  collectDecisionSamples,
  decisionReportPath,
  decisionSamplesPath,
  DRILL_MARKER_FILE,
  writeDecisionSamples,
} from "./decision-samples.js";
import { distributeLintEscape } from "./lint-escape-candidates.js";
import { appendProductMetric } from "./product-metrics.js";
import { appendRuntimeEvent } from "./runtime-events.js";

const dirs: string[] = [];

function makeWorkspace(): string {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-ds-"));
  dirs.push(ws);
  return ws;
}

afterEach(() => {
  for (const dir of dirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  dirs.length = 0;
});

function signalsOf(samples: Array<{ signal: string }>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const s of samples) {
    out[s.signal] = (out[s.signal] ?? 0) + 1;
  }
  return out;
}

describe("decision-samples", () => {
  it("空工作区：所有来源 present=false，且不编造任何 0", async () => {
    const ws = makeWorkspace();
    const { samples, report } = await collectDecisionSamples(ws);

    expect(samples).toHaveLength(0);
    expect(report.sampleCount).toBe(0);
    expect(report.bySignal).toEqual({});
    expect(report.snippetStats.avgChars).toBeNull();
    expect(report.timeRange.from).toBeNull();
    expect(report.labelBalance).toEqual({
      firstPassOk: 0,
      firstPassFail: 0,
      approvalsApproved: 0,
      approvalsRejected: 0,
    });
    // 每个来源都必须被显式记为「不存在」，而不是被当成空集合。
    for (const source of report.sources) {
      expect(source.present).toBe(false);
      expect(source.note, `source ${source.id} 缺 note`).toBeTruthy();
    }
    // 缺口必须自述，避免「0 条漏网」被读成「规则无盲区」。
    expect(report.warnings.join("\n")).toMatch(/尚无可用于编译规则的证据/);
    expect(report.warnings.join("\n")).toMatch(/不要据此认为规则覆盖完整/);
  });

  it("空 ruleIds 的逃逸候选 = 编译器漏网，并从 corpus 回填正文", async () => {
    const ws = makeWorkspace();
    // 律师改了但规则零命中 → 漏网（见 engine/reviewing.ts 的 outcome 口径）
    distributeLintEscape(ws, { taskId: "t-miss", ruleIds: [], snippet: "本合同定金为标的额的30%" });
    // 规则命中 → 工作证据
    distributeLintEscape(ws, {
      taskId: "t-hit",
      ruleIds: ["statutory.deposit_cap"],
      snippet: "定金",
    });

    const { samples, report } = await collectDecisionSamples(ws);
    const bySignal = signalsOf(samples);

    expect(bySignal.rule_miss).toBe(1);
    expect(bySignal.rule_hit).toBe(1);

    const miss = samples.find((s) => s.signal === "rule_miss" && s.taskId === "t-miss");
    expect(miss?.ruleIds).toEqual([]);
    // corpus 与 candidates 同 ts + taskId，必须回填成功（candidates 行本身也带 snippet 时优先用它）
    expect(miss?.snippet).toContain("定金为标的额的30%");

    const hit = samples.find((s) => s.signal === "rule_hit");
    expect(hit?.ruleIds).toEqual(["statutory.deposit_cap"]);

    expect(report.warnings.join("\n")).not.toMatch(/尚无可用于编译规则的证据/);
  });

  it("只有命中、零漏网时要显式提示样本量可能不足", async () => {
    const ws = makeWorkspace();
    distributeLintEscape(ws, { taskId: "t1", ruleIds: ["consistency.amount_case"] });
    const { report } = await collectDecisionSamples(ws);
    expect(report.warnings.join("\n")).toMatch(/0 条漏网记录/);
    expect(report.warnings.join("\n")).toMatch(/不代表规则无盲区|可能意味着样本量不足/);
  });

  it("坏行与半写行被跳过并计数，不抛异常", async () => {
    const ws = makeWorkspace();
    const file = path.join(ws, "lawmind/lint/escape-candidates.jsonl");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(
      file,
      [
        JSON.stringify({ ts: "2026-09-20T00:00:00.000Z", taskId: "ok", ruleIds: [] }),
        '{"ts":"2026-09-20T00:00:01.000Z","ruleI', // 半写行
        "not json at all",
        JSON.stringify({ taskId: "no-ts", ruleIds: [] }), // 缺 ts → 校验不过
        JSON.stringify([1, 2, 3]), // 不是对象
      ].join("\n"),
      "utf8",
    );

    const { samples, report } = await collectDecisionSamples(ws);
    expect(samples).toHaveLength(1);
    expect(samples[0]?.taskId).toBe("ok");
    const escapeSource = report.sources.find((s) => s.id === "escape");
    expect(escapeSource?.skippedLines).toBe(4);
    expect(escapeSource?.rows).toBe(1);
  });

  it("product-events：first_pass 正负样本与 lawyer_edit 逃逸各自成信号", async () => {
    const ws = makeWorkspace();
    appendProductMetric(ws, { kind: "first_pass", outcome: "ok", taskId: "a" });
    appendProductMetric(ws, { kind: "first_pass", outcome: "fail", taskId: "b" });
    appendProductMetric(ws, { kind: "lint_escape", outcome: "lawyer_edit", taskId: "c" });
    appendProductMetric(ws, { kind: "lint_escape", outcome: "lint_findings", taskId: "d" });

    const { samples, report } = await collectDecisionSamples(ws);
    const bySignal = signalsOf(samples);

    expect(bySignal.first_pass_ok).toBe(1);
    expect(bySignal.first_pass_fail).toBe(1);
    // outcome=lawyer_edit ⟺ 该轮 lint 零命中 → 与 rule_miss 同源的漏网证据
    expect(bySignal.lawyer_edit).toBe(1);
    // outcome=lint_findings → 规则命中
    expect(bySignal.rule_hit).toBe(1);
    // fail 与 lawyer_edit 都算「一次通过失败」侧
    expect(report.labelBalance.firstPassOk).toBe(1);
    expect(report.labelBalance.firstPassFail).toBe(2);
  });

  it("runtime-events 的 lawyer_edit 带上结论标签", async () => {
    const ws = makeWorkspace();
    appendRuntimeEvent(ws, {
      kind: "lawyer_edit",
      taskId: "t1",
      matterId: "m1",
      deliverableType: "contract.general",
      meta: { outcome: "modified", lintEscape: true },
    });
    const { samples } = await collectDecisionSamples(ws);
    const row = samples.find((s) => s.source === "runtime_events");
    expect(row?.signal).toBe("lawyer_edit");
    expect(row?.labels).toEqual(["modified"]);
    expect(row?.meta).toEqual({ lintEscape: true });
  });

  it("stance 候选来自漏网正文命中的条款类型", async () => {
    const ws = makeWorkspace();
    // 定金会被 detectStanceClauseType 识别为条款类型
    distributeLintEscape(ws, {
      taskId: "t1",
      ruleIds: [],
      snippet: "本合同定金为标的额的百分之三十",
    });
    const { samples } = await collectDecisionSamples(ws);
    const stance = samples.find((s) => s.signal === "stance_candidate");
    expect(stance).toBeDefined();
    expect(stance?.labels?.[0]).toBeTruthy();
  });

  it("approvals：已结论的拍板成为标签，pending 被跳过", async () => {
    const ws = makeWorkspace();
    const matterDir = path.join(ws, "matters/m1");
    fs.mkdirSync(matterDir, { recursive: true });
    const base = {
      matterId: "m1",
      requestedBy: "lawyer",
      reason: "出稿前拍板",
      riskLevel: "medium" as const,
    };
    fs.writeFileSync(
      path.join(matterDir, "approvals.jsonl"),
      [
        JSON.stringify({
          ...base,
          approvalId: "ap-1",
          requestedAt: "2026-09-20T01:00:00.000Z",
          status: "approved",
        }),
        JSON.stringify({
          ...base,
          approvalId: "ap-2",
          requestedAt: "2026-09-20T02:00:00.000Z",
          status: "rejected",
        }),
        JSON.stringify({
          ...base,
          approvalId: "ap-3",
          requestedAt: "2026-09-20T03:00:00.000Z",
          status: "pending",
        }),
      ].join("\n"),
      "utf8",
    );

    const { samples, report } = await collectDecisionSamples(ws);
    expect(signalsOf(samples).approval_approved).toBe(1);
    expect(signalsOf(samples).approval_rejected).toBe(1);
    // pending 没有结论，不得当作标签
    expect(samples.filter((s) => s.source === "approvals")).toHaveLength(2);
    expect(report.labelBalance.approvalsApproved).toBe(1);
    expect(report.labelBalance.approvalsRejected).toBe(1);
    expect(report.sources.find((s) => s.id === "approvals")?.rows).toBe(3);
  });

  it("sampleId 稳定：两次导出得到同一组 id（可去重）", async () => {
    const ws = makeWorkspace();
    distributeLintEscape(ws, { taskId: "t1", ruleIds: [], snippet: "定金超限" });
    appendProductMetric(ws, { kind: "first_pass", outcome: "ok", taskId: "t1" });

    const a = await collectDecisionSamples(ws);
    const b = await collectDecisionSamples(ws);
    const idsA = a.samples.map((s) => s.sampleId);
    const idsB = b.samples.map((s) => s.sampleId);
    expect(idsA).toHaveLength(idsA.length);
    expect(new Set(idsA).size).toBe(idsA.length);
    expect(idsA).toEqual(idsB);
    // id 稳定是可去重的前提；generatedAt 是导出时刻，本就不保证变化
    // （同毫秒内两次调用会得到相同时间戳），所以只断言 id 组相同。
    expect(new Set(idsA).size).toBe(idsA.length);
  });

  it("截断显式标注，不把窗口当全量", async () => {
    const ws = makeWorkspace();
    for (let i = 0; i < 12; i += 1) {
      appendProductMetric(ws, { kind: "first_pass", outcome: "ok", taskId: `t${i}` });
    }
    const { report } = await collectDecisionSamples(ws, { eventWindow: 5 });
    expect(report.truncated).toBe(true);
    expect(report.sources.find((s) => s.id === "product_events")?.note).toMatch(/仅读取最近 5 条/);
    expect(report.warnings.join("\n")).toMatch(/product-events.jsonl 已截断/);
  });

  it("collect 纯读取：不产生任何文件", async () => {
    const ws = makeWorkspace();
    distributeLintEscape(ws, { taskId: "t1", ruleIds: [], snippet: "x" });
    await collectDecisionSamples(ws);
    expect(fs.existsSync(decisionSamplesPath(ws))).toBe(false);
    expect(fs.existsSync(decisionReportPath(ws))).toBe(false);
  });

  it("writeDecisionSamples 落盘 jsonl + 报告，且报告可解析", async () => {
    const ws = makeWorkspace();
    distributeLintEscape(ws, { taskId: "t1", ruleIds: [], snippet: "定金超限" });
    const collection = await collectDecisionSamples(ws);
    const written = writeDecisionSamples(ws, collection);

    expect(written.rows).toBe(collection.samples.length);
    expect(fs.existsSync(decisionSamplesPath(ws))).toBe(true);
    expect(fs.existsSync(decisionReportPath(ws))).toBe(true);

    const lines = fs.readFileSync(decisionSamplesPath(ws), "utf8").split("\n").filter(Boolean);
    expect(lines).toHaveLength(collection.samples.length);

    const report = JSON.parse(fs.readFileSync(decisionReportPath(ws), "utf8")) as {
      schemaVersion: number;
      sampleCount: number;
    };
    expect(report.schemaVersion).toBe(1);
    expect(report.sampleCount).toBe(collection.samples.length);
  });

  it("截断上限内的正文片段被计入 atClipLimit，作为截断是否够用的证据", async () => {
    const ws = makeWorkspace();
    distributeLintEscape(ws, { taskId: "t1", ruleIds: [], snippet: "一".repeat(500) });
    const { report } = await collectDecisionSamples(ws);
    expect(report.snippetStats.clipChars).toBe(400);
    expect(report.snippetStats.withSnippet).toBe(1);
    expect(report.snippetStats.atClipLimit).toBe(1);
  });
});

describe("演练标记（D9）：演练数据不得被读成真实分布", () => {
  it("无标记 → drill: false，且不产生「演练」来源", async () => {
    const ws = makeWorkspace();
    const { report } = await collectDecisionSamples(ws);
    expect(report.drill).toBe(false);
    expect(report.sources.map((s) => s.id)).not.toContain("drill");
    expect(report.warnings.join("\n")).not.toContain("演练工作区");
  });

  it("有标记 → drill: true，来源具名 + warning 明说不得据此推断覆盖率", async () => {
    const ws = makeWorkspace();
    fs.writeFileSync(
      path.join(ws, DRILL_MARKER_FILE),
      JSON.stringify({ drill: true, slug: "purchase-contract" }),
      "utf8",
    );
    distributeLintEscape(ws, { taskId: "t1", ruleIds: [], snippet: "定金超限" });
    const { report } = await collectDecisionSamples(ws);

    expect(report.drill).toBe(true);
    const drill = report.sources.find((s) => s.id === "drill");
    expect(drill?.present).toBe(true);
    expect(drill?.note).toContain("演练");
    const joined = report.warnings.join("\n");
    expect(joined).toContain("演练工作区");
    expect(joined).toMatch(/不得\*\*据此推断规则覆盖率/);
  });

  it("标记内容坏掉 → 仍算演练（宁可多提醒，不可漏提醒），且永不抛", async () => {
    const ws = makeWorkspace();
    fs.writeFileSync(path.join(ws, DRILL_MARKER_FILE), "{ 这不是 JSON", "utf8");
    const { report } = await collectDecisionSamples(ws);
    expect(report.drill).toBe(true);
  });
});
