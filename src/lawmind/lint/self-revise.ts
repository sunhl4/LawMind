import { runLegalLint } from "./run-lint.js";
import { DEPOSIT_CAP } from "./statute-params.js";
import type { LegalLintFinding, LegalLintReport } from "./types.js";

const SHORT_TEXT_LIMIT = 20;
const MAX_ROUNDS = 3;

/** Mechanical auto-fix only. Or-arbitrate / placeholders stay residual. */
const MECHANICAL_RULE_IDS = new Set(["statutory.deposit_cap"]);

export type SelfReviseApplied = {
  ruleId: string;
  before: string;
  after: string;
};

export type SelfReviseResult = {
  rounds: number;
  applied: SelfReviseApplied[];
  residual: LegalLintFinding[];
  text: string;
  summaryZh: string;
};

function shortNoop(text: string): SelfReviseResult {
  return {
    rounds: 0,
    applied: [],
    residual: [],
    text,
    summaryZh: "正文过短，未做自检。",
  };
}

function summarize(rounds: number, appliedCount: number, residualCount: number): string {
  return `已自检 ${rounds} 轮，修掉 ${appliedCount} 处机械问题；${residualCount} 处需你定夺`;
}

function applyDepositCap(text: string): { text: string; applied: SelfReviseApplied[] } {
  const capPct = String(Math.round(DEPOSIT_CAP.value * 100));
  const applied: SelfReviseApplied[] = [];
  const next = text.replace(/定金[^。]{0,40}?(\d{1,2})\s*%/g, (span, raw) => {
    const pct = Number.parseInt(String(raw), 10);
    if (!Number.isFinite(pct) || pct / 100 <= DEPOSIT_CAP.value) {
      return span;
    }
    const replaced = span.replace(/(\d{1,2})\s*%/, `${capPct}%`);
    if (replaced !== span) {
      applied.push({ ruleId: "statutory.deposit_cap", before: span, after: replaced });
    }
    return replaced;
  });
  return { text: next, applied };
}

function applyMechanical(
  text: string,
  findings: LegalLintFinding[],
): {
  text: string;
  applied: SelfReviseApplied[];
} {
  let current = text;
  const applied: SelfReviseApplied[] = [];
  if (findings.some((f) => f.ruleId === "statutory.deposit_cap")) {
    const deposit = applyDepositCap(current);
    current = deposit.text;
    applied.push(...deposit.applied);
  }
  return { text: current, applied };
}

function normalizeFullwidthSpaces(text: string): { text: string; applied: SelfReviseApplied[] } {
  if (!/\u3000/.test(text)) {
    return { text, applied: [] };
  }
  return {
    text: text.replace(/\u3000/g, " "),
    applied: [{ ruleId: "normalize.fullwidth_space", before: "\u3000", after: " " }],
  };
}

export function runSelfRevise(text: string, report?: LegalLintReport): SelfReviseResult {
  const raw = text ?? "";
  if (raw.trim().length < SHORT_TEXT_LIMIT) {
    return shortNoop(raw);
  }

  const applied: SelfReviseApplied[] = [];
  let current = raw;
  const spaces = normalizeFullwidthSpaces(current);
  current = spaces.text;
  applied.push(...spaces.applied);

  let currentReport = report && spaces.applied.length === 0 ? report : runLegalLint(current);
  let rounds = 0;

  while (rounds < MAX_ROUNDS) {
    const mechanical = currentReport.findings.filter((f) => MECHANICAL_RULE_IDS.has(f.ruleId));
    if (mechanical.length === 0) {
      if (rounds === 0) {
        rounds = 1;
      }
      break;
    }
    const next = applyMechanical(current, mechanical);
    if (next.text === current || next.applied.length === 0) {
      if (rounds === 0) {
        rounds = 1;
      }
      break;
    }
    applied.push(...next.applied);
    current = next.text;
    rounds += 1;
    currentReport = runLegalLint(current);
  }

  return {
    rounds,
    applied,
    residual: currentReport.findings,
    text: current,
    summaryZh: summarize(rounds, applied.length, currentReport.findings.length),
  };
}

/** Cheap local preview for the review workbench — does not write disk. */
export function previewSelfRevise(text: string): SelfReviseResult {
  return runSelfRevise(text);
}
