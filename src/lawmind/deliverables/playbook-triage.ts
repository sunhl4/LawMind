/**
 * 剧本三色分流（借鉴 Anthropic legal plugin 的 triage 结构，独立实现）。
 *
 * 借的是**判定结构**，不是它的条款清单：
 * - 所有 `green` 条件都过才 GREEN；任一 `red` 条件命中即 RED；其余 YELLOW。
 * - 每条结论都要带原文引用 + 位置；没有引用的 PASS 不算 PASS。
 * - 没有剧本时明确 `basis=default`，不假装是本所立场。
 *
 * 这个文件是**聚合器**，不判断法律实体：结论由人/模型/条款抽取给出，
 * 这里只负责「证据够不够、三色怎么落、律师 override 有没有留理由」。
 * 中国法域的剧本要单独维护，不从美国 NDA 清单照搬。
 */

import type { Clause, ClauseType } from "../clause/ast.js";
import { formatEvidenceLocator } from "../drafts/evidence-locator.js";

export const PLAYBOOK_VERDICTS = ["GREEN", "YELLOW", "RED"] as const;
export type PlaybookVerdict = (typeof PLAYBOOK_VERDICTS)[number];

export const PLAYBOOK_ITEM_RESULTS = ["PASS", "FLAG", "FAIL"] as const;
export type PlaybookItemResult = (typeof PLAYBOOK_ITEM_RESULTS)[number];

/** `default` = 没有本所剧本，按通用标准说清楚，不当成本所立场。 */
export type PlaybookBasis = "playbook" | "default";

/** 确定性的机械核对方式；没有这一项时由人/模型给结论。 */
export type PlaybookCheck =
  | { kind: "clause_present" }
  | { kind: "section_present"; headings: string[] }
  | { kind: "phrase_present"; phrases: string[] }
  | { kind: "phrase_absent"; phrases: string[] }
  | { kind: "citation_present" };

/** 剧本的一条条件。`green` 全过才 GREEN；`red` 命中（FAIL）即 RED。 */
export type PlaybookCriterion = {
  /** 稳定 id；写进交付依据，改文案不改 id。 */
  id: string;
  kind: "green" | "red";
  /** 律师可读的一句话。 */
  title: string;
  /**
   * 可选的机械核对方式。只有能给出逐字引用 + 位置的正向检查才可能 PASS；
   * 否定性检查（`phrase_absent`）只在命中时 FAIL，未命中一律 FLAG。
   * 其余条件一律 `manual`，必须有人给出结论与引用。
   */
  check?: PlaybookCheck;
  /** `clause_present` 时用哪些条款类型找。 */
  clauseTypes?: ClauseType[];
};

/** 剧本三段式：标准立场 / 可接受区间 / 升级触发。 */
export type Playbook = {
  id: string;
  name: string;
  /** v1 只收中国法域；美国 NDA 条款清单不移植。 */
  jurisdiction: "PRC";
  version: string;
  stance: string;
  acceptableRange: string;
  escalationTriggers: string[];
  criteria: PlaybookCriterion[];
  /**
   * 适用交付物类型（前缀，如 `contract.review` 或 `contract.`）。
   * 缺省/空 = 所有合同类；多份剧本时按这个字段分流，避免互相抢。
   */
  deliverableTypes?: string[];
};

/**
 * 剧本是否适用于这个交付物类型。
 *
 * - 没写适用范围 = 适用于调用方问到的任何合同类交付物；
 * - 写了就按前缀匹配：`contract.` 覆盖全部合同；`contract.review` 也接受其子类型。
 */
export function playbookAppliesToDeliverableType(
  playbook: Pick<Playbook, "deliverableTypes">,
  deliverableType: string | undefined,
): boolean {
  const type = (deliverableType ?? "").trim();
  if (!type) {
    return false;
  }
  const scopes = (playbook.deliverableTypes ?? []).map((scope) => scope.trim()).filter(Boolean);
  if (scopes.length === 0) {
    return true;
  }
  return scopes.some((scope) =>
    scope.endsWith(".") ? type.startsWith(scope) : type === scope || type.startsWith(`${scope}.`),
  );
}

/** 一条结论必须能回指原文：引用 + 位置（`L12` / `P2` / `S1!A1`）。 */
export type PlaybookEvidence = {
  /** 原文引用（逐字）。空白不算引用。 */
  quote: string;
  /** 位置。空串不算位置。 */
  locator: string;
  /** 材料相对路径；有就带上，便于回到原件。 */
  filePath?: string;
};

/** 人工/模型/抽取给出的单条结论。 */
export type PlaybookObservation = {
  criterionId: string;
  result: PlaybookItemResult;
  evidence?: PlaybookEvidence;
  /** 律师可读的理由；缺省按结果给通用文案。 */
  reasonZh?: string;
};

/** 律师把 RED 降档时必须留的理由。 */
export type PlaybookOverride = {
  by: string;
  reason: string;
  at: string;
};

/** PASS 被降级的原因：没有引用 / 没有位置。 */
export type PlaybookDowngrade = "missing_quote" | "missing_locator" | "missing_evidence";

export type PlaybookTriageItem = {
  criterionId: string;
  kind: "green" | "red";
  title: string;
  result: PlaybookItemResult;
  /** 标了 PASS 但证据不足被降成 FLAG 时写在这里。 */
  downgraded?: PlaybookDowngrade;
  evidence?: PlaybookEvidence;
  reasonZh: string;
};

export type PlaybookTriage = {
  verdict: PlaybookVerdict;
  basis: PlaybookBasis;
  playbookId?: string;
  playbookName?: string;
  items: PlaybookTriageItem[];
  counts: { pass: number; flag: number; fail: number };
  /** RED 被律师降档时的留痕；降档后 verdict 变 YELLOW。 */
  override?: PlaybookOverride;
  /** 给了 override 却没写理由：仍按 RED，并标出被拒。 */
  overrideRejected?: true;
  /** 观测里出现、剧本里没有条件的 id。 */
  unknownCriterionIds: string[];
  /**
   * 引用回读核对的结果（见 `playbook-triage-verify.ts`）。
   * 只由「回读核对」入口写入；纯聚合不写这一项。
   */
  evidenceVerification?: PlaybookEvidenceVerification;
};

/**
 * 回读核对计数。
 * - `checked`：拿去回读文件的原句数（同一文件同一句只核一次）
 * - `verified`：原句确实在文件里
 * - `failed`：文件在但原句找不到 / 文件版本变了
 * - `unverifiable`：文件读不了或格式无解析器
 * - `uncheckedEvidence`：给了引用但没有文件路径，回读无从下手，按未核对降级
 */
export type PlaybookEvidenceVerification = {
  checked: number;
  verified: number;
  failed: number;
  unverifiable: number;
  uncheckedEvidence: number;
};

function nonEmpty(value: string | undefined): boolean {
  return Boolean(value?.trim());
}

/** 律师 override 必须同时有署名与理由；缺一不可。 */
export function isPlaybookOverrideValid(override: PlaybookOverride | null | undefined): boolean {
  return Boolean(override && nonEmpty(override.by) && nonEmpty(override.reason));
}

function emptyTriage(): PlaybookTriage {
  return {
    verdict: "YELLOW",
    basis: "default",
    items: [],
    counts: { pass: 0, flag: 0, fail: 0 },
    unknownCriterionIds: [],
  };
}

function reasonForResult(result: PlaybookItemResult, raw: string | undefined): string {
  const trimmed = raw?.trim();
  if (trimmed) {
    return trimmed;
  }
  if (result === "PASS") {
    return "通过，附原文引用与位置。";
  }
  if (result === "FLAG") {
    return "需律师确认；没有给出通过所需的条件。";
  }
  return "不符合剧本要求。";
}

/**
 * 三色分流。
 *
 * 证据规则（硬线）：
 * - PASS 必须同时有 `quote` 与 `locator`，否则降级为 FLAG；
 * - FAIL 没有证据同样降级为 FLAG——没有原文支撑的 FAIL 不足以把整份文书打成 RED；
 * - 没给结论的条件按 FLAG（未核对），不按通过算；
 * - 同一条件出现多条观测时只取第一条，结果确定、不做合并。
 */
export function triageAgainstPlaybook(input: {
  playbook?: Playbook | null;
  observations?: readonly PlaybookObservation[];
  override?: PlaybookOverride | null;
}): PlaybookTriage {
  const playbook = input.playbook;
  if (!playbook || playbook.criteria.length === 0) {
    return emptyTriage();
  }

  const byCriterion = new Map<string, PlaybookObservation>();
  for (const observation of input.observations ?? []) {
    const id = observation.criterionId.trim();
    if (id && !byCriterion.has(id)) {
      byCriterion.set(id, observation);
    }
  }

  const knownIds = new Set(playbook.criteria.map((criterion) => criterion.id));
  const unknownCriterionIds = [...byCriterion.keys()].filter((id) => !knownIds.has(id)).toSorted();

  const items: PlaybookTriageItem[] = playbook.criteria.map((criterion) => {
    const observation = byCriterion.get(criterion.id);
    if (!observation) {
      return {
        criterionId: criterion.id,
        kind: criterion.kind,
        title: criterion.title,
        result: "FLAG",
        reasonZh: "未核对：没有给出这一项的结论。",
      };
    }

    const evidence = observation.evidence;
    const hasQuote = nonEmpty(evidence?.quote);
    const hasLocator = nonEmpty(evidence?.locator);
    const result = observation.result;

    if (result === "PASS" && (!hasQuote || !hasLocator)) {
      return {
        criterionId: criterion.id,
        kind: criterion.kind,
        title: criterion.title,
        result: "FLAG",
        downgraded: !hasQuote
          ? hasLocator
            ? "missing_quote"
            : "missing_evidence"
          : "missing_locator",
        ...(evidence ? { evidence } : {}),
        reasonZh: hasQuote
          ? "标为通过，但没有引用位置；按未核对处理。"
          : "标为通过，但没有原文引用；按未核对处理。",
      };
    }

    if (result === "FAIL" && !hasQuote) {
      return {
        criterionId: criterion.id,
        kind: criterion.kind,
        title: criterion.title,
        result: "FLAG",
        downgraded: hasLocator ? "missing_quote" : "missing_evidence",
        ...(evidence ? { evidence } : {}),
        reasonZh: "标为不符合，但没有原文引用；不足以据此下 RED 结论，按待核对处理。",
      };
    }

    return {
      criterionId: criterion.id,
      kind: criterion.kind,
      title: criterion.title,
      result,
      ...(evidence ? { evidence } : {}),
      reasonZh: reasonForResult(result, observation.reasonZh),
    };
  });

  const counts = {
    pass: items.filter((item) => item.result === "PASS").length,
    flag: items.filter((item) => item.result === "FLAG").length,
    fail: items.filter((item) => item.result === "FAIL").length,
  };

  const redHit = items.some((item) => item.kind === "red" && item.result === "FAIL");
  let verdict: PlaybookVerdict = redHit ? "RED" : counts.pass === items.length ? "GREEN" : "YELLOW";

  const base: PlaybookTriage = {
    verdict,
    basis: "playbook",
    playbookId: playbook.id,
    playbookName: playbook.name,
    items,
    counts,
    unknownCriterionIds,
  };

  if (verdict !== "RED" || !input.override) {
    return base;
  }
  if (!isPlaybookOverrideValid(input.override)) {
    return { ...base, overrideRejected: true };
  }
  verdict = "YELLOW";
  return { ...base, verdict, override: input.override };
}

/**
 * 从条款抽取结果生成「必含条款是否存在」的观测。
 *
 * 只做机械的在场判断：找到条款就给逐字引用 + 行号位置；找不到给 FLAG（不是 FAIL），
 * 因为「没找到」可能是抽取失败，不能凭一次抽取把文书判成 RED。
 * 其余条件（可接受区间、升级触发）仍要人或模型给结论。
 */
export function observationsFromClauseDoc(input: {
  playbook: Playbook;
  doc: Pick<{ text: string; clauses: Clause[] }, "text" | "clauses">;
  filePath?: string;
}): PlaybookObservation[] {
  const clauses = flattenClauses(input.doc.clauses);
  const out: PlaybookObservation[] = [];

  for (const criterion of input.playbook.criteria) {
    if (criterion.check?.kind !== "clause_present") {
      continue;
    }
    const types = new Set<ClauseType>(criterion.clauseTypes ?? []);
    const hit = clauses.find((clause) => types.has(clause.type));
    if (!hit) {
      out.push({
        criterionId: criterion.id,
        result: "FLAG",
        reasonZh: `没有找到「${criterion.title}」对应的条款；可能是抽取失败，请核对原文。`,
      });
      continue;
    }
    const quote = input.doc.text
      .slice(hit.sourceRange.startChar, hit.sourceRange.endChar + 1)
      .trim()
      .slice(0, 2_000);
    out.push({
      criterionId: criterion.id,
      result: "PASS",
      evidence: {
        quote,
        locator: formatEvidenceLocator({
          kind: "line",
          start: hit.sourceRange.startLine,
          end: hit.sourceRange.endLine,
        }),
        ...(input.filePath ? { filePath: input.filePath } : {}),
      },
      reasonZh: `找到「${hit.title || criterion.title}」条款。`,
    });
  }
  return out;
}

function flattenClauses(clauses: readonly Clause[]): Clause[] {
  const out: Clause[] = [];
  for (const clause of clauses) {
    out.push(clause);
    if (clause.children.length > 0) {
      out.push(...flattenClauses(clause.children));
    }
  }
  return out;
}

/** 法条/案号的保守匹配：只认能指出书名的法条、常见法典条号与案号。 */
const CITATION_PATTERN =
  /《[^》\n]{2,80}》\s*第[一二三四五六七八九十百千零〇两0-9]{1,12}条|(?:民法典|刑法|刑事诉讼法|民事诉讼法|行政诉讼法|公司法|劳动合同法|劳动法|著作权法|专利法|商标法|反不正当竞争法|数据安全法|个人信息保护法|网络安全法)\s*第[一二三四五六七八九十百千零〇两0-9]{1,12}条|[（(]\d{4}[）)][^\s，。；]{1,30}号/;

function lineInfoAt(text: string, offset: number): { line: number; lineText: string } {
  const clamped = Math.max(0, Math.min(offset, text.length));
  const line = text.slice(0, clamped).split("\n").length;
  const start = text.lastIndexOf("\n", clamped - 1) + 1;
  const endIndex = text.indexOf("\n", clamped);
  const end = endIndex === -1 ? text.length : endIndex;
  return { line, lineText: text.slice(start, end).trim() };
}

function evidenceAt(
  text: string,
  offset: number,
  length: number,
  filePath?: string,
): PlaybookEvidence {
  const { line, lineText } = lineInfoAt(text, offset);
  const raw = text.slice(offset, offset + length).trim();
  const quote = (lineText.includes(raw) ? lineText : raw || lineText).slice(0, 2_000);
  return {
    quote,
    locator: formatEvidenceLocator({ kind: "line", start: line, end: line }),
    ...(filePath ? { filePath } : {}),
  };
}

function flag(criterion: PlaybookCriterion, reasonZh: string): PlaybookObservation {
  return { criterionId: criterion.id, result: "FLAG", reasonZh };
}

/**
 * 从正文生成机械观测。
 *
 * 安全线：
 * - `section_present` / `phrase_present` / `citation_present` 只有找到具体原文才 PASS；
 *   找不到一律 FLAG（可能是写法不同或抽取失败，不能凭一次没找到判不符合）。
 * - `phrase_absent` 只在命中时 FAIL；未命中不自动 PASS（否定性结论无法用引用证明）。
 * - 合同以外的交付物不跑条款抽取；`clause_present` 条件如实降级为未核对。
 */
export function observationsFromDocument(input: {
  playbook: Playbook;
  text: string;
  clauses?: readonly Clause[];
  filePath?: string;
}): PlaybookObservation[] {
  const text = input.text ?? "";
  const clauses = input.clauses ? flattenClauses(input.clauses) : undefined;
  const out: PlaybookObservation[] = [];

  for (const criterion of input.playbook.criteria) {
    const check = criterion.check;
    if (!check) {
      continue;
    }

    if (check.kind === "clause_present") {
      if (!clauses) {
        out.push(flag(criterion, "当前交付物不是合同文本，无法做条款抽取；请律师核对这一项。"));
        continue;
      }
      const types = new Set<ClauseType>(criterion.clauseTypes ?? []);
      const hit = clauses.find((clause) => types.has(clause.type));
      if (!hit) {
        out.push({
          criterionId: criterion.id,
          result: "FLAG",
          reasonZh: `没有找到「${criterion.title}」对应的条款；可能是抽取失败，请核对原文。`,
        });
        continue;
      }
      const quote = text
        .slice(hit.sourceRange.startChar, hit.sourceRange.endChar + 1)
        .trim()
        .slice(0, 2_000);
      out.push({
        criterionId: criterion.id,
        result: "PASS",
        evidence: {
          quote,
          locator: formatEvidenceLocator({
            kind: "line",
            start: hit.sourceRange.startLine,
            end: hit.sourceRange.endLine,
          }),
          ...(input.filePath ? { filePath: input.filePath } : {}),
        },
        reasonZh: `找到「${hit.title || criterion.title}」条款。`,
      });
      continue;
    }

    if (check.kind === "section_present") {
      const headings = check.headings.map((heading) => heading.trim()).filter(Boolean);
      if (headings.length === 0) {
        out.push(flag(criterion, "没有配置必含章节标题，按未核对处理。"));
        continue;
      }
      const lines = text.split("\n");
      let found: { line: number; lineText: string } | undefined;
      for (let index = 0; index < lines.length; index += 1) {
        const trimmed = lines[index]?.trim() ?? "";
        if (!trimmed) {
          continue;
        }
        const hit = headings.some(
          (heading) =>
            trimmed === heading ||
            trimmed.startsWith(heading) ||
            (trimmed.length <= 80 && trimmed.includes(heading)),
        );
        if (hit) {
          found = { line: index + 1, lineText: trimmed };
          break;
        }
      }
      if (!found) {
        out.push(
          flag(
            criterion,
            `没有找到章节标题「${headings.join(" / ")}」；可能是标题写法不同或抽取失败，请核对原文。`,
          ),
        );
        continue;
      }
      out.push({
        criterionId: criterion.id,
        result: "PASS",
        evidence: {
          quote: found.lineText.slice(0, 2_000),
          locator: formatEvidenceLocator({ kind: "line", start: found.line, end: found.line }),
          ...(input.filePath ? { filePath: input.filePath } : {}),
        },
        reasonZh: `找到章节「${found.lineText.slice(0, 80)}」。`,
      });
      continue;
    }

    if (check.kind === "phrase_present") {
      const phrases = check.phrases.map((phrase) => phrase.trim()).filter(Boolean);
      if (phrases.length === 0) {
        out.push(flag(criterion, "没有配置必含表述，按未核对处理。"));
        continue;
      }
      const hit = phrases
        .map((phrase) => ({ phrase, index: text.indexOf(phrase) }))
        .find((item) => item.index >= 0);
      if (!hit) {
        out.push(
          flag(
            criterion,
            `没有找到必含表述「${phrases.join(" / ")}」；未命中可能是写法不同，请核对原文。`,
          ),
        );
        continue;
      }
      out.push({
        criterionId: criterion.id,
        result: "PASS",
        evidence: evidenceAt(text, hit.index, hit.phrase.length, input.filePath),
        reasonZh: `找到必含表述「${hit.phrase}」。`,
      });
      continue;
    }

    if (check.kind === "phrase_absent") {
      const phrases = check.phrases.map((phrase) => phrase.trim()).filter(Boolean);
      if (phrases.length === 0) {
        out.push(flag(criterion, "没有配置禁止表述，按未核对处理。"));
        continue;
      }
      const hit = phrases
        .map((phrase) => ({ phrase, index: text.indexOf(phrase) }))
        .find((item) => item.index >= 0);
      if (!hit) {
        out.push(
          flag(
            criterion,
            `全文没有命中禁止表述「${phrases.join(" / ")}」；否定性结论没有原文可引用，需律师确认。`,
          ),
        );
        continue;
      }
      out.push({
        criterionId: criterion.id,
        result: "FAIL",
        evidence: evidenceAt(text, hit.index, hit.phrase.length, input.filePath),
        reasonZh: `出现禁止表述「${hit.phrase}」。`,
      });
      continue;
    }

    const match = CITATION_PATTERN.exec(text);
    if (!match) {
      out.push(
        flag(criterion, "没有找到带书名的法条或案号引用；未命中不等于没有依据，请律师核对。"),
      );
      continue;
    }
    const index = match.index;
    out.push({
      criterionId: criterion.id,
      result: "PASS",
      evidence: evidenceAt(text, index, match[0].length, input.filePath),
      reasonZh: `找到法律依据引用「${match[0]}」。`,
    });
  }

  return out;
}

/** 一句律师可读的结论，带依据来源；不出现任何「正确率」。 */
export function describePlaybookTriage(triage: PlaybookTriage): string {
  const counts = `${triage.counts.pass} 项通过 / ${triage.counts.flag} 项待定 / ${triage.counts.fail} 项不符合`;
  const basis =
    triage.basis === "playbook"
      ? `依据：本所剧本${triage.playbookName ? `「${triage.playbookName}」` : ""}`
      : "依据：通用标准（未加载本所剧本，不代表本所立场）";
  const verdict =
    triage.verdict === "GREEN"
      ? "GREEN（全部条件有据通过，仍需一键签发）"
      : triage.verdict === "YELLOW"
        ? "YELLOW（需律师逐项确认）"
        : "RED（有条件不符合，须全面审阅）";
  const override = triage.override
    ? `；已由 ${triage.override.by} 降档，理由：${triage.override.reason}`
    : triage.overrideRejected
      ? "；降档未生效：缺理由或署名"
      : "";
  const verification = verificationLine(triage.evidenceVerification);
  return `${verdict}。${counts}。${basis}${override}。${verification}`;
}

function verificationLine(verification: PlaybookEvidenceVerification | undefined): string {
  if (!verification) {
    return "";
  }
  const touched =
    verification.verified +
    verification.failed +
    verification.unverifiable +
    verification.uncheckedEvidence;
  if (touched === 0) {
    return "";
  }
  const parts = [`${verification.verified} 条已核`];
  if (verification.failed > 0) {
    parts.push(`${verification.failed} 条对不上原文`);
  }
  if (verification.unverifiable > 0) {
    parts.push(`${verification.unverifiable} 条无法核`);
  }
  if (verification.uncheckedEvidence > 0) {
    parts.push(`${verification.uncheckedEvidence} 条没有文件路径`);
  }
  return `引用核对：${parts.join("、")}。`;
}
