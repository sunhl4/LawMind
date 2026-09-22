import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildRouteDivergenceEscalation,
  buildRouteDivergenceRecord,
  isDivergent,
  isRouteDivergenceShadowEnabled,
  readRouteDivergenceRecords,
  recordRouteDivergence,
  resolveRouteDivergencePosture,
  routeDivergencePath,
  summarizeRouteDivergence,
  triageTierToRiskLevel,
} from "./route-divergence.js";

const dirs: string[] = [];

function makeWorkspace(): string {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-rd-"));
  dirs.push(ws);
  return ws;
}

afterEach(() => {
  for (const dir of dirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  dirs.length = 0;
});

const opinions = (
  kw: { kind?: string; riskLevel?: string },
  model?: { kind?: string; riskLevel?: string },
  triageRisk?: string,
) => [
  { path: "keyword" as const, ...kw },
  ...(model ? [{ path: "model" as const, ...model }] : []),
  ...(triageRisk ? [{ path: "triage" as const, riskLevel: triageRisk }] : []),
];

describe("P2.3 buildRouteDivergenceRecord", () => {
  it("三路径一致 → kindAgreement 与 riskAgreement 都为真", () => {
    const rec = buildRouteDivergenceRecord({
      instruction: "审查这份合同",
      opinions: opinions(
        { kind: "analyze.contract", riskLevel: "medium" },
        { kind: "analyze.contract", riskLevel: "medium" },
        "medium",
      ),
    });
    expect(rec?.kindAgreement).toBe(true);
    expect(rec?.riskAgreement).toBe(true);
    expect(rec && isDivergent(rec)).toBe(false);
  });

  it("kind 不一致 → 分歧", () => {
    const rec = buildRouteDivergenceRecord({
      instruction: "看看这份材料",
      opinions: opinions(
        { kind: "analyze.contract", riskLevel: "medium" },
        { kind: "research.legal", riskLevel: "medium" },
      ),
    });
    expect(rec?.kinds).toEqual(["analyze.contract", "research.legal"]);
    expect(rec?.kindAgreement).toBe(false);
    expect(rec && isDivergent(rec)).toBe(true);
  });

  it("风险档不一致 → 分歧（即使 kind 一致）", () => {
    const rec = buildRouteDivergenceRecord({
      instruction: "出个催告函",
      opinions: opinions(
        { kind: "draft.word", riskLevel: "high" },
        { kind: "draft.word", riskLevel: "medium" },
      ),
    });
    expect(rec?.kindAgreement).toBe(true);
    expect(rec?.riskAgreement).toBe(false);
    expect(rec && isDivergent(rec)).toBe(true);
  });

  it("只有一条路径时无从分歧 → 视为一致（不是「通过」，是「不可判」）", () => {
    const rec = buildRouteDivergenceRecord({
      instruction: "x",
      opinions: opinions({ kind: "draft.word", riskLevel: "high" }),
    });
    expect(rec?.kinds).toHaveLength(1);
    expect(rec?.kindAgreement).toBe(true);
    expect(rec?.riskAgreement).toBe(true);
  });

  it("缺答不算分歧，但记入 missingOpinions", () => {
    const rec = buildRouteDivergenceRecord({
      instruction: "x",
      opinions: [
        { path: "keyword", kind: "draft.word" },
        { path: "triage", riskLevel: "low" }, // 无 kind
      ],
    });
    expect(rec?.missingOpinions).toEqual(["triage"]);
    expect(rec?.kindAgreement).toBe(true); // 只有一条 kind 意见
  });

  it("divergenceKey 只由分类集合决定 → 同一类分歧可聚合", () => {
    const a = buildRouteDivergenceRecord({
      instruction: "第一句",
      opinions: opinions({ kind: "a" }, { kind: "b" }),
    });
    const b = buildRouteDivergenceRecord({
      instruction: "完全不同的原话",
      opinions: opinions({ kind: "b" }, { kind: "a" }),
    });
    // 顺序不同、原话不同，key 相同
    expect(a?.divergenceKey).toBe(b?.divergenceKey);
  });

  it("无意见 → undefined", () => {
    expect(buildRouteDivergenceRecord({ instruction: "x", opinions: [] })).toBeUndefined();
  });

  it("instructionHead 截断到 120 字且压缩空白", () => {
    const rec = buildRouteDivergenceRecord({
      instruction: `  ${"甲".repeat(300)}  `,
      opinions: opinions({ kind: "a" }),
    });
    expect(rec?.instructionHead.length).toBe(120);
  });
});

describe("P2.3 开关与姿态", () => {
  it("默认开（纯记录、零行为影响）", () => {
    expect(isRouteDivergenceShadowEnabled({ env: {} })).toBe(true);
    expect(isRouteDivergenceShadowEnabled({ env: { LAWMIND_ROUTE_DIVERGENCE: "0" } })).toBe(false);
    expect(isRouteDivergenceShadowEnabled({ policy: { routeDivergenceShadow: false } })).toBe(
      false,
    );
  });

  it("姿态默认 shadow —— 记录但不改行为", () => {
    expect(resolveRouteDivergencePosture({ env: {} })).toBe("shadow");
    expect(
      resolveRouteDivergencePosture({ env: { LAWMIND_ROUTE_DIVERGENCE_POSTURE: "off" } }),
    ).toBe("off");
    expect(
      resolveRouteDivergencePosture({ env: { LAWMIND_ROUTE_DIVERGENCE_POSTURE: "escalate" } }),
    ).toBe("escalate");
    expect(
      resolveRouteDivergencePosture({ policy: { routeDivergencePosture: "off" }, env: {} }),
    ).toBe("off");
  });

  it("主开关优先：LAWMIND_ROUTE_DIVERGENCE=0 时姿态一律 off（否则开关会失效）", () => {
    expect(
      resolveRouteDivergencePosture({
        env: { LAWMIND_ROUTE_DIVERGENCE: "0", LAWMIND_ROUTE_DIVERGENCE_POSTURE: "escalate" },
      }),
    ).toBe("off");
    expect(
      resolveRouteDivergencePosture({
        policy: { routeDivergenceShadow: false, routeDivergencePosture: "escalate" },
        env: {},
      }),
    ).toBe("off");
  });

  it("unknown 值回落 shadow（不意外开启升级）", () => {
    expect(
      resolveRouteDivergencePosture({ env: { LAWMIND_ROUTE_DIVERGENCE_POSTURE: "banana" } }),
    ).toBe("shadow");
  });
});

describe("P2.3 落盘与读取", () => {
  it("写入后可读，缺文件时 present=false（不编造 0）", () => {
    const ws = makeWorkspace();
    expect(readRouteDivergenceRecords(ws).present).toBe(false);

    const rec = buildRouteDivergenceRecord({
      instruction: "x",
      opinions: opinions({ kind: "a" }, { kind: "b" }),
    })!;
    expect(recordRouteDivergence(ws, rec)).toBe(true);

    const read = readRouteDivergenceRecords(ws);
    expect(read.present).toBe(true);
    expect(read.rows).toHaveLength(1);
    expect(read.rows[0]?.divergenceKey).toBe(rec.divergenceKey);
    expect(fs.existsSync(routeDivergencePath(ws))).toBe(true);
  });

  it("坏行被跳过并计数，不抛", () => {
    const ws = makeWorkspace();
    fs.mkdirSync(path.dirname(routeDivergencePath(ws)), { recursive: true });
    fs.writeFileSync(
      routeDivergencePath(ws),
      [
        JSON.stringify(
          buildRouteDivergenceRecord({ instruction: "x", opinions: opinions({ kind: "a" }) })!,
        ),
        '{"ts":"2026-09-20T00:00:00.000Z","divergenceKe', // 半写行
        JSON.stringify({ ts: "2026-09-20T00:00:00.000Z" }), // 缺 divergenceKey
        "garbage",
      ].join("\n"),
      "utf8",
    );
    const read = readRouteDivergenceRecords(ws);
    expect(read.rows).toHaveLength(1);
    expect(read.totalLines).toBe(4);
    expect(read.skippedLines).toBe(3);
  });

  it("recordRouteDivergence 永不抛（路径不可写时返回 false）", () => {
    const rec = buildRouteDivergenceRecord({
      instruction: "x",
      opinions: opinions({ kind: "a" }),
    })!;
    // 用一个「父路径是文件」的位置，mkdirSync 必失败
    const ws = makeWorkspace();
    const fileAsDir = path.join(ws, "not-a-dir");
    fs.writeFileSync(fileAsDir, "x", "utf8");
    expect(recordRouteDivergence(fileAsDir, rec)).toBe(false);
  });

  it("summarize 按 divergenceKey 聚合，并按次数降序", () => {
    const ws = makeWorkspace();
    const divergent = buildRouteDivergenceRecord({
      instruction: "分歧用的原话",
      opinions: opinions({ kind: "a" }, { kind: "b" }),
    })!;
    const agree = buildRouteDivergenceRecord({
      instruction: "一致的",
      opinions: opinions({ kind: "a" }, { kind: "a" }),
    })!;
    recordRouteDivergence(ws, divergent);
    recordRouteDivergence(ws, divergent);
    recordRouteDivergence(ws, agree);

    const sum = summarizeRouteDivergence(ws);
    expect(sum.present).toBe(true);
    expect(sum.total).toBe(3);
    expect(sum.divergent).toBe(2);
    expect(sum.byKey[0]?.count).toBe(2);
    expect(sum.byKey[0]?.divergenceKey).toBe(divergent.divergenceKey);
  });

  it("summarize 缺文件时诚实报 present=false 且不编造计数", () => {
    const ws = makeWorkspace();
    const sum = summarizeRouteDivergence(ws);
    expect(sum.present).toBe(false);
    expect(sum.total).toBe(0);
    expect(sum.divergent).toBe(0);
    expect(sum.byKey).toEqual([]);
  });
});

describe("P2.4 分歧 → 升级（不设阈值）", () => {
  it("一致 → 不给升级描述符", () => {
    const rec = buildRouteDivergenceRecord({
      instruction: "x",
      opinions: opinions({ kind: "a", riskLevel: "low" }, { kind: "a", riskLevel: "low" }),
    })!;
    expect(buildRouteDivergenceEscalation(rec)).toBeUndefined();
  });

  it("kind 分歧 → 描述符列出每条路径的结论（可读，不是概率）", () => {
    const rec = buildRouteDivergenceRecord({
      instruction: "看看这份",
      opinions: opinions(
        { kind: "analyze.contract", riskLevel: "medium" },
        { kind: "research.legal", riskLevel: "medium" },
      ),
    })!;
    const esc = buildRouteDivergenceEscalation(rec);
    expect(esc).toBeDefined();
    expect(esc?.summary).toContain("合同审查");
    expect(esc?.summary).toContain("法律专项检索");
    expect(esc?.riskFlags).toContain("route_kind_divergence");
    // 不替律师选路
    expect(esc?.summary).toContain("不会替您选一条路继续");
  });

  it("风险档分歧 → 描述符用中文档位，不漏英文枚举", () => {
    const rec = buildRouteDivergenceRecord({
      instruction: "出个函",
      opinions: opinions(
        { kind: "draft.word", riskLevel: "high" },
        { kind: "draft.word", riskLevel: "medium" },
      ),
    })!;
    const esc = buildRouteDivergenceEscalation(rec);
    expect(esc?.summary).toContain("高");
    expect(esc?.summary).toContain("中");
    expect(esc?.riskFlags).toContain("route_risk_divergence");
    expect(esc?.riskFlags).not.toContain("route_kind_divergence");
  });

  it("描述符不含工程标识（律师可见面口径）", () => {
    const rec = buildRouteDivergenceRecord({
      instruction: "x",
      opinions: opinions({ kind: "a" }, { kind: "b" }),
    })!;
    const esc = buildRouteDivergenceEscalation(rec)!;
    const blob = `${esc.title}\n${esc.summary}\n${esc.recommendation}\n${esc.rationale}`;
    expect(blob).not.toMatch(/[a-z][a-z0-9]*(?:_[a-z0-9]+)+/); // snake_case 工具/码名
    expect(blob).not.toContain("route_divergence");
  });

  it("未知 kind 原样展示，不硬翻（不编造中文名）", () => {
    const rec = buildRouteDivergenceRecord({
      instruction: "x",
      opinions: opinions({ kind: "compound.weird" }, { kind: "draft.word" }),
    })!;
    expect(buildRouteDivergenceEscalation(rec)?.summary).toContain("compound.weird");
  });

  it("triage tier → 风险档映射", () => {
    expect(triageTierToRiskLevel("red")).toBe("high");
    expect(triageTierToRiskLevel("yellow")).toBe("medium");
    expect(triageTierToRiskLevel("green")).toBe("low");
  });
});
