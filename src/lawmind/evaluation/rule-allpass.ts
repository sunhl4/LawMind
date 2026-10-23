/**
 * Rule-level all-pass scoring (Harvey LAB style, applied to classifications).
 *
 * A case passes only when every applicable rule got a verdict and that verdict
 * matches the fixture's expectation. Averages are reported for diagnostics and
 * never turn a failed case into a pass.
 *
 * Fixtures are synthetic. They validate the harness (rule set, coverage,
 * scorer wiring), not the legal quality of a model. A real-model arm must be
 * wired deliberately; without one the CLI reports an honest SKIP.
 */

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CN_SALES_PLAYBOOK_ID, CN_SALES_RULES } from "../review/playbooks/cn-sales.js";
import { filterRulesForPaper, type PaperSide, type RuleClassification } from "../review/rules.js";
import type { RuleClassificationKind } from "../review/rules.js";
import { synthesizeAnswers } from "../review/verdict-oracle.js";
import { decideVerdict } from "../review/verdict.js";

export const RULE_ALLPASS_DIR_REL = "fixtures/lawmind-allpass";

const KINDS: ReadonlySet<RuleClassificationKind> = new Set([
  "compliant",
  "acceptable_deviation",
  "unacceptable",
  "absent",
  "needs_human",
]);

/**
 * Above this ratio of unstable rules, the accuracy number must not be quoted:
 * the run is measuring noise. Chosen from the 2026-10-22 baseline (12%).
 */
export const RULE_ALLPASS_MAX_UNSTABLE_RATIO = 0.05;

/** Minimum contract length: a stub cannot exercise a rule. */
export const RULE_ALLPASS_MIN_CONTRACT_CHARS = 200;

export type RuleAllPassCase = {
  caseId: string;
  paper: PaperSide;
  title?: string;
  contract: string;
  /**
   * The original clause lines. `contract` is their join; the lines are kept so
   * integrity checks (dangling attachments, clause numbering) can point at a
   * specific sentence instead of a character offset.
   */
  clauses: string[];
  /**
   * True when this case was edited while tuning the rules or the prompt.
   * Such a case proves nothing about generalisation: it can pass because the
   * rule was shaped around it. Reports quote the hold-out rate separately.
   */
  tunedOn?: boolean;
  /** ruleId -> expected verdict. Must cover exactly the applicable rules. */
  expected: Record<string, RuleClassificationKind>;
};

export type FixtureProblem = { caseId: string; problem: string };

export type LoadedFixtures = {
  dir: string;
  playbookId: string;
  note: string;
  cases: RuleAllPassCase[];
  problems: FixtureProblem[];
};

export type RuleCaseScore = {
  caseId: string;
  pass: boolean;
  expectedCount: number;
  /** Rules with no verdict at all. */
  missing: string[];
  mismatches: Array<{
    ruleId: string;
    expected: RuleClassificationKind;
    actual: RuleClassificationKind;
  }>;
  /** Verdicts for rules that are not in this case's expectation. */
  extra: string[];
};

export type RuleAllPassSummary = {
  cases: number;
  passed: number;
  failed: number;
  allPassRate: number;
  byRule: Array<{ ruleId: string; cases: number; correct: number; accuracy: number }>;
  problems: FixtureProblem[];
};

export function resolveRuleAllPassDir(repoRoot?: string): string {
  const root = repoRoot ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
  return path.join(root, RULE_ALLPASS_DIR_REL);
}

function casesJsonPath(dir: string): string {
  return path.join(dir, "cases.json");
}

function holdoutJsonPath(dir: string): string {
  return path.join(dir, "holdout.json");
}

type RawCase = {
  caseId?: unknown;
  paper?: unknown;
  title?: unknown;
  clauses?: unknown;
  tunedOn?: unknown;
  expected?: unknown;
};

/**
 * Read `cases.json`. Missing directory or file is not an error: it returns an
 * empty set plus the reason, so the CLI can print an honest SKIP.
 */
export function loadRuleAllPassFixtures(opts?: {
  dir?: string;
  repoRoot?: string;
}): LoadedFixtures {
  const dir = opts?.dir ?? resolveRuleAllPassDir(opts?.repoRoot);
  const empty: LoadedFixtures = {
    dir,
    playbookId: CN_SALES_PLAYBOOK_ID,
    note: "",
    cases: [],
    problems: [],
  };
  const file = casesJsonPath(dir);
  if (!fs.existsSync(file)) {
    empty.problems.push({ caseId: "", problem: `缺夹具文件：${file}` });
    return empty;
  }

  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (err) {
    empty.problems.push({
      caseId: "",
      problem: `cases.json 解析失败：${err instanceof Error ? err.message : String(err)}`,
    });
    return empty;
  }

  const doc = (raw ?? {}) as {
    playbookId?: unknown;
    note?: unknown;
    cases?: unknown;
  };
  const playbookId =
    typeof doc.playbookId === "string" && doc.playbookId.trim()
      ? doc.playbookId.trim()
      : CN_SALES_PLAYBOOK_ID;
  const note = typeof doc.note === "string" ? doc.note.trim() : "";
  const list = Array.isArray(doc.cases) ? (doc.cases as RawCase[]) : [];
  if (list.length === 0) {
    empty.problems.push({ caseId: "", problem: "cases 为空" });
  }

  const cases: RuleAllPassCase[] = [];
  const problems: FixtureProblem[] = [];
  const seen = new Set<string>();

  for (const item of list) {
    const caseId = typeof item.caseId === "string" ? item.caseId.trim() : "";
    if (!caseId) {
      problems.push({ caseId: "", problem: "case 缺 caseId" });
      continue;
    }
    if (seen.has(caseId)) {
      problems.push({ caseId, problem: "caseId 重复" });
      continue;
    }
    seen.add(caseId);

    const paper = item.paper === "own" || item.paper === "counterparty" ? item.paper : undefined;
    if (!paper) {
      problems.push({ caseId, problem: "paper 必须是 own / counterparty" });
      continue;
    }
    const clauses = Array.isArray(item.clauses)
      ? item.clauses.filter((c): c is string => typeof c === "string")
      : [];
    const contract = clauses.join("\n").trim();
    if (contract.length < RULE_ALLPASS_MIN_CONTRACT_CHARS) {
      problems.push({
        caseId,
        problem: `正文过短（${contract.length} < ${RULE_ALLPASS_MIN_CONTRACT_CHARS}）`,
      });
      continue;
    }
    const expectedRaw = (item.expected ?? {}) as Record<string, unknown>;
    const expected: Record<string, RuleClassificationKind> = {};
    let bad = false;
    for (const [ruleId, kind] of Object.entries(expectedRaw)) {
      if (typeof kind !== "string" || !KINDS.has(kind as RuleClassificationKind)) {
        problems.push({ caseId, problem: `规则 ${ruleId} 的期望值非法：${String(kind)}` });
        bad = true;
        continue;
      }
      expected[ruleId] = kind as RuleClassificationKind;
    }
    if (bad) {
      continue;
    }
    cases.push({
      caseId,
      paper,
      ...(typeof item.title === "string" && item.title.trim() ? { title: item.title.trim() } : {}),
      contract,
      clauses,
      ...(item.tunedOn === true ? { tunedOn: true } : {}),
      expected,
    });
  }

  // Hold-out cases live in a separate file so they can be authored once and
  // left alone. They are never marked `tunedOn`.
  const holdoutFile = holdoutJsonPath(dir);
  if (fs.existsSync(holdoutFile)) {
    try {
      const rawHoldout = JSON.parse(fs.readFileSync(holdoutFile, "utf8")) as {
        cases?: RawCase[];
      };
      for (const item of Array.isArray(rawHoldout.cases) ? rawHoldout.cases : []) {
        const caseId = typeof item.caseId === "string" ? item.caseId.trim() : "";
        if (!caseId || seen.has(caseId)) {
          continue;
        }
        const paper =
          item.paper === "own" || item.paper === "counterparty" ? item.paper : undefined;
        const clauses = Array.isArray(item.clauses)
          ? item.clauses.filter((c): c is string => typeof c === "string")
          : [];
        if (!paper || clauses.join("\n").trim().length < RULE_ALLPASS_MIN_CONTRACT_CHARS) {
          continue;
        }
        const expectedRaw = (item.expected ?? {}) as Record<string, unknown>;
        const holdoutExpected: Record<string, RuleClassificationKind> = {};
        for (const [ruleId, kind] of Object.entries(expectedRaw)) {
          if (typeof kind === "string" && KINDS.has(kind as RuleClassificationKind)) {
            holdoutExpected[ruleId] = kind as RuleClassificationKind;
          }
        }
        seen.add(caseId);
        cases.push({
          caseId,
          paper,
          ...(typeof item.title === "string" && item.title.trim()
            ? { title: item.title.trim() }
            : {}),
          contract: clauses.join("\n").trim(),
          clauses,
          expected: holdoutExpected,
        });
      }
    } catch (err) {
      problems.push({
        caseId: "",
        problem: `holdout.json 解析失败：${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  return { dir, playbookId, note, cases, problems };
}

/**
 * Integrity: the expectation must cover exactly the rules applicable to the
 * case's paper. Missing a rule would make all-pass vacuously easier; an extra
 * rule would make it impossible. Either is a fixture bug, not a model result.
 */
export function validateRuleAllPassCase(c: RuleAllPassCase, rules = CN_SALES_RULES): string[] {
  const problems: string[] = [];
  const applicable = filterRulesForPaper(rules, c.paper).map((r) => r.ruleId);
  const applicableSet = new Set(applicable);

  for (const ruleId of Object.keys(c.expected)) {
    if (!applicableSet.has(ruleId)) {
      problems.push(`规则 ${ruleId} 不适用于 ${c.paper} 纸别`);
    }
  }
  for (const ruleId of applicable) {
    if (!(ruleId in c.expected)) {
      problems.push(`缺规则 ${ruleId} 的期望值`);
    }
  }
  if (Object.keys(c.expected).length === 0) {
    problems.push("expected 为空");
  }
  return problems;
}

export function validateRuleAllPassFixtures(loaded: LoadedFixtures): FixtureProblem[] {
  const problems = [...loaded.problems];
  for (const c of loaded.cases) {
    for (const problem of validateRuleAllPassCase(c)) {
      problems.push({ caseId: c.caseId, problem });
    }
  }
  return problems;
}

/**
 * Score one case. `classifications` are what the review produced; a rule with
 * no entry counts as missing, never as an implicit pass.
 */
export function scoreRuleAllPassCase(
  c: RuleAllPassCase,
  classifications: readonly RuleClassification[],
): RuleCaseScore {
  const byRule = new Map<string, RuleClassificationKind>();
  for (const item of classifications) {
    // First verdict wins; a duplicate is a wiring bug surfaced as `extra`.
    if (!byRule.has(item.ruleId)) {
      byRule.set(item.ruleId, item.kind);
    }
  }

  const missing: string[] = [];
  const mismatches: RuleCaseScore["mismatches"] = [];
  for (const [ruleId, expected] of Object.entries(c.expected)) {
    const actual = byRule.get(ruleId);
    if (!actual) {
      missing.push(ruleId);
      continue;
    }
    if (actual !== expected) {
      mismatches.push({ ruleId, expected, actual });
    }
  }

  const expectedIds = new Set(Object.keys(c.expected));
  const extra = [...byRule.keys()].filter((ruleId) => !expectedIds.has(ruleId)).toSorted();

  return {
    caseId: c.caseId,
    pass: missing.length === 0 && mismatches.length === 0 && extra.length === 0,
    expectedCount: Object.keys(c.expected).length,
    missing,
    mismatches,
    extra,
  };
}

export function summarizeRuleAllPass(
  cases: readonly RuleAllPassCase[],
  scores: readonly RuleCaseScore[],
  problems: FixtureProblem[] = [],
): RuleAllPassSummary {
  const byRule = new Map<string, { cases: number; correct: number }>();
  const scoreByCase = new Map(scores.map((s) => [s.caseId, s]));

  for (const c of cases) {
    const score = scoreByCase.get(c.caseId);
    for (const ruleId of Object.keys(c.expected)) {
      const slot = byRule.get(ruleId) ?? { cases: 0, correct: 0 };
      slot.cases += 1;
      const mismatch = score?.mismatches.find((m) => m.ruleId === ruleId);
      const isMissing = score?.missing.includes(ruleId) ?? true;
      if (!mismatch && !isMissing) {
        slot.correct += 1;
      }
      byRule.set(ruleId, slot);
    }
  }

  const passed = scores.filter((s) => s.pass).length;
  return {
    cases: cases.length,
    passed,
    failed: cases.length - passed,
    allPassRate: cases.length === 0 ? 0 : passed / cases.length,
    byRule: [...byRule.entries()]
      .map(([ruleId, slot]) => ({
        ruleId,
        cases: slot.cases,
        correct: slot.correct,
        accuracy: slot.cases === 0 ? 0 : slot.correct / slot.cases,
      }))
      .toSorted((a, b) => a.ruleId.localeCompare(b.ruleId)),
    problems,
  };
}

/** Verdicts reconstructed from the fixture. Harness self-test only. */
/**
 * Verdicts a perfect answerer would produce: synthesize answers from the
 * fixture expectation, then map them. This makes the oracle arm a real check of
 * the criteria ↔ verdict mapping, not a string comparison.
 */
export function oracleClassifications(c: RuleAllPassCase): RuleClassification[] {
  const rules = filterRulesForPaper(CN_SALES_RULES, c.paper);
  const byId = new Map(rules.map((r) => [r.ruleId, r]));
  const out: RuleClassification[] = [];
  for (const [ruleId, kind] of Object.entries(c.expected)) {
    const rule = byId.get(ruleId);
    if (!rule) {
      continue;
    }
    const synthesized = synthesizeAnswers(rule, kind);
    out.push(decideVerdict(rule, synthesized));
  }
  return out;
}

export type RuleAllPassFingerprint = {
  /** Hash of the rule set actually used, so a rule edit invalidates comparison. */
  rulesHash: string;
  playbookId: string;
  /** Upstream model id, or "oracle" for the self-test arm. */
  model: string;
  /** Short commit SHA when available. */
  commit?: string;
  trials: number;
};

export type RuleAllPassModelArmSummary = {
  model: string;
  totalCalls: number;
  stoppedEarly: boolean;
  /** Present when the abort was infrastructural: no accuracy may be quoted. */
  infraError?: string;
  elapsedMs: number;
  /** Independent samples per rule. 1 means no stability information. */
  trials?: number;
  failures: Array<{ caseId: string; ruleId: string; error: string }>;
  perCase: Array<{
    caseId: string;
    pass: boolean;
    missing: string[];
    mismatches: Array<{ ruleId: string; expected: string; actual: string }>;
    perRule: Array<{
      ruleId: string;
      kind?: string;
      rationale?: string;
      samples?: string[];
      stable?: boolean;
      error?: string;
    }>;
  }>;
};

export type RuleAllPassReport = {
  generatedAt: string;
  status: "skip" | "pass" | "fail";
  /** `validate` = 只校验夹具；`run` = 真跑了某个执行臂。缺省按 run 渲染。 */
  mode?: "validate" | "run";
  dir: string;
  arm?: string;
  summary: RuleAllPassSummary;
  /** True only for the oracle arm: proves the scorer, claims nothing about models. */
  harnessSelfTest: boolean;
  /** Present only for a real-model arm. */
  modelArm?: RuleAllPassModelArmSummary;
  /**
   * Run fingerprint. A report without one is not comparable to any other run:
   * rules, model, commit and trials all change what the number means.
   */
  fingerprint?: RuleAllPassFingerprint;
  /**
   * Cases that were never edited while tuning. Quoted separately from the full
   * set so a rule shaped around a fixture cannot masquerade as generalisation.
   */
  generalization?: {
    cases: number;
    passed: number;
    allPassRate: number;
    /** Case ids, so a reader can inspect them. */
    caseIds: string[];
  };
  reportZh: string;
};

/** Rules hash: a rule edit must invalidate cross-run comparison. */
export function hashRules(rules: readonly unknown[]): string {
  return createHash("sha256").update(JSON.stringify(rules), "utf8").digest("hex").slice(0, 16);
}

export type StabilitySummary = {
  totalRules: number;
  unstableRules: number;
  ratio: number;
  unstable: string[];
  /** True when the ratio exceeds the threshold and accuracy must not be quoted. */
  unreliable: boolean;
};

export function summarizeStability(
  modelArm: RuleAllPassModelArmSummary | undefined,
): StabilitySummary {
  const perRule =
    modelArm?.perCase.flatMap((c) =>
      c.perRule.map((r) => ({ caseId: c.caseId, ruleId: r.ruleId, stable: r.stable })),
    ) ?? [];
  const unstable = perRule.filter((r) => r.stable === false);
  const ratio = perRule.length === 0 ? 0 : unstable.length / perRule.length;
  return {
    totalRules: perRule.length,
    unstableRules: unstable.length,
    ratio,
    unstable: unstable.map((r) => `${r.caseId}/${r.ruleId}`),
    unreliable: perRule.length > 0 && ratio > RULE_ALLPASS_MAX_UNSTABLE_RATIO,
  };
}

export function buildRuleAllPassReportMarkdown(report: RuleAllPassReport): string {
  const lines = [
    "# 规则级 all-pass 报告",
    "",
    `- 生成时间：${report.generatedAt}`,
    `- 状态：${report.status.toUpperCase()}`,
    `- 夹具目录：${report.dir}`,
    ...(report.arm ? [`- 执行臂：${report.arm}`] : []),
  ];

  if (report.fingerprint) {
    const fp = report.fingerprint;
    lines.push(
      `- 运行指纹：rules ${fp.rulesHash} · model ${fp.model} · trials ${fp.trials}` +
        (fp.commit ? ` · commit ${fp.commit}` : ""),
    );
  } else if (report.mode !== "validate") {
    lines.push("", "> **无运行指纹**：本报告不可与任何其他运行对比，也不得作为结论引用。");
  }

  if (report.mode === "validate") {
    lines.push(
      `- 夹具校验：通过（${report.summary.cases} 用例；每例覆盖其纸别下全部规则）`,
      "",
      "> 本模式只校验夹具与量规完整性，**不执行评分**，因此没有通过率或模型结论。",
    );
  } else if (report.status === "skip") {
    lines.push(
      `- 夹具：${report.summary.cases} 用例（量规完整）`,
      "- 评分：**SKIP**（未指定执行臂，未调用任何模型）",
      "",
      "> 夹具与评分器可用，但本次没有跑模型，因此不给出任何准确率。",
      "> 自检接线：`pnpm lawmind:allpass --arm oracle`（用期望值回放，只验证评分器，不代表模型质量）。",
    );
  } else if (report.modelArm?.infraError || report.modelArm?.stoppedEarly) {
    // A run that lost auth or balance measured almost nothing. Printing a rate
    // here would be the exact kind of false number this harness exists to stop.
    lines.push(
      `- 用例：${report.summary.cases}（其中因基础设施失败未测量 ${report.summary.failed}）`,
      "- 评分：**无效（INVALID）** —— 运行被基础设施错误中止，没有可用准确率",
      "",
      `> ${report.modelArm?.infraError ?? "运行提前中止"}`,
      ">",
      "> 本报告**不代表**模型能力，也不代表过拟合或欠拟合。补足额度/凭据后重跑，",
      "> 并按交付集与留出集分别报数。",
    );
  } else {
    lines.push(
      `- 用例：${report.summary.cases}（通过 ${report.summary.passed} / 失败 ${report.summary.failed}）`,
      `- all-pass 率：${(report.summary.allPassRate * 100).toFixed(1)}%`,
    );
    if (report.harnessSelfTest) {
      lines.push(
        "",
        "> 本报告为 **oracle 自检**：用期望值回放，只验证夹具与评分器接线，不代表任何模型质量。",
      );
    }
  }

  if (report.summary.problems.length > 0) {
    lines.push("", "## 夹具问题", "");
    for (const p of report.summary.problems) {
      lines.push(`- ${p.caseId || "(全局)"}：${p.problem}`);
    }
  }
  const invalidRun = Boolean(report.modelArm?.infraError || report.modelArm?.stoppedEarly);
  if (report.generalization && !invalidRun) {
    const g = report.generalization;
    lines.push(
      "",
      "## 泛化（未参与调参的用例）",
      "",
      g.cases === 0
        ? "> **没有任何用例是未参与调参的。** 本报告的准确率不能作为泛化证据。"
        : [
            `- 用例：${g.cases}（通过 ${g.passed}）`,
            `- all-pass 率：${(g.allPassRate * 100).toFixed(1)}%`,
            `- 用例：${g.caseIds.join("、")}`,
          ].join("\n"),
    );
    if (g.cases > 0 && g.cases < 4) {
      lines.push("", `> 样本量 ${g.cases} 太小，只能作为方向信号，不能当结论。`);
    }
  }

  if (report.modelArm) {
    const m = report.modelArm;
    lines.push(
      "",
      "## 模型臂明细",
      "",
      `- 模型：${m.model}`,
      `- 调用次数：${m.totalCalls}`,
      `- 耗时：${(m.elapsedMs / 1000).toFixed(1)}s`,
      `- 提前中止：${m.stoppedEarly ? "是（配置/鉴权错误）" : "否"}`,
      `- 每规则采样：${m.trials ?? 1} 次${(m.trials ?? 1) > 1 ? "（取多数；平票取更保守的一档）" : "（单次采样，不含稳定性信息）"}`,
      "",
      "> 夹具是**合成**的：此分数衡量「流程能否驱动模型按规则结构判定」，",
      "> **不能**作为真实合同上的准确性证据对外引用。",
    );
    if (m.failures.length > 0) {
      lines.push("", "### 未产出判定的规则", "");
      for (const f of m.failures) {
        lines.push(`- ${f.caseId} / ${f.ruleId}：${f.error}`);
      }
    }
    // 稳定性必须先于准确率出现：一个不稳的跑分，准确率没有意义。
    const stability = summarizeStability(m);
    if (stability.totalRules > 0) {
      const pct = (stability.ratio * 100).toFixed(0);
      lines.push(
        "",
        `### 稳定性（先看这一节）`,
        "",
        `- 采样不一致：${stability.unstableRules}/${stability.totalRules} 条规则（${pct}%）`,
        `- 判据：超过 ${(RULE_ALLPASS_MAX_UNSTABLE_RATIO * 100).toFixed(0)}% 即视为该跑分不可引用`,
      );
      if (stability.unreliable) {
        lines.push(
          "",
          `> **警告：不稳定率 ${pct}% 超过阈值。下面的 all-pass 与逐规则准确率衡量的是噪声，`,
          "> 不得作为结论、不得对外引用。先降不稳率，再看准确率。**",
        );
      }
      if (stability.unstable.length > 0) {
        lines.push("", "不一致的规则：", "", ...stability.unstable.map((x) => `- ${x}`));
      }
    }
    const failedCases = m.perCase.filter((c) => !c.pass);
    if (failedCases.length > 0) {
      lines.push("", "### 未通过用例", "");
      for (const c of failedCases) {
        const mismatches = c.mismatches
          .map((x) => `${x.ruleId}（期望 ${x.expected}，实得 ${x.actual}）`)
          .join("；");
        lines.push(`- ${c.caseId}：漏判 ${c.missing.join("、") || "—"}；错判 ${mismatches || "—"}`);
        // Rationale for the rules that disagreed with the fixture.
        for (const m2 of c.mismatches) {
          const detail = c.perRule.find((r) => r.ruleId === m2.ruleId);
          if (detail?.rationale) {
            lines.push(`  - 模型理由（${m2.ruleId}）：${detail.rationale}`);
          }
        }
      }
    }
  }
  if (report.mode !== "validate" && report.status !== "skip" && report.summary.byRule.length > 0) {
    lines.push("", "## 逐规则", "", "| 规则 | 用例 | 正确 | 准确率 |", "| --- | --- | --- | --- |");
    for (const r of report.summary.byRule) {
      lines.push(`| ${r.ruleId} | ${r.cases} | ${r.correct} | ${(r.accuracy * 100).toFixed(0)}% |`);
    }
  }

  return `${lines.join("\n")}\n`;
}
