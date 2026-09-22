/**
 * Human-baseline blind evaluation.
 *
 * Answers the one question the true-manuscript gate cannot: 「同一交办，LawMind 的稿
 * 比律师一稿差吗」. Harvey 用三类任务（结构化起草 / 非结构化起草与分析 / 数据抽取）
 * 对标人类律师；本模块给 LawMind 一条同口径、可复现、可盲评的路径。
 *
 * 设计约束（与 GOALS 一致）：
 * - 真稿由律师自行脱敏放入 `fixtures/lawmind-human-baseline/<caseId>/`，工程侧不伪造。
 * - 无夹具 / 夹具不足：诚实 SKIP 或 insufficient，绝不假绿。
 * - 盲评：A/B 由 caseId 决定，评分者看不到哪份是 LawMind。
 * - 确定性层可离线跑（CI 用），盲评层需评分者标签，缺标签时只报 pending。
 *
 * 目录结构（每案一个子目录）：
 *   instruction.md            交办原文（可选）
 *   lawyer.docx|.doc|.pdf|.md|.txt      律师一稿
 *   lawmind.docx|.doc|.pdf|.md|.txt     LawMind 交付件
 *   rubric.json               评分量规（缺失时脚本生成 rubric.draft.json）
 *   blind-labels.json         盲评标签（评分者填写；可选）
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { inspectTrueManuscriptFileShape } from "./true-manuscript-gate.js";

export const HUMAN_BASELINE_DIR_REL = "fixtures/lawmind-human-baseline";

/** 与 Harvey 公开对标口径一致的三类任务。 */
export const HUMAN_BASELINE_TASK_TYPES = [
  "structured_drafting",
  "unstructured_drafting",
  "extraction",
] as const;
export type HumanBaselineTaskType = (typeof HUMAN_BASELINE_TASK_TYPES)[number];

export const HUMAN_BASELINE_TASK_TYPE_LABELS: Record<HumanBaselineTaskType, string> = {
  structured_drafting: "结构化起草",
  unstructured_drafting: "非结构化起草与分析",
  extraction: "数据抽取与结构化",
};

/** 最少同题双稿数：低于此数只能报 insufficient，不进 pass。 */
export const HUMAN_BASELINE_MIN_CASES = 10;

/** 确定性层通过线：律师稿不占优（胜+平）的占比。 */
export const HUMAN_BASELINE_MIN_NOT_BELOW_RATIO = 0.8;

export type BaselineCriterion = {
  id: string;
  label: string;
  /** 任一命中即算覆盖 */
  anyOf?: string[];
  /** 全部命中才算覆盖 */
  allOf?: string[];
  /** 出现即记违规 */
  mustNotAppear?: string[];
  weight?: number;
};

export type BaselineRubric = {
  taskType: HumanBaselineTaskType;
  criteria: BaselineCriterion[];
};

export type BlindLabel = {
  rater: string;
  /** 盲评结论：哪一侧更好（A/B 由 caseId 决定，评分者不知道对应关系）。 */
  preferred: "A" | "B" | "tie";
  notes?: string;
  scoredAt?: string;
};

export type HumanBaselineCase = {
  caseId: string;
  dir: string;
  taskType: HumanBaselineTaskType;
  instruction?: string;
  lawyerFile: string;
  lawmindFile: string;
  rubric: BaselineRubric;
  /** 量规是否是脚本生成的草稿（未经律师确认）。 */
  rubricIsDraft: boolean;
};

export type HumanBaselineGate = {
  present: boolean;
  dir: string;
  caseIds: string[];
  cases: HumanBaselineCase[];
  skipped: { caseId: string; reason: string }[];
  skipReason?: string;
};

export function resolveHumanBaselineDir(repoRoot?: string): string {
  const root = repoRoot ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
  return path.join(root, HUMAN_BASELINE_DIR_REL);
}

const TEXT_EXT_RE = /\.(md|txt|markdown)$/i;

function findDraftFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) {
    return [];
  }
  return fs
    .readdirSync(dir)
    .filter(
      (name) =>
        !name.startsWith(".") && (/\.(docx|doc|pdf)$/i.test(name) || TEXT_EXT_RE.test(name)),
    )
    .toSorted();
}

/** 文件名里带 lawyer / 律师 的是律师稿；带 lawmind 的是本机稿。 */
export function classifyBaselinePair(files: string[]): {
  lawyerFile?: string;
  lawmindFile?: string;
} {
  const lawyer = files.find((n) => /lawyer|律师|human/i.test(n));
  const lawmind = files.find((n) => /lawmind|本机|system/i.test(n));
  return {
    ...(lawyer ? { lawyerFile: lawyer } : {}),
    ...(lawmind ? { lawmindFile: lawmind } : {}),
  };
}

function parseRubric(raw: unknown): BaselineRubric | undefined {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }
  const o = raw as Record<string, unknown>;
  const taskType = HUMAN_BASELINE_TASK_TYPES.includes(o.taskType as HumanBaselineTaskType)
    ? (o.taskType as HumanBaselineTaskType)
    : undefined;
  if (!taskType || !Array.isArray(o.criteria)) {
    return undefined;
  }
  const criteria: BaselineCriterion[] = [];
  for (const row of o.criteria) {
    if (!row || typeof row !== "object") {
      continue;
    }
    const c = row as Record<string, unknown>;
    const id = typeof c.id === "string" ? c.id.trim() : "";
    const label = typeof c.label === "string" ? c.label.trim() : "";
    if (!id || !label) {
      continue;
    }
    const strList = (v: unknown): string[] | undefined => {
      if (!Array.isArray(v)) {
        return undefined;
      }
      const out = v
        .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
        .map((x) => x.trim());
      return out.length > 0 ? out : undefined;
    };
    criteria.push({
      id,
      label,
      ...(strList(c.anyOf) ? { anyOf: strList(c.anyOf) } : {}),
      ...(strList(c.allOf) ? { allOf: strList(c.allOf) } : {}),
      ...(strList(c.mustNotAppear) ? { mustNotAppear: strList(c.mustNotAppear) } : {}),
      ...(typeof c.weight === "number" && c.weight > 0 ? { weight: c.weight } : {}),
    });
  }
  return criteria.length > 0 ? { taskType, criteria } : undefined;
}

export function loadHumanBaselineCase(
  dir: string,
  caseId: string,
): { ok: true; value: HumanBaselineCase } | { ok: false; reason: string } {
  const caseDir = path.join(dir, caseId);
  const files = findDraftFiles(caseDir);
  const { lawyerFile, lawmindFile } = classifyBaselinePair(files);
  if (!lawyerFile) {
    return { ok: false, reason: "缺律师一稿（文件名含 lawyer / 律师 / human）" };
  }
  if (!lawmindFile) {
    return { ok: false, reason: "缺 LawMind 交付件（文件名含 lawmind / 本机 / system）" };
  }
  const instructionPath = path.join(caseDir, "instruction.md");
  const instruction = fs.existsSync(instructionPath)
    ? fs.readFileSync(instructionPath, "utf8").trim()
    : undefined;

  const rubricPath = path.join(caseDir, "rubric.json");
  const draftPath = path.join(caseDir, "rubric.draft.json");
  const usePath = fs.existsSync(rubricPath) ? rubricPath : draftPath;
  let rubric: BaselineRubric | undefined;
  if (fs.existsSync(usePath)) {
    try {
      rubric = parseRubric(JSON.parse(fs.readFileSync(usePath, "utf8")));
    } catch {
      rubric = undefined;
    }
  }
  if (!rubric) {
    return { ok: false, reason: "缺 rubric.json（或 rubric.draft.json）" };
  }
  return {
    ok: true,
    value: {
      caseId,
      dir: caseDir,
      taskType: rubric.taskType,
      ...(instruction ? { instruction } : {}),
      lawyerFile,
      lawmindFile,
      rubric,
      rubricIsDraft: usePath === draftPath,
    },
  };
}

export function inspectHumanBaselineGate(repoRoot?: string): HumanBaselineGate {
  const dir = resolveHumanBaselineDir(repoRoot);
  if (!fs.existsSync(dir)) {
    return {
      present: false,
      dir,
      caseIds: [],
      cases: [],
      skipped: [],
      skipReason: `未放入 ${HUMAN_BASELINE_DIR_REL}/（每案一个子目录：律师一稿 + LawMind 交付件 + rubric）。`,
    };
  }
  const caseIds = fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith("."))
    .map((e) => e.name)
    .toSorted();
  const cases: HumanBaselineCase[] = [];
  const skipped: { caseId: string; reason: string }[] = [];
  for (const caseId of caseIds) {
    const loaded = loadHumanBaselineCase(dir, caseId);
    if (loaded.ok) {
      cases.push(loaded.value);
    } else {
      skipped.push({ caseId, reason: loaded.reason });
    }
  }
  if (cases.length === 0) {
    return {
      present: false,
      dir,
      caseIds,
      cases: [],
      skipped,
      skipReason:
        caseIds.length === 0
          ? `${HUMAN_BASELINE_DIR_REL}/ 存在但没有子目录。每案需一个目录，内含律师一稿与 LawMind 交付件。`
          : `${HUMAN_BASELINE_DIR_REL}/ 下 ${caseIds.length} 个目录均不完整（需律师一稿 + LawMind 交付件 + rubric）。`,
    };
  }
  return { present: true, dir, caseIds, cases, skipped };
}

/** 读正文：docx/doc/pdf 走真稿同款形态抽取；md/txt 直读。 */
export async function readBaselineText(
  dir: string,
  file: string,
): Promise<{ ok: true; text: string; chars: number } | { ok: false; reason: string }> {
  const full = path.join(dir, file);
  if (TEXT_EXT_RE.test(file)) {
    try {
      const text = fs.readFileSync(full, "utf8").trim();
      return text ? { ok: true, text, chars: text.length } : { ok: false, reason: `${file} 为空` };
    } catch (e) {
      return { ok: false, reason: e instanceof Error ? e.message : String(e) };
    }
  }
  const shape = await inspectTrueManuscriptFileShape(full);
  if (!shape.ok || !shape.text) {
    return { ok: false, reason: shape.reason ?? `${file} 无可用正文` };
  }
  const text = shape.text;
  return { ok: true, text, chars: shape.textChars ?? text.length };
}

export type CriterionHit = {
  id: string;
  label: string;
  covered: boolean;
  violations: string[];
  weight: number;
};

export type SideScore = {
  chars: number;
  covered: number;
  total: number;
  coverage: number;
  weightedCoverage: number;
  violations: string[];
  criteria: CriterionHit[];
};

export type DeterministicVerdict = "lawmind_above" | "tie" | "lawmind_below";

export type CaseScore = {
  caseId: string;
  taskType: HumanBaselineTaskType;
  rubricIsDraft: boolean;
  lawyer: SideScore;
  lawmind: SideScore;
  verdict: DeterministicVerdict;
  /** 盲评里 A 侧是不是 LawMind（评分者不可见）。 */
  lawmindIsA: boolean;
};

function norm(text: string): string {
  return text.toLowerCase().replace(/\s+/g, "");
}

/** 覆盖判定：allOf 全中、或 anyOf 至少一中；mustNotAppear 命中即违规（不论覆盖）。 */
export function scoreSide(text: string, rubric: BaselineRubric): SideScore {
  const hay = norm(text);
  const criteria: CriterionHit[] = [];
  for (const c of rubric.criteria) {
    const weight = c.weight ?? 1;
    const allOk = (c.allOf ?? []).every((needle) => hay.includes(norm(needle)));
    const anyList = c.anyOf ?? [];
    const anyOk = anyList.length === 0 ? true : anyList.some((n) => hay.includes(norm(n)));
    const hasRequirement = (c.allOf?.length ?? 0) > 0 || anyList.length > 0;
    const covered = hasRequirement ? allOk && anyOk : true;
    const violations = (c.mustNotAppear ?? []).filter((n) => hay.includes(norm(n)));
    criteria.push({ id: c.id, label: c.label, covered, violations, weight });
  }
  const total = criteria.length;
  const covered = criteria.filter((c) => c.covered).length;
  const totalWeight = criteria.reduce((s, c) => s + c.weight, 0) || 1;
  const coveredWeight = criteria.filter((c) => c.covered).reduce((s, c) => s + c.weight, 0);
  return {
    chars: text.length,
    covered,
    total,
    coverage: total === 0 ? 1 : covered / total,
    weightedCoverage: coveredWeight / totalWeight,
    violations: criteria.flatMap((c) => c.violations),
    criteria,
  };
}

/** 盲评 A/B 侧由 caseId 稳定决定，保证同一案每次运行一致且评分者无法推断。 */
export function lawmindIsSideA(caseId: string): boolean {
  let h = 0;
  for (let i = 0; i < caseId.length; i += 1) {
    h = (h * 31 + caseId.charCodeAt(i)) >>> 0;
  }
  return h % 2 === 0;
}

export function compareSides(lawyer: SideScore, lawmind: SideScore): DeterministicVerdict {
  // 违规优先：多一个违规直接判低。
  if (lawmind.violations.length !== lawyer.violations.length) {
    return lawmind.violations.length > lawyer.violations.length ? "lawmind_below" : "lawmind_above";
  }
  const delta = lawmind.weightedCoverage - lawyer.weightedCoverage;
  if (Math.abs(delta) < 0.001) {
    return "tie";
  }
  return delta > 0 ? "lawmind_above" : "lawmind_below";
}

export function readBlindLabel(dir: string): BlindLabel | undefined {
  const file = path.join(dir, "blind-labels.json");
  if (!fs.existsSync(file)) {
    return undefined;
  }
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<BlindLabel>;
    if (raw.preferred !== "A" && raw.preferred !== "B" && raw.preferred !== "tie") {
      return undefined;
    }
    return {
      rater: typeof raw.rater === "string" && raw.rater.trim() ? raw.rater.trim() : "unknown",
      preferred: raw.preferred,
      ...(typeof raw.notes === "string" ? { notes: raw.notes } : {}),
      ...(typeof raw.scoredAt === "string" ? { scoredAt: raw.scoredAt } : {}),
    };
  } catch {
    return undefined;
  }
}

export type BlindPacket = {
  caseId: string;
  taskType: HumanBaselineTaskType;
  instruction?: string;
  criteria: { id: string; label: string }[];
  A: string;
  B: string;
  note: string;
};

/**
 * 盲评包：把两侧正文匿名成 A/B，供人（或独立评审模型）打分。
 * 不含任何提示哪一侧是 LawMind。
 */
export function buildBlindPacket(input: {
  caseId: string;
  taskType: HumanBaselineTaskType;
  instruction?: string;
  criteria: { id: string; label: string }[];
  texts: { lawyer: string; lawmind: string };
}): BlindPacket {
  const lawmindIsA = lawmindIsSideA(input.caseId);
  return {
    caseId: input.caseId,
    taskType: input.taskType,
    ...(input.instruction ? { instruction: input.instruction } : {}),
    criteria: input.criteria,
    A: lawmindIsA ? input.texts.lawmind : input.texts.lawyer,
    B: lawmindIsA ? input.texts.lawyer : input.texts.lawmind,
    note: "A/B 已匿名且随 caseId 固定。请只按量规打分，填 blind-labels.json 的 preferred。",
  };
}

export type HumanBaselineReport = {
  generatedAt: string;
  status: "skip" | "insufficient" | "pass" | "fail";
  dir: string;
  minCasesRequired: number;
  cases: number;
  byTaskType: Partial<Record<HumanBaselineTaskType, number>>;
  deterministic: {
    above: number;
    tie: number;
    below: number;
    /** 律师稿不占优的占比（above + tie）/ cases */
    notBelowRatio: number;
  };
  blind: {
    labeled: number;
    lawmindPreferred: number;
    lawyerPreferred: number;
    tie: number;
    note: string;
  };
  rubricDrafts: string[];
  skipped: { caseId: string; reason: string }[];
  skipReason?: string;
  reportZh: string;
};

export async function runHumanBaseline(opts?: {
  repoRoot?: string;
  require?: boolean;
  workspaceDir?: string;
  writeBlindPackets?: boolean;
  writeRubricDrafts?: boolean;
}): Promise<{
  ok: boolean;
  exitCode: number;
  gate: HumanBaselineGate;
  report: HumanBaselineReport;
  scores: CaseScore[];
}> {
  const gate = inspectHumanBaselineGate(opts?.repoRoot);
  const minCases = HUMAN_BASELINE_MIN_CASES;

  if (!gate.present) {
    const report: HumanBaselineReport = {
      generatedAt: new Date().toISOString(),
      status: "skip",
      dir: gate.dir,
      minCasesRequired: minCases,
      cases: 0,
      byTaskType: {},
      deterministic: { above: 0, tie: 0, below: 0, notBelowRatio: 0 },
      blind: { labeled: 0, lawmindPreferred: 0, lawyerPreferred: 0, tie: 0, note: "未评分" },
      rubricDrafts: [],
      skipped: gate.skipped,
      ...(gate.skipReason ? { skipReason: gate.skipReason } : {}),
      reportZh: `SKIP：${gate.skipReason ?? "人类基准夹具未放入"}`,
    };
    if (opts?.workspaceDir) {
      persistHumanBaselineReport(opts.workspaceDir, report);
    }
    const require = opts?.require === true;
    return { ok: !require, exitCode: require ? 1 : 0, gate, report, scores: [] };
  }

  if (opts?.writeRubricDrafts) {
    await writeHumanBaselineRubricDrafts(gate.dir);
  }
  if (opts?.writeBlindPackets) {
    await writeHumanBaselineBlindPackets(gate.dir);
  }

  const scores: CaseScore[] = [];
  for (const c of gate.cases) {
    const [lawyerText, lawmindText] = await Promise.all([
      readBaselineText(c.dir, c.lawyerFile),
      readBaselineText(c.dir, c.lawmindFile),
    ]);
    if (!lawyerText.ok || !lawmindText.ok) {
      gate.skipped.push({
        caseId: c.caseId,
        reason: !lawyerText.ok ? lawyerText.reason : lawmindText.ok ? "" : lawmindText.reason,
      });
      continue;
    }
    const lawyer = scoreSide(lawyerText.text, c.rubric);
    const lawmind = scoreSide(lawmindText.text, c.rubric);
    scores.push({
      caseId: c.caseId,
      taskType: c.taskType,
      rubricIsDraft: c.rubricIsDraft,
      lawyer,
      lawmind,
      verdict: compareSides(lawyer, lawmind),
      lawmindIsA: lawmindIsSideA(c.caseId),
    });
  }

  const above = scores.filter((s) => s.verdict === "lawmind_above").length;
  const tie = scores.filter((s) => s.verdict === "tie").length;
  const below = scores.filter((s) => s.verdict === "lawmind_below").length;
  const notBelowRatio = scores.length === 0 ? 0 : (above + tie) / scores.length;

  let lawmindPreferred = 0;
  let lawyerPreferred = 0;
  let blindTie = 0;
  let labeled = 0;
  for (const s of scores) {
    const label = readBlindLabel(path.join(gate.dir, s.caseId));
    if (!label) {
      continue;
    }
    labeled += 1;
    if (label.preferred === "tie") {
      blindTie += 1;
    } else if ((label.preferred === "A") === s.lawmindIsA) {
      lawmindPreferred += 1;
    } else {
      lawyerPreferred += 1;
    }
  }

  const byTaskType: Partial<Record<HumanBaselineTaskType, number>> = {};
  for (const s of scores) {
    byTaskType[s.taskType] = (byTaskType[s.taskType] ?? 0) + 1;
  }
  const rubricDrafts = scores.filter((s) => s.rubricIsDraft).map((s) => s.caseId);

  let status: HumanBaselineReport["status"];
  if (scores.length < minCases) {
    status = "insufficient";
  } else if (notBelowRatio >= HUMAN_BASELINE_MIN_NOT_BELOW_RATIO) {
    status = "pass";
  } else {
    status = "fail";
  }

  const reportZh = buildReportZh({
    status,
    cases: scores.length,
    minCases,
    above,
    tie,
    below,
    notBelowRatio,
    labeled,
    lawmindPreferred,
    lawyerPreferred,
    rubricDrafts: rubricDrafts.length,
  });

  const report: HumanBaselineReport = {
    generatedAt: new Date().toISOString(),
    status,
    dir: gate.dir,
    minCasesRequired: minCases,
    cases: scores.length,
    byTaskType,
    deterministic: { above, tie, below, notBelowRatio },
    blind: {
      labeled,
      lawmindPreferred,
      lawyerPreferred,
      tie: blindTie,
      note:
        labeled === 0
          ? "尚无盲评标签（blind-labels.json）；确定性层仍可用于 CI。"
          : `盲评 ${labeled} 案：LawMind 更优 ${lawmindPreferred} · 律师更优 ${lawyerPreferred} · 平 ${blindTie}。`,
    },
    rubricDrafts,
    skipped: gate.skipped,
    reportZh,
  };
  if (opts?.workspaceDir) {
    persistHumanBaselineReport(opts.workspaceDir, report);
  }
  const require = opts?.require === true;
  return {
    ok: status === "pass" || (!require && status === "insufficient"),
    exitCode: status === "fail" || (require && status !== "pass") ? 1 : 0,
    gate,
    report,
    scores,
  };
}

function buildReportZh(input: {
  status: HumanBaselineReport["status"];
  cases: number;
  minCases: number;
  above: number;
  tie: number;
  below: number;
  notBelowRatio: number;
  labeled: number;
  lawmindPreferred: number;
  lawyerPreferred: number;
  rubricDrafts: number;
}): string {
  const pct = Math.round(input.notBelowRatio * 1000) / 10;
  const head =
    input.status === "insufficient"
      ? `INSUFFICIENT：仅 ${input.cases}/${input.minCases} 组同题双稿，不进 pass。`
      : input.status === "pass"
        ? `PASS：${input.cases} 组同题双稿，律师稿不占优 ${pct}%（线 ${HUMAN_BASELINE_MIN_NOT_BELOW_RATIO * 100}%）。`
        : `FAIL：${input.cases} 组同题双稿，律师稿不占优仅 ${pct}%（线 ${HUMAN_BASELINE_MIN_NOT_BELOW_RATIO * 100}%）。`;
  const detail = `确定性层：LawMind 更优 ${input.above} · 平 ${input.tie} · 律师更优 ${input.below}。`;
  const blind =
    input.labeled === 0
      ? "尚无盲评标签。"
      : `盲评 ${input.labeled} 案：LawMind ${input.lawmindPreferred} · 律师 ${input.lawyerPreferred}。`;
  const draft =
    input.rubricDrafts > 0
      ? `注意：${input.rubricDrafts} 案用的是脚本生成的 rubric 草稿，律师确认后才算正式量规。`
      : "";
  return [head, detail, blind, draft].filter(Boolean).join(" ");
}

export function formatHumanBaselineReport(report: HumanBaselineReport): string {
  return report.reportZh;
}

export function persistHumanBaselineReport(
  workspaceDir: string,
  report: HumanBaselineReport,
): string {
  const out = path.join(workspaceDir, "lawmind", "metrics", "human-baseline-report.json");
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return out;
}

/** 为缺量规的案子生成 rubric.draft.json（不覆盖已有 rubric.json；律师随后确认）。 */
export async function writeHumanBaselineRubricDrafts(dir: string): Promise<string[]> {
  const written: string[] = [];
  if (!fs.existsSync(dir)) {
    return written;
  }
  for (const caseId of fs.readdirSync(dir)) {
    const caseDir = path.join(dir, caseId);
    if (!fs.statSync(caseDir).isDirectory() || caseId.startsWith(".")) {
      continue;
    }
    if (fs.existsSync(path.join(caseDir, "rubric.json"))) {
      continue;
    }
    const draftPath = path.join(caseDir, "rubric.draft.json");
    if (fs.existsSync(draftPath)) {
      continue;
    }
    const files = findDraftFiles(caseDir);
    const { lawyerFile, lawmindFile } = classifyBaselinePair(files);
    if (!lawyerFile || !lawmindFile) {
      continue;
    }
    const instructionPath = path.join(caseDir, "instruction.md");
    const instruction = fs.existsSync(instructionPath)
      ? fs.readFileSync(instructionPath, "utf8").trim()
      : "";
    const lawmindText = await readBaselineText(caseDir, lawmindFile);
    const text = lawmindText.ok ? lawmindText.text : "";
    const rubric: BaselineRubric = {
      taskType: guessTaskType(instruction, text),
      criteria: guessCriteria(text),
    };
    fs.writeFileSync(draftPath, `${JSON.stringify(rubric, null, 2)}\n`, "utf8");
    written.push(caseId);
  }
  return written;
}

/** 从交办与正文猜任务类型（草稿，非认定）。 */
export function guessTaskType(instruction: string, text: string): HumanBaselineTaskType {
  const hay = `${instruction}\n${text.slice(0, 3000)}`;
  if (/抽取|提取|列一张表|表格|清单|矩阵|逐条列出/.test(hay)) {
    return "extraction";
  }
  if (/意见书|备忘|分析|论证|检索报告|研究/.test(hay)) {
    return "unstructured_drafting";
  }
  return "structured_drafting";
}

/** 草稿量规：取交付件里较长的早期行作为覆盖点（律师随后编辑）。 */
export function guessCriteria(text: string): BaselineCriterion[] {
  const lines = text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => line.length >= 8 && line.length <= 40);
  const picks = lines.slice(0, 5);
  if (picks.length === 0) {
    return [{ id: "c1", label: "交付件有实质正文", anyOf: [] }];
  }
  return picks.map((line, i) => ({
    id: `c${i + 1}`,
    label: `覆盖：${line.slice(0, 20)}`,
    anyOf: [line],
  }));
}

/** 生成盲评包（blind-<caseId>.json），供评分者打分；不泄露 A/B 对应关系。 */
export async function writeHumanBaselineBlindPackets(dir: string): Promise<string[]> {
  const written: string[] = [];
  if (!fs.existsSync(dir)) {
    return written;
  }
  for (const caseId of fs.readdirSync(dir)) {
    const caseDir = path.join(dir, caseId);
    if (!fs.statSync(caseDir).isDirectory() || caseId.startsWith(".")) {
      continue;
    }
    const loaded = loadHumanBaselineCase(dir, caseId);
    if (!loaded.ok) {
      continue;
    }
    const c = loaded.value;
    const [lawyerText, lawmindText] = await Promise.all([
      readBaselineText(c.dir, c.lawyerFile),
      readBaselineText(c.dir, c.lawmindFile),
    ]);
    if (!lawyerText.ok || !lawmindText.ok) {
      continue;
    }
    const packet = buildBlindPacket({
      caseId: c.caseId,
      taskType: c.taskType,
      ...(c.instruction ? { instruction: c.instruction } : {}),
      criteria: c.rubric.criteria.map((x) => ({ id: x.id, label: x.label })),
      texts: { lawyer: lawyerText.text, lawmind: lawmindText.text },
    });
    fs.writeFileSync(
      path.join(caseDir, `blind-${caseId}.json`),
      `${JSON.stringify(packet, null, 2)}\n`,
      "utf8",
    );
    written.push(caseId);
  }
  return written;
}
