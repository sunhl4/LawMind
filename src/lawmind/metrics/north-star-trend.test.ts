/**
 * 北极星趋势的准入测试。
 *
 * 这组锁的是**三条诚实约束**（比算法正确性更重要）：
 *   1. 样本不足的桶报 `null`，绝不报 0% / 100%；
 *   2. 桶数不足时**不给趋势结论**，而不是拿几个点画一条好看的线；
 *   3. 分桶与比率口径与 `north-star.ts` 一致（否则同一工作区会有两个打架的数）。
 *
 * 用 `now` 注入固定时点（2026-09-21 周一 12:00 UTC = ISO 2026-W39），
 * 测试不依赖真实时钟、也不会随周漂移。
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildNorthStarTrend,
  MIN_BUCKETS_FOR_TREND,
  MIN_DELIVERIES_PER_BUCKET,
  persistNorthStarTrend,
  readNorthStarTrend,
} from "./north-star-trend.js";
import { northStarTrendPath } from "./north-star.js";

const tmp: string[] = [];

function tmpWs(): string {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-north-star-trend-"));
  tmp.push(ws);
  return ws;
}

afterEach(() => {
  for (const d of tmp) {
    fs.rmSync(d, { recursive: true, force: true });
  }
  tmp.length = 0;
});

const NOW = new Date("2026-09-21T12:00:00.000Z");

function writeEvent(ws: string, ts: string, kind: string, outcome: string): void {
  const target = path.join(ws, "lawmind", "metrics", "product-events.jsonl");
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.appendFileSync(target, `${JSON.stringify({ ts, kind, outcome, meta: {} })}\n`, "utf8");
}

/**
 * 改稿幅度事件（形状与 `learning/rewrite-amplitude.ts` 一致）。
 *
 * `source` 必填，因为**协议第三条判据只认 `lawyer_edit`**（律师直接改稿）：
 * `assistant_revision` 是助手后台修订幅度（模型行为指标），与「律师的编辑负担」不是一回事。
 */
function writeAmplitudeEvent(
  ws: string,
  ts: string,
  absCharDelta: number,
  source: "lawyer_edit" | "assistant_revision" | null = "lawyer_edit",
): void {
  const target = path.join(ws, "lawmind", "metrics", "product-events.jsonl");
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.appendFileSync(
    target,
    `${JSON.stringify({
      ts,
      kind: "rewrite_amplitude",
      outcome: "ok",
      // source=null 模拟"字段加入之前"的旧事件（当时只可能来自助手修订路径）。
      meta: { absCharDelta, charDelta: absCharDelta, ...(source ? { source } : {}) },
    })}\n`,
    "utf8",
  );
}

/**
 * 往某一周写一批事件。
 *
 * 两个必须守住的边界，否则夹具会把事件写进**相邻周**（那会让断言看似玄学地差 1）：
 *   1. 一律落在 `NOW` **之前**——`buildNorthStarTrend` 排除 `ts > now`（防时钟漂移）；
 *   2. 一律落在**该 ISO 周之内**——所以从该周周一 00:00 UTC 起，按 20 分钟递增，
 *      而不是从任意时点往回减小时数（那样会跨过周一 00:00 落到上一周）。
 */
function seedWeek(
  ws: string,
  weekOffset: number,
  spec: {
    ok?: number;
    failed?: number;
    rewrites?: number;
    escapes?: number;
    /** 改稿幅度样本（字符，绝对值）；每条生成一个 `rewrite_amplitude` 事件。 */
    amplitudes?: number[];
  },
): void {
  // NOW 是周一 12:00 UTC，故「本周周一 00:00」= NOW 去掉时分秒。
  const monday = new Date(
    Date.UTC(NOW.getUTCFullYear(), NOW.getUTCMonth(), NOW.getUTCDate()) -
      weekOffset * 7 * 86_400_000,
  );
  let i = 0;
  const ts = (): string => new Date(monday.getTime() + i++ * 20 * 60_000).toISOString();
  for (let n = 0; n < (spec.ok ?? 0); n += 1) {
    writeEvent(ws, ts(), "first_pass", "ok");
  }
  for (let n = 0; n < (spec.failed ?? 0); n += 1) {
    writeEvent(ws, ts(), "first_pass", "rewrite");
  }
  for (let n = 0; n < (spec.rewrites ?? 0); n += 1) {
    writeEvent(ws, ts(), "rewrite", "noted");
  }
  for (let n = 0; n < (spec.escapes ?? 0); n += 1) {
    writeEvent(ws, ts(), "lint_escape", "lawyer_edit");
  }
  for (const amplitude of spec.amplitudes ?? []) {
    writeAmplitudeEvent(ws, ts(), amplitude);
  }
}

describe("北极星趋势：分桶与口径", () => {
  it("按 ISO 周分桶，桶按时间升序；计数与写入一致", () => {
    const ws = tmpWs();
    seedWeek(ws, 2, { ok: 6, escapes: 1 });
    seedWeek(ws, 1, { ok: 6, escapes: 2 });
    seedWeek(ws, 0, { ok: 6 });

    const trend = buildNorthStarTrend(ws, { now: NOW });
    expect(trend.buckets.map((b) => b.week)).toEqual(["2026-W37", "2026-W38", "2026-W39"]);
    expect(trend.buckets[0]).toMatchObject({ deliveries: 6, firstPassOk: 6, lintEscapes: 1 });
    expect(trend.buckets[2]).toMatchObject({ deliveries: 6, firstPassOk: 6, lintEscapes: 0 });
  });

  it("口径与 north-star 一致：交付分母 = first_pass + rewrite，逃逸不计入分母外", () => {
    const ws = tmpWs();
    seedWeek(ws, 0, { ok: 3, failed: 1, rewrites: 1, escapes: 1 });
    const bucket = buildNorthStarTrend(ws, { now: NOW }).buckets[0];
    expect(bucket.deliveries).toBe(5);
    expect(bucket.firstPassRate).toBeCloseTo(3 / 4);
    expect(bucket.lintEscapeRate).toBeCloseTo(1 / 5);
    // 若误用「一次通过总数」作分母会得到 1/4——这里明确排除那个口径。
    expect(bucket.lintEscapeRate).not.toBeCloseTo(1 / 4);
  });

  it("窗口外的事件不参与（windowDays 生效）", () => {
    const ws = tmpWs();
    seedWeek(ws, 0, { ok: 6 });
    seedWeek(ws, 20, { ok: 6 }); // 140 天前，超出 90 天窗口
    const trend = buildNorthStarTrend(ws, { now: NOW, windowDays: 90 });
    expect(trend.buckets).toHaveLength(1);
  });

  it("`ts > now` 的事件被排除（防时钟漂移：未来事件不得计入今天）", () => {
    const ws = tmpWs();
    seedWeek(ws, 0, { ok: 6 });
    writeEvent(ws, new Date(NOW.getTime() + 3_600_000).toISOString(), "first_pass", "ok");
    const trend = buildNorthStarTrend(ws, { now: NOW });
    expect(trend.buckets).toHaveLength(1);
    expect(trend.buckets[0].deliveries).toBe(6);
  });
});

describe("北极星趋势：诚实约束", () => {
  it("桶内样本不足 → 比率报 `null`，只留计数（不编 100%）", () => {
    const ws = tmpWs();
    seedWeek(ws, 0, { ok: 1 });
    const bucket = buildNorthStarTrend(ws, { now: NOW }).buckets[0];
    expect(bucket.deliveries).toBe(1);
    expect(bucket.firstPassRate).toBeNull();
    expect(bucket.lintEscapeRate).toBeNull();
    expect(bucket.unattendedCompleteRate).toBeNull();
    // 计数照给——「1 次交付、1 次通过」是可核事实，只是不足以成比率。
    expect(bucket.firstPassOk).toBe(1);
  });

  it("刚好达到门槛的那一周开始报比率（边界不差一）", () => {
    const ws = tmpWs();
    seedWeek(ws, 0, { ok: MIN_DELIVERIES_PER_BUCKET });
    expect(buildNorthStarTrend(ws, { now: NOW }).buckets[0].firstPassRate).toBe(1);
  });

  it("桶数不足 → `trend: null` 且写明原因（**不给结论**）", () => {
    const ws = tmpWs();
    seedWeek(ws, 1, { ok: 6 });
    seedWeek(ws, 0, { ok: 6 });
    const trend = buildNorthStarTrend(ws, { now: NOW });
    expect(trend.trend).toBeNull();
    expect(trend.trendUnavailableReason).toContain(String(MIN_BUCKETS_FOR_TREND));
    // 计数照给，只是不下结论。
    expect(trend.buckets).toHaveLength(2);
  });

  it("一周样本都没有 → 原因是「没有一周达标」，不是空白", () => {
    const trend = buildNorthStarTrend(tmpWs(), { now: NOW });
    expect(trend.trend).toBeNull();
    expect(trend.trendUnavailableReason).toContain("没有一周");
    expect(trend.buckets).toEqual([]);
  });

  it("首过率上升 + 逃逸率下降 → `improving`（这才是要证明的那件事）", () => {
    const ws = tmpWs();
    seedWeek(ws, 2, { ok: 2, failed: 6, rewrites: 2, escapes: 4 }); // 首过 25%，逃逸 40%
    seedWeek(ws, 1, { ok: 4, failed: 4, rewrites: 2, escapes: 2 }); // 首过 50%，逃逸 20%
    seedWeek(ws, 0, { ok: 8, failed: 2, escapes: 0 }); // 首过 80%，逃逸 0%
    const trend = buildNorthStarTrend(ws, { now: NOW });
    expect(trend.trend?.direction).toBe("improving");
    expect(trend.trend?.usableBuckets).toBe(3);
    expect(trend.trend?.firstPassRateDelta).toBeCloseTo(0.55);
    expect(trend.trend?.lintEscapeRateDelta).toBeCloseTo(-0.4);
  });

  it("首过率下降 + 逃逸率上升 → `worsening`（不粉饰）", () => {
    const ws = tmpWs();
    seedWeek(ws, 2, { ok: 8, failed: 2, escapes: 0 });
    seedWeek(ws, 1, { ok: 4, failed: 4, rewrites: 2, escapes: 2 });
    seedWeek(ws, 0, { ok: 2, failed: 6, rewrites: 2, escapes: 4 });
    expect(buildNorthStarTrend(ws, { now: NOW }).trend?.direction).toBe("worsening");
  });

  it("两指标方向矛盾 → `mixed`，不挑好看的那个报", () => {
    const ws = tmpWs();
    seedWeek(ws, 2, { ok: 2, failed: 6, rewrites: 2, escapes: 0 }); // 首过 25%，逃逸 0%
    seedWeek(ws, 1, { ok: 4, failed: 4, rewrites: 2, escapes: 2 }); // 首过 50%，逃逸 20%
    seedWeek(ws, 0, { ok: 8, failed: 2, escapes: 4 }); // 首过 80%，逃逸 40%
    const trend = buildNorthStarTrend(ws, { now: NOW });
    expect(trend.trend?.direction).toBe("mixed");
    expect(trend.trend?.firstPassRateDelta).toBeGreaterThan(0);
    expect(trend.trend?.lintEscapeRateDelta).toBeGreaterThan(0);
  });

  it("两指标都没动 → `flat`（不是 improving）", () => {
    const ws = tmpWs();
    for (const off of [2, 1, 0]) {
      seedWeek(ws, off, { ok: 5, failed: 5, escapes: 1 });
    }
    expect(buildNorthStarTrend(ws, { now: NOW }).trend?.direction).toBe("flat");
  });
});

describe("北极星趋势：改稿幅度（第三条判据）", () => {
  it("桶内取**中位数**而不是均值（重尾分布下均值会被一次整稿重写拉飞）", () => {
    const ws = tmpWs();
    // 5 条：100/120/140/160/9000 —— 均值 ≈1904，中位数 = 140。
    seedWeek(ws, 0, { ok: 6, amplitudes: [100, 120, 140, 160, 9000] });
    const bucket = buildNorthStarTrend(ws, { now: NOW }).buckets[0];
    expect(bucket.rewriteAmplitudeSamples).toBe(5);
    expect(bucket.rewriteAmplitudeMedianChars).toBe(140);
  });

  it("样本不足的周不给幅度中位数（与比率同一门槛）", () => {
    const ws = tmpWs();
    seedWeek(ws, 0, { ok: 1, amplitudes: [200] });
    expect(buildNorthStarTrend(ws, { now: NOW }).buckets[0].rewriteAmplitudeMedianChars).toBeNull();
  });

  it("每周都有样本 → 幅度参与结论，且方向一起投票", () => {
    const ws = tmpWs();
    // 三项全向好：首过升、逃逸降、幅度降。
    seedWeek(ws, 2, { ok: 2, failed: 6, rewrites: 2, escapes: 4, amplitudes: [500, 480, 520] });
    seedWeek(ws, 1, { ok: 4, failed: 4, rewrites: 2, escapes: 2, amplitudes: [320, 300, 340] });
    seedWeek(ws, 0, { ok: 8, failed: 2, escapes: 0, amplitudes: [180, 200, 190] });
    const trend = buildNorthStarTrend(ws, { now: NOW });
    // 首周中位 500（[480,500,520]）→ 末周中位 190（[180,190,200]）。
    expect(trend.trend?.rewriteAmplitudeDeltaChars).toBe(-310);
    expect(trend.trend?.amplitudeUnavailableReason).toBeNull();
    expect(trend.trend?.direction).toBe("improving");
  });

  it("**只有部分周有幅度样本 → 该指标不参与结论并写明原因**（不切成两段分别算）", () => {
    const ws = tmpWs();
    seedWeek(ws, 2, { ok: 6, amplitudes: [500, 480] });
    seedWeek(ws, 1, { ok: 6 }); // 无幅度样本
    seedWeek(ws, 0, { ok: 6, amplitudes: [180, 200] });
    const trend = buildNorthStarTrend(ws, { now: NOW });
    expect(trend.trend?.rewriteAmplitudeDeltaChars).toBeNull();
    expect(trend.trend?.amplitudeUnavailableReason).toContain("2/3");
    // 结论仍然给（另两项有样本），只是幅度这一项不参与。
    expect(trend.trend?.direction).toBe("flat");
  });

  it("幅度变差会**单独**把结论拉成 mixed（不因为另两项好看就报 improving）", () => {
    const ws = tmpWs();
    // 首过升、逃逸降（都好），但幅度在涨（变差）→ 只能说 mixed。
    seedWeek(ws, 2, { ok: 2, failed: 6, rewrites: 2, escapes: 4, amplitudes: [150, 160, 140] });
    seedWeek(ws, 1, { ok: 4, failed: 4, rewrites: 2, escapes: 2, amplitudes: [220, 210, 230] });
    seedWeek(ws, 0, { ok: 8, failed: 2, escapes: 0, amplitudes: [400, 410, 390] });
    const trend = buildNorthStarTrend(ws, { now: NOW });
    expect(trend.trend?.firstPassRateDelta).toBeGreaterThan(0);
    expect(trend.trend?.lintEscapeRateDelta).toBeLessThan(0);
    expect(trend.trend?.rewriteAmplitudeDeltaChars).toBeGreaterThan(0);
    expect(trend.trend?.direction).toBe("mixed");
  });

  it("无幅度事件的工作区照常出结论（该通道装不装不影响另两项）", () => {
    const ws = tmpWs();
    seedWeek(ws, 2, { ok: 2, failed: 6, rewrites: 2, escapes: 4 });
    seedWeek(ws, 1, { ok: 4, failed: 4, rewrites: 2, escapes: 2 });
    seedWeek(ws, 0, { ok: 8, failed: 2, escapes: 0 });
    const trend = buildNorthStarTrend(ws, { now: NOW });
    expect(trend.trend?.direction).toBe("improving");
    expect(trend.trend?.rewriteAmplitudeDeltaChars).toBeNull();
    expect(trend.trend?.amplitudeUnavailableReason).toBeTruthy();
  });
});

describe("北极星趋势：幅度只认「律师直接改稿」这一来源", () => {
  it("`assistant_revision` 样本**不计入**判据三（那是模型行为，不是律师负担）", () => {
    const ws = tmpWs();
    // 每周都有**助手修订**样本，但没有任何律师直接改稿 → 判据三应为「无样本」。
    seedWeek(ws, 2, { ok: 6, amplitudes: [500, 480] });
    seedWeek(ws, 1, { ok: 6, amplitudes: [320, 300] });
    seedWeek(ws, 0, { ok: 6, amplitudes: [180, 200] });
    const target = path.join(ws, "lawmind", "metrics", "product-events.jsonl");
    // 把刚写入的样本全部改标成 assistant_revision（模拟"只有助手修订"的工作区）。
    const rows = fs
      .readFileSync(target, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const o = JSON.parse(line) as { kind: string; meta?: Record<string, unknown> };
        if (o.kind === "rewrite_amplitude" && o.meta) {
          o.meta.source = "assistant_revision";
        }
        return JSON.stringify(o);
      });
    fs.writeFileSync(target, `${rows.join("\n")}\n`, "utf8");

    const trend = buildNorthStarTrend(ws, { now: NOW });
    expect(trend.trend?.rewriteAmplitudeDeltaChars).toBeNull();
    expect(trend.trend?.amplitudeUnavailableReason).toContain("lawyer_edit");
    expect(trend.buckets.every((b) => b.rewriteAmplitudeSamples === 0)).toBe(true);
  });

  it("旧事件（无 `source` 字段）按 `assistant_revision` 归类，不得混入判据三", () => {
    const ws = tmpWs();
    seedWeek(ws, 0, { ok: 6, amplitudes: [400, 420] });
    const target = path.join(ws, "lawmind", "metrics", "product-events.jsonl");
    const rows = fs
      .readFileSync(target, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const o = JSON.parse(line) as { kind: string; meta?: Record<string, unknown> };
        if (o.kind === "rewrite_amplitude" && o.meta) {
          delete o.meta.source;
        }
        return JSON.stringify(o);
      });
    fs.writeFileSync(target, `${rows.join("\n")}\n`, "utf8");

    const bucket = buildNorthStarTrend(ws, { now: NOW }).buckets[0];
    expect(bucket.rewriteAmplitudeSamples).toBe(0);
    expect(bucket.rewriteAmplitudeMedianChars).toBeNull();
  });
});

describe("北极星趋势：落盘与重算", () => {
  it("落盘后可读回，且与重算一致（派生物，重算永远安全）", () => {
    const ws = tmpWs();
    seedWeek(ws, 2, { ok: 6, escapes: 2 });
    seedWeek(ws, 1, { ok: 6, escapes: 1 });
    seedWeek(ws, 0, { ok: 6 });

    const persisted = persistNorthStarTrend(ws, { now: NOW });
    expect(fs.existsSync(northStarTrendPath(ws))).toBe(true);
    expect(readNorthStarTrend(ws)).toEqual(persisted);
  });

  it("文件坏掉 → 重算并覆盖，不抛错、不返回半个对象", () => {
    const ws = tmpWs();
    seedWeek(ws, 0, { ok: 6 });
    const target = northStarTrendPath(ws);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, "{ not json", "utf8");
    const rebuilt = readNorthStarTrend(ws);
    expect(rebuilt.schemaVersion).toBe(1);
    expect(JSON.parse(fs.readFileSync(target, "utf8"))).toEqual(rebuilt);
  });

  it("旧 schemaVersion 的快照不复用（避免两个口径的数字流出去）", () => {
    const ws = tmpWs();
    seedWeek(ws, 0, { ok: 6 });
    const target = northStarTrendPath(ws);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, JSON.stringify({ schemaVersion: 0, buckets: [] }), "utf8");
    expect(readNorthStarTrend(ws).schemaVersion).toBe(1);
  });
});
