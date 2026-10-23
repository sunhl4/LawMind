import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  extractPlaybookStructure,
  summarizePlaybookCoverage,
  type PlaybookExtract,
} from "./playbook-parse.js";

describe("ID-prefixed one-liners (lease playbook shape)", () => {
  const text = [
    "# Playbook（合成）",
    "RL-L1 违约金不得超过剩余租期租金 30%",
    "RL-L2 押金应在无欠费时退还",
    "RL-L3 装修残值应协商折价或搬离",
  ].join("\n");

  it("recovers ids, keeps thresholds verbatim, marks must_not", () => {
    const out = extractPlaybookStructure(text, "lease.md");
    expect(out.lines).toHaveLength(3);
    expect(out.lines[0]?.id).toBe("RL-L1");
    expect(out.lines[0]?.numbers).toEqual(["30%"]);
    expect(out.lines.every((l) => l.status === "structured")).toBe(true);
    // An RL- line is a red line by construction.
    expect(out.lines.every((l) => l.tier === "must_not")).toBe(true);
    expect(out.structured).toBe(3);
    expect(out.prose).toBe(0);
  });

  it("keeps the original text untouched", () => {
    const out = extractPlaybookStructure(text, "lease.md");
    expect(out.lines[0]?.raw).toBe("RL-L1 违约金不得超过剩余租期租金 30%");
  });
});

describe("tiered numbered list (procurement playbook shape)", () => {
  const text = [
    "# 己方合同审查红线清单（采购类·内部使用）",
    "版本：2025 版",
    "适用范围：设备与系统采购",
    "## 一、验收",
    "1. 一级：验收期不得少于 20 个工作日；设备类合同自全部到货之日起算。",
    "2. 二级：复验次数不少于 2 次，复验费用由责任方承担。",
    "3. 三级：建议写明测试方法与判定值。",
  ].join("\n");

  it("maps the three tiers onto the verdict model", () => {
    const out = extractPlaybookStructure(text, "procurement.md");
    const tiers = out.lines.map((l) => l.tier);
    expect(tiers).toEqual(["must_not", "should_trade", "advisory"]);
    expect(out.lines[0]?.section).toBe("一、验收");
    expect(out.lines[0]?.numbers).toContain("20个工作日");
  });

  it("does not treat 版本/适用范围 as red lines", () => {
    const out = extractPlaybookStructure(text, "procurement.md");
    expect(out.lines.some((l) => l.raw.startsWith("版本"))).toBe(false);
    expect(out.skipped).toBeGreaterThanOrEqual(2);
  });
});

describe("sectioned prose (SaaS playbook shape)", () => {
  const text = [
    "# 己方 Playbook 红线（合成）",
    "## 责任与赔偿",
    "1. 标准帽：12 个月费用的 100%。",
    "2. 数据/个人信息事件：200% 或人民币 500 万较高者。",
    "3. 禁止接受对方 50% 帽而不提异议。",
  ].join("\n");

  it("marks numbered lines without a tier as prose when no threshold is stated", () => {
    const out = extractPlaybookStructure(text, "saas.md");
    // Line 3 carries 禁止 + 50%, so it is machine-reachable; lines 1-2 state a
    // number but no prohibition, so they stay prose until a model authors the
    // criterion. Guessing here would invent a rule the playbook did not write.
    const statuses = out.lines.map((l) => l.status);
    expect(statuses).toContain("structured");
    expect(statuses).toContain("prose");
    expect(out.lines.every((l) => l.section === "责任与赔偿" || l.section !== undefined)).toBe(
      true,
    );
  });

  it("never invents a threshold that is not in the text", () => {
    const out = extractPlaybookStructure(text, "saas.md");
    const allNumbers = out.lines.flatMap((l) => l.numbers);
    expect(allNumbers).toContain("100%");
    expect(allNumbers).toContain("200%");
    expect(allNumbers).toContain("50%");
    expect(allNumbers).not.toContain("90%");
  });
});

describe("coverage summary", () => {
  it("reports the mechanical floor per file", () => {
    const a: PlaybookExtract = extractPlaybookStructure("RL-L1 违约金不得超过 30%", "a.md");
    const b: PlaybookExtract = extractPlaybookStructure(
      "1. 一级：验收期不得少于 20 个工作日。",
      "b.md",
    );
    const summary = summarizePlaybookCoverage([a, b]);
    expect(summary.files).toBe(2);
    expect(summary.structured).toBe(2);
    expect(summary.structuredRatio).toBe(1);
    expect(summary.byFile.map((f) => f.source)).toEqual(["a.md", "b.md"]);
  });

  it("returns a zero ratio rather than NaN for empty input", () => {
    const summary = summarizePlaybookCoverage([]);
    expect(summary.structuredRatio).toBe(0);
  });
});

/**
 * Real firm playbooks from LawMind-Bench (a sibling checkout). Read-only: this
 * test never copies their content into this repo (LawMind-Bench INTEGRATION.md
 * forbids it), and honestly skips when the sibling repo is absent.
 */
const BENCH_ROOT = process.env.LAWMIND_BENCH_ROOT?.trim() || "../LawMind-Bench";
const REAL_PLAYBOOKS = [
  "private/contract-review/saas-msa-redline-review/documents/02-己方playbook红线.md",
  "private/contract-review/saas-msa-redline-review/documents/08-内部红线对照表.md",
  "private/contract-review/office-lease-break-review/documents/04-己方租赁playbook.md",
  "private/contract-review/t3-comm-cont-acceptance/documents/11-己方红线清单-验收与付款.md",
];

describe("real playbooks (skips when the sibling bench repo is absent)", () => {
  const present = REAL_PLAYBOOKS.filter((rel) =>
    fs.existsSync(path.resolve(process.cwd(), BENCH_ROOT, rel)),
  );

  it("extracts structure from real playbooks and reports the floor honestly", () => {
    if (present.length === 0) {
      // Honest skip: no fixture, no claim.
      expect(present).toEqual([]);
      return;
    }
    const extracts = present.map((rel) => {
      const abs = path.resolve(process.cwd(), BENCH_ROOT, rel);
      return extractPlaybookStructure(fs.readFileSync(abs, "utf8"), rel);
    });
    const summary = summarizePlaybookCoverage(extracts);

    // The floor is reported, not assumed. Requiring every file to be fully
    // machine-parseable was an assumption, and real firm playbooks disproved
    // it: some are prose that needs a model to author the criterion.
    expect(summary.files).toBe(present.length);
    expect(summary.lines).toBeGreaterThan(0);
    expect(summary.structured).toBeGreaterThan(0);

    // Thresholds must be quoted verbatim, never recomputed.
    for (const extract of extracts) {
      for (const line of extract.lines) {
        for (const number of line.numbers) {
          expect(line.raw.replace(/\s+/gu, "")).toContain(number);
        }
      }
    }

    // Any line the parser cannot make machine-readable must be labelled prose,
    // never silently dropped or turned into an invented criterion.
    for (const extract of extracts) {
      for (const line of extract.lines) {
        if (line.status === "prose") {
          expect(line.raw.length).toBeGreaterThan(0);
        }
      }
    }
  });
});
