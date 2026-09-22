/**
 * 术语自适应（precedent → 当前文书）。
 *
 * 对标 Spellbook Library：从旧合同取来一条款，不能把**旧文书的那套叫法**一起带进来。
 * 做法分三层，全部确定性、不猜语义：
 *
 * 1. **抽表**：从当前文书正文里抽「已定义术语」（引号定义、括注简称、当事人标签），
 *    得到本文的 canonical 叫法。
 * 2. **对齐**：按调用方显式给出的同义映射（如 {买方: 甲方}）做确定性替换——
 *    谁是「买方」是语义判断，只能由模型/律师给出，引擎不替它猜。
 * 3. **兜底**：替换后仍出现的**外来角色词/外来定义名**会被逐条报出（drift），
 *    不静默放过。只有全部映射清楚，插入的条款才真的沿用本文术语。
 */

import type { ArtifactSection } from "../types.js";

export type DefinedTermSource = "quoted-definition" | "parenthetical-alias" | "party-label";

export type DefinedTerm = {
  /** 本文 canonical 叫法（如「甲方」「公司」）。 */
  term: string;
  /** 定义内容（「甲方」指北京示例科技有限公司 → definition=北京示例科技有限公司）。 */
  definition?: string;
  /** 同一术语的其他写法（如 简称「公司」）。 */
  aliases: string[];
  source: DefinedTermSource;
};

/**
 * 合同当事人角色词：出现在正文里却不是本文已定义术语时，视作外来叫法。
 * 只收「结构性当事人标签」，不收债权人/债务人/客户这类普通名词，避免误报。
 */
export const CONTRACT_ROLE_WORDS = [
  "甲方",
  "乙方",
  "丙方",
  "丁方",
  "买方",
  "卖方",
  "需方",
  "供方",
  "发包人",
  "承包人",
  "转包人",
  "出租人",
  "承租人",
  "出卖人",
  "买受人",
  "委托方",
  "受托方",
  "许可方",
  "被许可方",
  "披露方",
  "接收方",
  "出借人",
  "借款人",
  "保证人",
  "服务方",
  "供应方",
  "采购方",
] as const;

const QUOTE_OPEN = '[“"「『]';
const QUOTE_CLOSE = '[”"」』]';

/** 「甲方」指 / 系指 / 是指 / 即 xxx */
function quotedDefinitionRe(): RegExp {
  return new RegExp(
    `${QUOTE_OPEN}([^”"」』]{1,20})${QUOTE_CLOSE}\\s*(?:系指|是指|指|即为|即|为)\\s*[:：]?\\s*([^，。；、\\n]{2,60})`,
    "g",
  );
}

/** 北京示例科技有限公司（以下简称「公司」） */
function parentheticalAliasRe(): RegExp {
  return new RegExp(
    `([\\u4e00-\\u9fa5A-Za-z0-9()（）·]{2,40})\\s*[（(]\\s*(?:以下简称|以下称|简称)\\s*${QUOTE_OPEN}?([^”"」』）)]{1,20})${QUOTE_CLOSE}?\\s*[）)]`,
    "g",
  );
}

/** 甲方：北京示例科技有限公司 ／ 甲方（北京示例科技有限公司） */
function partyLabelRe(): RegExp {
  return new RegExp(
    `(甲方|乙方|丙方|丁方|买方|卖方|发包人|承包人|出租人|承租人|委托方|受托方|许可方|被许可方|披露方|接收方)\\s*[：:]\\s*([^，。；、\\n]{2,60})`,
    "g",
  );
}

function partyParenRe(): RegExp {
  return new RegExp(
    `(甲方|乙方|丙方|丁方|买方|卖方|发包人|承包人|出租人|承租人|委托方|受托方|许可方|被许可方|披露方|接收方)\\s*[（(]\\s*([^）)]{2,60})\\s*[）)]`,
    "g",
  );
}

function draftText(sections: ArtifactSection[]): string {
  return (sections ?? []).map((s) => s.body ?? "").join("\n");
}

/**
 * 抽当前文书已定义术语表（确定性、只认显式定义写法）。
 * 同一术语多次出现时合并 aliases，后出现者不回退已有 definition。
 */
export function extractDefinedTerms(sections: ArtifactSection[]): DefinedTerm[] {
  return extractDefinedTermsFromText(draftText(sections));
}

/** 同上，直接吃正文文本（供「改写前后对比」这类没有 sections 的场景用）。 */
export function extractDefinedTermsFromText(text: string): DefinedTerm[] {
  const byTerm = new Map<string, DefinedTerm>();

  const upsert = (
    term: string,
    patch: { definition?: string; alias?: string; source: DefinedTermSource },
  ): void => {
    const clean = term.trim();
    if (!clean) {
      return;
    }
    const existing = byTerm.get(clean);
    if (existing) {
      if (patch.definition && !existing.definition) {
        existing.definition = patch.definition;
      }
      if (patch.alias && !existing.aliases.includes(patch.alias)) {
        existing.aliases.push(patch.alias);
      }
      return;
    }
    byTerm.set(clean, {
      term: clean,
      ...(patch.definition ? { definition: patch.definition } : {}),
      aliases: patch.alias ? [patch.alias] : [],
      source: patch.source,
    });
  };

  for (const m of text.matchAll(quotedDefinitionRe())) {
    upsert(m[1] ?? "", { definition: (m[2] ?? "").trim(), source: "quoted-definition" });
  }
  for (const m of text.matchAll(parentheticalAliasRe())) {
    upsert(m[2] ?? "", { alias: (m[1] ?? "").trim(), source: "parenthetical-alias" });
  }
  for (const m of text.matchAll(partyLabelRe())) {
    upsert(m[1] ?? "", { definition: stripAliasSuffix(m[2] ?? ""), source: "party-label" });
  }
  for (const m of text.matchAll(partyParenRe())) {
    upsert(m[1] ?? "", { definition: stripAliasSuffix(m[2] ?? ""), source: "party-label" });
  }

  return [...byTerm.values()];
}

/** 「北京示例科技有限公司（以下简称“公司”）」→「北京示例科技有限公司」 */
function stripAliasSuffix(definition: string): string {
  return definition.replace(/[（(]\s*(?:以下简称|以下称|简称)\s*[^）)]*[）)]\s*$/u, "").trim();
}

function knownLabels(terms: DefinedTerm[]): Set<string> {
  const out = new Set<string>();
  for (const t of terms) {
    out.add(t.term);
    for (const a of t.aliases) {
      out.add(a);
    }
  }
  return out;
}

export type TerminologyDrift = {
  token: string;
  reason: string;
};

/**
 * 工具结果补丁：有新引入的外来叫法时给出字段与提示，否则给空对象。
 * 放在这里而不是工具文件里——工具文件已有行数棘轮，这类小工具不该再撑大它。
 */
export function terminologyWarningsPatch(warnings: TerminologyDrift[]): {
  terminologyWarnings?: TerminologyDrift[];
  terminologyNotice?: string;
} {
  if (warnings.length === 0) {
    return {};
  }
  return {
    terminologyWarnings: warnings,
    terminologyNotice:
      "本次写入出现本文未定义的当事人叫法：请改用本文已定义术语（或用 search_precedents 的 term_map 对齐）后再导出，避免一份文书里两套称谓。",
  };
}

/**
 * 本次改写**新引入**的外来叫法（改写前已存在的不算，避免误报）。
 * 用于落改之后提醒：这批字把另一套称谓带进来了。
 */
export function introducedTerminologyDrift(
  beforeText: string,
  afterText: string,
): TerminologyDrift[] {
  const before = detectTerminologyDrift(beforeText, extractDefinedTermsFromText(beforeText));
  const after = detectTerminologyDrift(afterText, extractDefinedTermsFromText(afterText));
  const seen = new Set(before.map((d) => d.token));
  return after.filter((d) => !seen.has(d.token));
}

/**
 * 报出正文里的外来叫法：① 本文未定义的角色词；② 文本内自带定义的名字。
 * 只报，不改——语义映射必须由调用方给出。
 */
export function detectTerminologyDrift(text: string, terms: DefinedTerm[]): TerminologyDrift[] {
  const known = knownLabels(terms);
  const drift: TerminologyDrift[] = [];
  const seen = new Set<string>();

  for (const role of CONTRACT_ROLE_WORDS) {
    if (known.has(role) || !text.includes(role)) {
      continue;
    }
    seen.add(role);
    drift.push({ token: role, reason: "本文未定义该角色词（外来叫法），插入前须映射到本文术语" });
  }

  for (const m of text.matchAll(quotedDefinitionRe())) {
    const term = (m[1] ?? "").trim();
    if (!term || known.has(term) || seen.has(term)) {
      continue;
    }
    seen.add(term);
    drift.push({ token: term, reason: "该名称只在待插入文本里定义，本文术语表没有它" });
  }

  return drift;
}

export type TerminologySubstitution = { from: string; to: string; count: number };

export type TerminologyAlignment = {
  /** 对齐后的文本（termMap 已确定性替换）。 */
  text: string;
  substitutions: TerminologySubstitution[];
  /** 替换后仍存在的外来叫法（未映射）。 */
  drift: TerminologyDrift[];
  /** 未映射、须由调用方决定去向的外来叫法 token。 */
  unmappedForeignTerms: string[];
  /** 映射目标不在本文术语表里的提醒（不阻断，但要看见）。 */
  warnings: string[];
};

/**
 * 把待插入文本对齐到当前文书术语：先按显式映射替换，再报剩余外来叫法。
 */
export function alignTerminology(input: {
  text: string;
  terms: DefinedTerm[];
  termMap?: Record<string, string>;
}): TerminologyAlignment {
  const { terms } = input;
  const known = knownLabels(terms);
  const warnings: string[] = [];
  const substitutions: TerminologySubstitution[] = [];
  let text = input.text ?? "";

  for (const [fromRaw, toRaw] of Object.entries(input.termMap ?? {})) {
    const from = typeof fromRaw === "string" ? fromRaw.trim() : "";
    const to = typeof toRaw === "string" ? toRaw.trim() : "";
    if (!from) {
      continue;
    }
    if (!to) {
      warnings.push(`映射「${from}」目标为空，已跳过。`);
      continue;
    }
    if (!known.has(to)) {
      warnings.push(`映射「${from}」→「${to}」的目标不是本文已定义术语，请核对。`);
    }
    const count = from === to ? 0 : text.split(from).length - 1;
    if (count > 0) {
      text = text.split(from).join(to);
      substitutions.push({ from, to, count });
    }
  }

  const drift = detectTerminologyDrift(text, terms);
  return {
    text,
    substitutions,
    drift,
    unmappedForeignTerms: drift.map((d) => d.token),
    warnings,
  };
}
