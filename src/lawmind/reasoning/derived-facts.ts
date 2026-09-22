/**
 * 派生事实（derived facts）——把**该算的算好**，作为素材喂给模型。
 *
 * ## 这一类解决什么问题
 *
 * [LAWMIND-DECISION-LAYER-PLAN.md](../../docs/lawmind/LAWMIND-DECISION-LAYER-PLAN.md) §3.8 把
 * 判断层的东西分成四类，并指出 LawMind 原先只有第一类与第四类：
 *
 * | 类 | 是什么 | 该有多少 |
 * | -------- | -------------- | ------------ |
 * | **闸** | 有拦停权的规则 | 极少 |
 * | **算** | 算术/查表/日期 | **少，但每个都该做** |
 * | **范例** | 律师改过的样子 | 越多越好 |
 * | **判断** | 其余全部 | 绝大多数 |
 *
 * 本模块是**第二类**。它的存在理由是实测出来的：
 *
 * > 真实采购合同里，定金 310,000 元 ÷ 标的额 1,032,000 元 = **30.04%**，
 * > 超《民法典》第 586 条的 20% 上限——这是那份合同**最严重的实体缺陷**，
 * > 而规则 `statutory.deposit_cap` **静默放过了它**，因为规则只匹配
 * > `定金…(\d+)%` 这种**显式百分比**写法，而真实合同只写金额。
 *
 * 关键认识：**模型失败的往往不是判断，是算术。** 它在猜下一个 token，不在做除法。
 * 所以正确的做法既不是再加一条正则（还是会漏、还会误报），也不是"让模型更聪明"，
 * 而是**把该算的算好，交给模型判断**。
 *
 * ## 三条硬约束
 *
 * ### 1. 事实，不是结论
 *
 * 本模块只说**数字与出处**，不下法律判断：
 *
 * ```text
 * ✅ 「定金 310,000 元占标的额 1,032,000 元的 30.04%；《民法典》第586条载明的上限为 20%」
 * ❌「该条款违反法律，必须修改」        ← 法律结论，不是本模块的职权
 * ❌「超出部分不产生定金效力」          ← 同上（那是法律后果的论证）
 * ```
 *
 * 区别在于可追溯性：前者是「算 + 引」，律师与模型都能自己复核；
 * 后者是「断言」，错了没人看得出来。
 *
 * ### 2. 必须给出算式
 *
 * 每条事实都带 `arithmetic` 字段，把中间步骤写出来。
 * **这是「素材」与「神谕」的分界**——模型看到 `310000 ÷ 1032000 = 0.3004`
 * 才能自己判断这个数意味着什么；只给一个「30.04%」它只能照抄。
 *
 * ### 3. 算不出来就**什么都不说**
 *
 * 找不到「合同总价款/标的额」这类明确标记时，**不猜、不输出**。
 * 猜错一个标的额会产出一个看似权威的错误数字——那比没有事实更糟。
 * 本模块不返回「低置信度的猜测」，只返回它能**证明**的东西。
 *
 * ## 与门禁的关系：无
 *
 * 本模块的产出**没有任何拦停权**，只作为 prompt 素材（与改稿范例、黄金范例同类）。
 * 因此：任何异常一律吞掉；算不出就是空数组；永不抛。
 */

import fs from "node:fs";
import path from "node:path";
import { matterMaterialsDir, listMatterMaterialFiles } from "../desk/matter-materials.js";
import { parseChineseInteger } from "../lint/chinese-numeral.js";
import { DEFAULT_LIMITATION, DEPOSIT_CAP } from "../lint/statute-params.js";

// ─────────────────────────────────────────────
// 类型
// ─────────────────────────────────────────────

/** 一条派生事实。**只有数字与出处，没有法律结论。** */
export type DerivedFact = {
  /** 机器可读的类型，便于消费方筛选（如 `deposit_cap_ratio`）。 */
  kind: string;
  /** 人可读的事实陈述（中文，含数字与出处）。 */
  statement: string;
  /** 算式与中间步骤——让模型/律师可复核，这是本模块的核心价值。 */
  arithmetic: string;
  /** 依据出处（法条 / 标准）。可追溯，不写「依据相关规定」。 */
  citations: string[];
  /** 计算所依据的原文片段，便于律师回原文核对。 */
  provenance: Array<{ label: string; span: string }>;
};

export type DerivedFactsOptions = {
  /** 当前交付物类型——用于判断哪些事实与本次交办相关。 */
  deliverableType?: string;
  /** 单次最多产出多少条（防 prompt 膨胀）。 */
  limit?: number;
};

/**
 * 默认**不按条数截断**（`Infinity`）。
 *
 * 这里曾经是 `4`，后果是一次**静默丢弃**：`COMPUTERS` 的顺序就是优先级，而
 * `collectDerivedFacts` 在渲染前先 `slice(0, limit)`。于是生产路径
 * （`turn-orchestrator-prompt.ts` → `loadDerivedFactsForMatter`，不传 `limit`）
 * 永远只看得到**前 4 类**事实；排在后面的 `payment_ratio_sum` /
 * `limitation_deadline` / `deadline` / `penalty_asymmetry` 在真实回合里
 * **从未出现过**——而文档与测试却在说「九类事实已闭环到 prompt」。
 *
 * 真正的截断点是 `formatDerivedFactsPromptBlock` 的字符预算：它**整条取舍**，
 * 并且把「还剩几条没展开」写进正文（可见）。条数上限在这里既多余、丢弃又不可见，
 * 所以默认关掉；需要硬上界的调用方仍可显式传 `limit`。
 */
export const DEFAULT_DERIVED_FACTS_LIMIT = Number.POSITIVE_INFINITY;

// ─────────────────────────────────────────────
// 金额解析
// ─────────────────────────────────────────────

/** 一个金额命中：数值 + 原文片段 + 位置。 */
export type MoneyHit = {
  /** 折算成「元」的数值。 */
  value: number;
  /** 原文片段（含单位），供律师核对。 */
  span: string;
  index: number;
};

const ARABIC_MONEY_RE = /([0-9][0-9,]*(?:\.[0-9]+)?)\s*(万元|万|元)/g;

/**
 * 解析文本里的阿拉伯数字金额，统一折算成「元」。
 *
 * **刻意不支持中文大写金额**（壹佰零叁万贰仟元）：现有 `chinese-numeral.ts`
 * 只覆盖 0–999（十/百，且不含 壹贰叁 大写），硬扩会引入一套没人验证过的解析器。
 * 宁可少算——见模块头第 3 条。绝大多数合同同时写阿拉伯数字，够用。
 *
 * 返回 NaN 的条目被丢弃（不产生「未识别」噪声）。
 */
export function findMoneyAmounts(text: string): MoneyHit[] {
  const out: MoneyHit[] = [];
  for (const m of text.matchAll(ARABIC_MONEY_RE)) {
    const raw = (m[1] ?? "").replace(/,/g, "");
    const n = Number.parseFloat(raw);
    if (!Number.isFinite(n) || n <= 0) {
      continue;
    }
    const unit = m[2] ?? "";
    const value = unit === "元" ? n : n * 10_000;
    out.push({ value, span: (m[0] ?? "").trim(), index: m.index ?? 0 });
  }
  return out;
}

/**
 * 截取 `index` 起到**本句结束**之间的文本。
 *
 * 这是本模块核心纪律的载体：**标记与它的取值必须同句，且取值要在标记之后**。
 * 实测抓到的四处误报都是同一个形状——用「标记后 N 字」的窗口，窗口跨过句号之后
 * 就把**下一个条款**的数字算到本标记头上：
 *   - 「已含于总价款内）」→ 抓到了下一条的 722,400 元
 *   - 「第二条 定金」这个标题 → 抓到了下一条的金额
 *   - 付款条款结尾的「已含于总价款内」→ 把 722,400 贴上了「价款」名目
 *
 * 而只做「取本句」还不够（第一版修法就栽在这）：合同常把单价与总价写在**同一句**里
 * ——「……单价 86,000 元，合同总价款为 1032000 元。」取本句的**第一个**金额会拿到
 * 单价。所以必须是**标记之后到句末**这一段。
 */
export function sentenceAfter(text: string, index: number): string {
  const stop = new Set(["。", "\n", "；", "！", "？"]);
  for (let i = index; i < text.length; i += 1) {
    if (stop.has(text[i] ?? "")) {
      return text.slice(index, i);
    }
  }
  return text.slice(index);
}

/**
 * 截取 `index` **所在**的整句（前后都取）。
 *
 * 与 `sentenceAfter` 的分工：
 *   - **取值**用 `sentenceAfter`（值必须出现在标记之后）；
 *   - **判语境**用 `sentenceAround`（语境可能在前面，如「甲方逾期付款的，每逾期一日按……5%」，
 *     百分比在「逾期」之后但在句首的语境词之后——只看后面会漏掉「逾期」这个信号）。
 *
 * 数量也用 `sentenceAround`：合同常把数量写在单价**之前**
 * （「供应 12 台，……，单价 86,000 元」），只看后面取不到数量。
 */
/** 句末标点集合——`sentenceAfter` / `sentenceAround` / `sentenceBefore` 共用。 */
const SENTENCE_STOP = new Set(["。", "\n", "；", "！", "？"]);

/**
 * 截取 `index` **之前**到上句末之间的文本（不含 index 处）。
 *
 * 用途：取「百分比之前紧邻的名目」——名目总在数字**前面**
 * （「余款 5%」），用 `sentenceAfter` 取不到。
 */
export function sentenceBefore(text: string, index: number): string {
  let start = 0;
  for (let i = index - 1; i >= 0; i -= 1) {
    if (SENTENCE_STOP.has(text[i] ?? "")) {
      start = i + 1;
      break;
    }
  }
  return text.slice(start, index);
}

export function sentenceAround(text: string, index: number): string {
  const stop = SENTENCE_STOP;
  let start = 0;
  for (let i = index - 1; i >= 0; i -= 1) {
    if (stop.has(text[i] ?? "")) {
      start = i + 1;
      break;
    }
  }
  let end = text.length;
  for (let i = index; i < text.length; i += 1) {
    if (stop.has(text[i] ?? "")) {
      end = i;
      break;
    }
  }
  return text.slice(start, end);
}

/**
 * 带标记的金额：先定位标记词，再取**同句内其正后方**的第一个金额。
 *
 * 之所以要用「标记 + 同句金额」而不是全文扫金额：一份合同里有十几个金额，
 * 只有紧跟标记的那个才属于该标记。这是"不猜"的具体实现。
 *
 * **必须遍历标记的全部出现**，不能只看第一次——实测抓到的 bug：
 * 「## 第二条 定金」这种**章节标题**会先命中标记，而标题后没有金额，
 * 于是整个计算被放弃、真实的那条规定反而没被读到。
 */
function findLabelledAmount(
  text: string,
  markers: readonly RegExp[],
): { hit: MoneyHit; marker: string; head: number } | undefined {
  for (const marker of markers) {
    // 逐个出现地试；标记本身可能出现在标题、正文、附件描述等多处。
    const global = new RegExp(marker.source, `${marker.flags.replace(/g/g, "")}g`);
    for (const m of text.matchAll(global)) {
      const start = (m.index ?? 0) + m[0].length;
      const hit = findMoneyAmounts(sentenceAfter(text, start))[0];
      if (hit) {
        return { hit: { ...hit, index: start + hit.index }, marker: m[0], head: m.index ?? 0 };
      }
    }
  }
  return undefined;
}

// ─────────────────────────────────────────────
// 定金上限事实（第一个 computer，也是本模块的起因）
// ─────────────────────────────────────────────

/** 合同标的额/总价款的常见写法。**只认明确的总额标记**，不认单价、不含「已付」。 */
const TOTAL_MARKERS: readonly RegExp[] = [
  /合同总价款(?:为|：|:)?\s*/,
  /合同总金额(?:为|：|:)?\s*/,
  /合同价款总额(?:为|：|:)?\s*/,
  /合同金额(?:为|：|:)?\s*/,
  /合同标的额(?:为|：|:)?\s*/,
  /价款总额(?:为|：|:)?\s*/,
  /总价款(?:为|：|:)?\s*/,
  /标的额(?:为|：|:)?\s*/,
];

/** 定金标记。**只认「定金」**——「订金」在法律上不是定金，混入会产出错误事实。 */
const DEPOSIT_MARKERS: readonly RegExp[] = [/定金(?:为|：|:)?\s*/];

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * 算式里的比值保留 4 位小数。
 *
 * 用 `round2` 会把 0.3004 显示成 `0.3`，与同一行末尾的 `→ 30.04%` **自相矛盾**——
 * 而本模块的全部立论是「算式可复核」。一个看起来算错的算式会直接毁掉这份信任，
 * 所以这里的精度是功能需求，不是格式偏好。
 */
function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}

function formatYuan(n: number): string {
  return `${n.toLocaleString("en-US")} 元`;
}

/**
 * 定金上限事实：从「定金金额 ÷ 合同标的额」算出真实占比，与法定上限比较。
 *
 * 产出示例：
 *
 * ```text
 * statement  定金 310,000 元占合同标的额 1,032,000 元的 30.04%；
 *            《民法典》第586条载明的上限为标的额的 20%（即 206,400 元），
 *            当前占比高出 10.04 个百分点，金额上高出 103,600 元。
 * arithmetic 310000 ÷ 1032000 = 0.3004 → 30.04%
 *            1032000 × 20% = 206400
 *            310000 − 206400 = 103600
 * citations  民法典第586条
 * ```
 *
 * **注意产出的是「占比与上限」而不是「该条款无效」**——见模块头第 1 条。
 */
export function computeDepositCapFact(text: string): DerivedFact | undefined {
  if (!/定金/.test(text)) {
    return undefined;
  }
  const total = findLabelledAmount(text, TOTAL_MARKERS);
  if (!total) {
    // 找不到明确的标的额 → 不猜（模块头第 3 条）
    return undefined;
  }
  const deposit = findLabelledAmount(text, DEPOSIT_MARKERS);
  if (!deposit) {
    return undefined;
  }
  const capRatio = DEPOSIT_CAP.value; // 0.2
  const actualRatio = deposit.hit.value / total.hit.value;
  const capAmount = total.hit.value * capRatio;
  const overAmount = deposit.hit.value - capAmount;

  const actualPct = round2(actualRatio * 100);
  const capPct = round2(capRatio * 100);
  const overPoints = round2(actualPct - capPct);

  const provenance = [
    { label: "合同标的额", span: total.hit.span },
    { label: "定金", span: deposit.hit.span },
  ];

  if (actualRatio <= capRatio) {
    // 未超上限也是**有用的事实**（模型不必再自己算），故照常产出。
    return {
      kind: "deposit_cap_ratio",
      statement:
        `定金 ${formatYuan(deposit.hit.value)} 占合同标的额 ${formatYuan(total.hit.value)} 的 ${actualPct}%；` +
        `${DEPOSIT_CAP.source}载明的上限为标的额的 ${capPct}%（即 ${formatYuan(round2(capAmount))}），当前占比未超上限。`,
      arithmetic: [
        `${deposit.hit.value} ÷ ${total.hit.value} = ${round4(actualRatio)} → ${actualPct}%`,
        `${total.hit.value} × ${capPct}% = ${round2(capAmount)}`,
      ].join("\n"),
      citations: [DEPOSIT_CAP.source],
      provenance,
    };
  }

  return {
    kind: "deposit_cap_ratio",
    statement:
      `定金 ${formatYuan(deposit.hit.value)} 占合同标的额 ${formatYuan(total.hit.value)} 的 ${actualPct}%；` +
      `${DEPOSIT_CAP.source}载明的上限为标的额的 ${capPct}%（即 ${formatYuan(round2(capAmount))}），` +
      `当前占比高出 ${overPoints} 个百分点，金额上高出 ${formatYuan(round2(overAmount))}。`,
    arithmetic: [
      `${deposit.hit.value} ÷ ${total.hit.value} = ${round4(actualRatio)} → ${actualPct}%`,
      `${total.hit.value} × ${capPct}% = ${round2(capAmount)}`,
      `${deposit.hit.value} − ${round2(capAmount)} = ${round2(overAmount)}`,
    ].join("\n"),
    citations: [DEPOSIT_CAP.source],
    provenance,
  };
}

// ─────────────────────────────────────────────
// 交付物类型事实（解「合同类规则用在信函上」的困惑）
// ─────────────────────────────────────────────

/**
 * 交付物类型 → 文书体裁。**这张表是「事实」而非「判断」**：
 * 类型由路由决定，体裁是行业共识，两者都不需要模型去猜。
 *
 * **精确匹配优先于前缀匹配**，因为有几个类型名会误导：
 * `contract.review` 的前缀是 `contract.`，但它产出的是**审查意见书**（对合同的分析），
 * 不是合同文本本身。按前缀归到「合同文本」会给出完全相反的提示——
 * 而实测中恰好是它踩了 `consistency.party_pair`。
 */
const EXACT_GENRES: Readonly<Record<string, { genre: string; note: string }>> = {
  "contract.review": {
    genre: "合同审查意见书",
    note: "这是对合同的**分析**，不是合同文本本身；文中提及当事人属引用，不构成合同主体成对性要求。",
  },
};

const PREFIX_GENRES: ReadonlyArray<{ prefix: string; genre: string; note: string }> = [
  {
    prefix: "letter.",
    genre: "函件",
    note: "函件只需指明收件人；合同的「双方主体须成对出现」不构成对函件的要求。",
  },
  {
    prefix: "contract.",
    genre: "合同文本",
    note: "合同文本中双方主体成对出现是常规要求。",
  },
  {
    prefix: "memo.",
    genre: "备忘录 / 意见书",
    note: "备忘录讨论的是合同，本身不是合同文本；提及当事人属引用，不构成主体成对性要求。",
  },
  {
    prefix: "litigation.",
    genre: "诉讼文书",
    note: "诉讼文书按诉讼地位（原告/被告）称谓，不以合同甲乙方为组织方式。",
  },
];

/** 解析交付物类型对应的体裁。导出供测试直接覆盖全表。 */
export function resolveDocumentGenre(
  deliverableType?: string,
): { genre: string; note: string } | undefined {
  const dt = deliverableType?.trim();
  if (!dt) {
    return undefined;
  }
  const exact = EXACT_GENRES[dt];
  if (exact) {
    return exact;
  }
  const byPrefix = PREFIX_GENRES.find((g) => dt.startsWith(g.prefix));
  return byPrefix ? { genre: byPrefix.genre, note: byPrefix.note } : undefined;
}

/**
 * 交付物体裁事实：本次写的是哪一类文书。
 *
 * **为什么这条事实值得存在**：实测发现「把合同类规则用在信函上」会系统性误报——
 * 一封催告函的**摘要**写了「催告乙方按约交付设备」，就触发了
 * `consistency.party_pair`（要求正文同时出现甲方与乙方）。
 * 模型本来写得好好的，规则凭空插一脚。
 *
 * 本事实**不**去改那条规则（那是闸的层面，另有归属），只把「这是函件不是合同」
 * 这个本就由路由决定的事实**明确摆给模型**，让它自己判断主体成对性是否需要考虑。
 *
 * 事实很短（约 100 字），所以**排在块首**：它决定模型怎么理解整篇文书，
 * 而后面那些数字只在这一层框对了之后才有意义。
 */
export function computeDeliverableScopeFact(
  _text: string,
  ctx: { deliverableType?: string },
): DerivedFact | undefined {
  const dt = ctx.deliverableType?.trim();
  const resolved = resolveDocumentGenre(dt);
  if (!dt || !resolved) {
    return undefined;
  }
  return {
    kind: "deliverable_scope",
    statement: `本次要写的是「${dt}」，属**${resolved.genre}**。${resolved.note}`,
    arithmetic: `${dt} → ${resolved.genre}`,
    citations: [],
    provenance: [{ label: "交付物类型", span: dt }],
  };
}

// ─────────────────────────────────────────────
// 付款分项合计（会算出「付的钱比总价还多」这类硬矛盾）
// ─────────────────────────────────────────────

/** 付款项常见名目。用于把同一笔钱在「专项条款」与「付款条款」里的**重复表述**去重。 */
const PAYMENT_ITEM_LABELS = [
  "定金",
  "预付款",
  "首付款",
  "进度款",
  "质保金",
  "保证金",
  "尾款",
  "余款",
  "货款",
  "价款",
] as const;

const PAYMENT_VERB_RE = /(支付|付给|支付给|转付|预付|给付)/;

export type PaymentItem = {
  /** 名目（如「定金」）；无名目时为空串。 */
  label: string;
  value: number;
  span: string;
};

/**
 * 找出**明确带支付动词**的款项金额。
 *
 * 只认带动词的（「支付定金 310,000 元」），不认裸金额（「合同总价款为 1,032,000 元」、
 * 「单价 86,000 元」）——否则会把总价、单价一起算进去。
 */
export function findPaymentItems(text: string): PaymentItem[] {
  const out: PaymentItem[] = [];
  for (const hit of findMoneyAmounts(text)) {
    const raw = text.slice(Math.max(0, hit.index - 24), hit.index);
    // **不跨句取标签**：实测抓到的错误归属——4.1 结尾的「已含于总价款内」落在
    // 4.2 金额的前 24 字窗口内，于是 722,400 被贴上「价款」这个并不存在的名目。
    // 取最后一个句/分句/换行之后的片段，标签与动词只在**本句**里找。
    const seg = raw.split(/[。；\n]/).pop() ?? "";
    if (!PAYMENT_VERB_RE.test(seg)) {
      continue;
    }
    const label = PAYMENT_ITEM_LABELS.find((l) => seg.includes(l)) ?? "";
    out.push({ label, value: hit.value, span: hit.span });
  }
  return out;
}

/**
 * 付款分项合计 vs 合同总价。
 *
 * 产出示例（本仓真实 fixture 的结果）：
 *
 * ```text
 * statement  合同总价款 1,032,000 元；付款分项合计 1,032,400 元
 *            （定金 310,000 元 + 无明确名目 722,400 元），
 *            比总价多 400 元。
 * ```
 *
 * **去重口径**：同一笔钱常在「专项条款」与「付款条款」各写一次（如定金在第二条与
 * 第四条各出现一次）。按「名目」去重，避免把同一笔算两遍。无名目的按金额去重。
 *
 * **保守边界**：
 *   - 只有 ≥2 个分项才产出（单项无法构成合计矛盾）；
 *   - 差额绝对值 < 1 元视为一致（避免浮点噪声）；
 *   - 以**百分比**表述的分项（如「余款 5%」）不参与合计——没有绝对值就无法相加，
 *     硬算就是猜。这一条会写进产出，不让模型误以为合计已完整。
 */
export function computePaymentSumFact(text: string): DerivedFact | undefined {
  const total = findLabelledAmount(text, TOTAL_MARKERS);
  if (!total) {
    return undefined;
  }
  const items = findPaymentItems(text);
  if (items.length < 2) {
    return undefined;
  }

  // 按名目去重（无名目则按金额），保留首次出现。
  const seen = new Set<string>();
  const unique: PaymentItem[] = [];
  for (const it of items) {
    const key = it.label || `__amount_${it.value}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(it);
  }
  if (unique.length < 2) {
    return undefined;
  }

  const sum = unique.reduce((acc, it) => acc + it.value, 0);
  const diff = sum - total.hit.value;
  const labelText = unique
    .map((it) => `${it.label || "无明确名目"} ${formatYuan(it.value)}`)
    .join(" + ");

  const arithmetic = [
    `${unique.map((it) => it.value).join(" + ")} = ${sum}`,
    `${sum} − ${total.hit.value} = ${round2(diff)}`,
  ].join("\n");

  const percentageCaveat = "（以百分比表述的分项未计入——没有绝对值无法相加）";

  if (Math.abs(diff) < 1) {
    return {
      kind: "payment_sum",
      statement: `合同标的额 ${formatYuan(total.hit.value)}；付款分项合计 ${formatYuan(sum)}（${labelText}），与总价一致${percentageCaveat}。`,
      arithmetic,
      citations: [],
      provenance: [
        { label: "合同标的额", span: total.hit.span },
        ...unique.map((it) => ({ label: it.label || "付款项", span: it.span })),
      ],
    };
  }

  return {
    kind: "payment_sum",
    statement:
      `合同标的额 ${formatYuan(total.hit.value)}；付款分项合计 ${formatYuan(sum)}（${labelText}），` +
      `比总价${diff > 0 ? "多" : "少"} ${formatYuan(Math.abs(round2(diff)))}${percentageCaveat}。`,
    arithmetic,
    citations: [],
    provenance: [
      { label: "合同标的额", span: total.hit.span },
      ...unique.map((it) => ({ label: it.label || "付款项", span: it.span })),
    ],
  };
}

// ─────────────────────────────────────────────
// 逾期违约金结构（两侧是否对称）
// ─────────────────────────────────────────────

/** 基数的常见写法。抽出来是为了让产出能说清「两侧基数是否可比」。 */
const PENALTY_RE =
  /(甲方|乙方|卖方|买方|供方|需方)[^。；\n]{0,40}?逾期[^。；\n]{0,50}?(?:按|按照|以)?\s*(合同总价款|合同价款|总价款|逾期金额|未付金额|未支付金额|逾期未付部分)[^。；\n]{0,12}?(\d+(?:\.\d+)?)\s*%/g;

export type PenaltyTerm = { side: string; basis: string; ratePerDay: number; span: string };

/** 抽取「某方逾期……按某基数 X%/日」的条款。 */
export function findOverduePenaltyTerms(text: string): PenaltyTerm[] {
  const out: PenaltyTerm[] = [];
  for (const m of text.matchAll(new RegExp(PENALTY_RE.source, "g"))) {
    const rate = Number.parseFloat(m[3] ?? "");
    if (!Number.isFinite(rate) || rate <= 0) {
      continue;
    }
    out.push({
      side: m[1] ?? "",
      basis: m[2] ?? "",
      ratePerDay: rate,
      span: (m[0] ?? "").replace(/\s+/g, " ").trim(),
    });
  }
  return out;
}

/**
 * 逾期违约金两侧结构对比。
 *
 * **只陈述事实，不判「不公平」。** 产出会说清两件事：
 *   1. 两侧的费率与**基数**各是什么；
 *   2. 基数是否相同——**不同则不可直接比较**。
 *
 * 这是刻意的：把「5% 对 0.05%」直接说成「100 倍不利」是错的，
 * 因为一侧基数是合同总价款、另一侧是逾期金额。**基数不同时比较倍数没有意义。**
 * 本模块只给出可比性的判断材料，是否不公平由模型与律师判断。
 */
export function computePenaltyAsymmetryFact(text: string): DerivedFact | undefined {
  const terms = findOverduePenaltyTerms(text);
  if (terms.length < 2) {
    return undefined;
  }
  const bases = [...new Set(terms.map((t) => t.basis))];
  const sameBasis = bases.length === 1;

  const listed = terms
    .map((t) => `${t.side}一侧 ${t.ratePerDay}%/日（基数：${t.basis}）`)
    .join("；");

  const maxRate = Math.max(...terms.map((t) => t.ratePerDay));
  const minRate = Math.min(...terms.map((t) => t.ratePerDay));
  const ratio = minRate > 0 ? maxRate / minRate : 0;

  const comparability = sameBasis
    ? `两侧基数相同（${bases[0]}），费率可直接比较：最高与最低相差 ${round4(ratio)} 倍。`
    : `两侧基数不同（${bases.join(" / ")}），**费率不可直接比较**——须先统一基数。`;

  return {
    kind: "penalty_asymmetry",
    statement: `逾期违约金：${listed}。${comparability}`,
    arithmetic: [
      terms.map((t) => `${t.side}: ${t.ratePerDay}%/日, 基数=${t.basis}`).join("\n"),
      sameBasis
        ? `${maxRate} ÷ ${minRate} = ${round4(ratio)}`
        : `基数集合 ${bases.join(" ≠ ")} → 不可比`,
    ].join("\n"),
    citations: [],
    provenance: terms.map((t) => ({ label: `${t.side}违约金`, span: t.span })),
  };
}

// ─────────────────────────────────────────────
// 单价 × 数量 vs 总价（会算出算术错误）
// ─────────────────────────────────────────────

/** 计量单位。用于从「供应 12 台」里取出数量。 */
const QUANTITY_UNIT_RE = /(\d+(?:\.\d+)?)\s*(台|件|个|套|批|吨|箱|份|辆|条|只)/;
const UNIT_PRICE_MARKERS: readonly RegExp[] = [/单价(?:为|：|:)?\s*/, /单价为\s*/];

/**
 * 单价 × 数量 vs 合同总价。
 *
 * 这是纯算术：`单价 86,000 元 × 12 台 = 1,032,000 元`，与合同写的总价对照。
 * 算得不对就是**硬错误**，不涉及任何法律判断。
 *
 * 只在**同一句**里同时找到单价与数量时才算——跨句组合会拼出一个不存在的算式。
 */
export function computeUnitPriceFact(text: string): DerivedFact | undefined {
  const unit = findLabelledAmount(text, UNIT_PRICE_MARKERS);
  if (!unit) {
    return undefined;
  }
  // 数量必须与单价同句：跨句匹配会把不相关的数字凑成一个算式
  // 数量常写在单价**之前**（「供应 12 台，……，单价 86,000 元」），故取整句
  const qtyMatch = QUANTITY_UNIT_RE.exec(sentenceAround(text, unit.hit.index));
  if (!qtyMatch) {
    return undefined;
  }
  const quantity = Number.parseFloat(qtyMatch[1] ?? "");
  if (!Number.isFinite(quantity) || quantity <= 0) {
    return undefined;
  }
  const total = findLabelledAmount(text, TOTAL_MARKERS);
  if (!total) {
    return undefined;
  }

  const computed = unit.hit.value * quantity;
  const diff = computed - total.hit.value;
  const arithmetic = [
    `${unit.hit.value} × ${quantity} = ${round2(computed)}`,
    ...(Math.abs(diff) < 1 ? [] : [`${round2(computed)} − ${total.hit.value} = ${round2(diff)}`]),
  ].join("\n");

  if (Math.abs(diff) < 1) {
    return {
      kind: "unit_price_times_quantity",
      statement: `单价 ${formatYuan(unit.hit.value)} × ${quantity} ${qtyMatch[2]} = ${formatYuan(round2(computed))}，与合同标的额一致。`,
      arithmetic,
      citations: [],
      provenance: [
        { label: "单价", span: unit.hit.span },
        { label: "数量", span: qtyMatch[0] },
        { label: "合同标的额", span: total.hit.span },
      ],
    };
  }

  return {
    kind: "unit_price_times_quantity",
    statement:
      `单价 ${formatYuan(unit.hit.value)} × ${quantity} ${qtyMatch[2]} = ${formatYuan(round2(computed))}，` +
      `但合同标的额写的是 ${formatYuan(total.hit.value)}，相差 ${formatYuan(Math.abs(round2(diff)))}。`,
    arithmetic,
    citations: [],
    provenance: [
      { label: "单价", span: unit.hit.span },
      { label: "数量", span: qtyMatch[0] },
      { label: "合同标的额", span: total.hit.span },
    ],
  };
}

// ─────────────────────────────────────────────
// 同一标记的金额前后不一致
// ─────────────────────────────────────────────

/**
 * 「合同总价款」/「标的额」这类**唯一性标记**在文中出现多次时，数值是否一致。
 *
 * 合同总额在同一份文书里出现两个值，是硬矛盾——不是判断，是抄错或改漏。
 * 本事实只陈述「出现了哪几个值、分别在哪」，不猜哪个是对的。
 */
export function computeTotalConsistencyFact(text: string): DerivedFact | undefined {
  const found: Array<{ marker: string; hit: MoneyHit }> = [];
  for (const marker of TOTAL_MARKERS) {
    const global = new RegExp(marker.source, `${marker.flags.replace(/g/g, "")}g`);
    for (const m of text.matchAll(global)) {
      const start = (m.index ?? 0) + m[0].length;
      // **同句且在标记之后**取值：跨句会把下一条款的金额算成「同一个标记的第二个值」（实测误报）
      const hit = findMoneyAmounts(sentenceAfter(text, start))[0];
      if (hit) {
        found.push({
          marker: (m[0] ?? "").trim(),
          hit: { ...hit, index: start + hit.index },
        });
      }
    }
  }
  if (found.length < 2) {
    return undefined;
  }
  const values = [...new Set(found.map((f) => f.hit.value))];
  if (values.length < 2) {
    // 多次出现且一致 —— 也算有用（模型不必自己核）
    return undefined;
  }
  const listed = found.map((f) => `${f.marker}${f.hit.span}`).join("、");
  return {
    kind: "total_inconsistent",
    statement: `合同标的额在文中出现 ${found.length} 处，但数值不一致：${listed}。`,
    arithmetic: `${found.map((f) => f.hit.value).join(" ≠ ")} → ${values.length} 个不同值`,
    citations: [],
    provenance: found.map((f) => ({ label: f.marker, span: f.hit.span })),
  };
}

// ─────────────────────────────────────────────
// 付款比例合计
// ─────────────────────────────────────────────

/** 付款比例的名目（**可选**——「验收合格后支付 65%」这种没有名目也得算）。 */
const RATIO_LABEL_RE =
  /(定金|预付款|首付款|进度款|质保金|保证金|尾款|余款|货款)[^。；\n%]{0,16}?$/u;

/** 百分比本身。名目可有可无——语境闸负责判断它是不是付款比例。 */
const PERCENT_RE = /(\d+(?:\.\d+)?)\s*%/g;

/** 履约/违约语境——这些句子里出现的百分比是**费率**，不是付款比例。 */
const PENALTY_CONTEXT_RE = /违约|逾期|滞纳|罚息|赔偿/;
/** 容差/浮动语境——「误差不超过 1%」不是付款比例。 */
const TOLERANCE_CONTEXT_RE = /误差|偏差|不超过|不低于|不高于|浮动|上下/;
/** 付款语境——比例必须出现在这类句子里才计入合计。 */
const PAYMENT_CONTEXT_RE = /支付|付款|付给|预付|退还|结算/;

/**
 * 付款**比例**合计 vs 100%。
 *
 * 与 `payment_sum` 互补：那条算的是绝对金额，这条算的是比例。
 * 「定金 30% + 验收后 65% + 余款 5%」应当等于 100%——不等于就是硬矛盾。
 *
 * **语境闸是必需的**（实测抓到的两处误报）：
 *   1. 违约责任条款里的百分比是**费率**（「按合同总价款的 5% 支付违约金」），
 *      混进来会算出一个毫无意义的合计；
 *   2. 「误差不超过 1%」这类容差表述同样不是付款比例。
 *
 * 闸门口径是纯事实的：句子含「违约/逾期」或「误差/不超过」就排除；
 * 必须出现在含「支付/付款/退还」的句子里才计入。
 *
 * **名目可有可无**——实测发现强制要求名目会漏掉真比例：
 * 「2 验收合格后支付 65%。」没有名目，但它确实是付款比例。
 */
export function computePaymentRatioSumFact(text: string): DerivedFact | undefined {
  const items: Array<{ label: string; pct: number; span: string }> = [];
  for (const m of text.matchAll(new RegExp(PERCENT_RE.source, "g"))) {
    const pct = Number.parseFloat(m[1] ?? "");
    if (!Number.isFinite(pct) || pct <= 0 || pct > 100) {
      continue;
    }
    const index = m.index ?? 0;
    const ctx = sentenceAround(text, index);
    if (PENALTY_CONTEXT_RE.test(ctx) || TOLERANCE_CONTEXT_RE.test(ctx)) {
      continue;
    }
    if (!PAYMENT_CONTEXT_RE.test(ctx)) {
      continue;
    }
    // 名目可选：取百分比**之前**同一句里紧邻的付款名目
    const label = RATIO_LABEL_RE.exec(sentenceBefore(text, index))?.[1] ?? "";
    items.push({ label, pct, span: (m[0] ?? "").trim() });
  }
  if (items.length < 2) {
    return undefined;
  }
  const sum = round2(items.reduce((acc, it) => acc + it.pct, 0));
  const diff = round2(sum - 100);
  // 名目可空（「验收合格后支付 65%」）；空名目只写比例，不留双空格
  const listed = items
    .map((it) => (it.label ? `${it.label} ${it.pct}%` : `${it.pct}%`))
    .join(" + ");
  const arithmetic = `${items.map((it) => it.pct).join(" + ")} = ${sum}${
    Math.abs(diff) < 0.01 ? "" : `\n${sum} − 100 = ${diff}`
  }`;

  if (Math.abs(diff) < 0.01) {
    return {
      kind: "payment_ratio_sum",
      statement: `付款比例合计 ${listed} = 100%，与全额一致。`,
      arithmetic,
      citations: [],
      provenance: items.map((it) => ({ label: it.label, span: it.span })),
    };
  }
  return {
    kind: "payment_ratio_sum",
    statement: `付款比例合计 ${listed} = ${sum}%，比全额${diff > 0 ? "多" : "少"} ${Math.abs(diff)} 个百分点。`,
    arithmetic,
    citations: [],
    provenance: items.map((it) => ({ label: it.label, span: it.span })),
  };
}

// ─────────────────────────────────────────────
// 日期算术与期限（诉讼时效、期间届满）
// ─────────────────────────────────────────────

/** 显式日期：`2026 年 11 月 30 日`。 */
export type ExplicitDate = { y: number; mo: number; d: number; span: string; index: number };

const EXPLICIT_DATE_RE = /((?:19|20)\d{2})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/g;

/** 找出全部显式日期（原文片段 + 位置）。 */
export function findExplicitDates(text: string): ExplicitDate[] {
  const out: ExplicitDate[] = [];
  for (const m of text.matchAll(new RegExp(EXPLICIT_DATE_RE.source, "g"))) {
    const y = Number.parseInt(m[1] ?? "", 10);
    const mo = Number.parseInt(m[2] ?? "", 10);
    const d = Number.parseInt(m[3] ?? "", 10);
    if (mo < 1 || mo > 12 || d < 1 || d > 31) {
      continue;
    }
    out.push({ y, mo, d, span: (m[0] ?? "").trim(), index: m.index ?? 0 });
  }
  return out;
}

/**
 * 把给定区间的字符替换成等长占位符（`·`），长度与索引都不变。
 *
 * **为什么必须做**：`11 月` / `30 日` 既是日期的一部分、又长得像期间表述。
 * 不遮蔽的话，`2026 年 11 月 30 日前` 会被期间正则读成「11 个月」+「30 日」，
 * 于是算出一个不存在的期限。遮蔽日期后，期间搜索就只看真正的期间表述。
 *
 * **用切片拼接而不是逐字符数组**：正则给的是**码元**索引，而 `[...text]` 得到的是
 * **码点**数组——含代理对（罕见字/emoji）时两者会错位，遮蔽到错误的字符。
 * 切片拼接天然按码元工作，且长度严格守恒。
 */
function maskSpans(text: string, spans: readonly { index: number; length: number }[]): string {
  const sorted = [...spans].toSorted((a, b) => a.index - b.index);
  let out = "";
  let cursor = 0;
  for (const s of sorted) {
    if (s.index < cursor || s.length <= 0) {
      continue; // 重叠或空区间：跳过，不影响长度守恒
    }
    out += text.slice(cursor, s.index);
    out += "·".repeat(s.length);
    cursor = s.index + s.length;
  }
  return out + text.slice(cursor);
}

export type PeriodSpan = {
  amount: number;
  unit: "day" | "month" | "year";
  /** 是否写的是「工作日」——需节假日表才能折算，**本模块不折算**。 */
  businessDays: boolean;
  span: string;
  index: number;
};

const PERIOD_RE = /(\d+|[零一二两三四五六七八九十百]+)\s*(?:个)?(工作日|日|天|个月|月|年)/g;

/** 在**已遮蔽日期**的文本里找期间表述。 */
function findPeriods(masked: string): PeriodSpan[] {
  const out: PeriodSpan[] = [];
  for (const m of masked.matchAll(new RegExp(PERIOD_RE.source, "g"))) {
    const raw = m[1] ?? "";
    const amount = /^\d+$/.test(raw) ? Number.parseInt(raw, 10) : parseChineseInteger(raw);
    if (!Number.isFinite(amount) || amount <= 0) {
      continue;
    }
    const unitRaw = m[2] ?? "";
    const unit: PeriodSpan["unit"] =
      unitRaw === "年" ? "year" : unitRaw === "个月" || unitRaw === "月" ? "month" : "day";
    out.push({
      amount,
      unit,
      businessDays: unitRaw === "工作日",
      span: (m[0] ?? "").trim(),
      index: m.index ?? 0,
    });
  }
  return out;
}

/** 某年某月的天数（用于月/年加法的日期夹取）。 */
function daysInMonth(y: number, mo: number): number {
  return new Date(Date.UTC(y, mo, 0)).getUTCDate();
}

/**
 * 日期 + N 个日历单位。**按民法期间规则夹取月末日**。
 *
 * 例：1 月 31 日 + 1 个月 → 2 月 28/29 日（而不是 3 月 2/3 日）。
 * 这是 `Date.UTC` 的自然溢出行为**不**满足的地方——溢出会把期间算到下一月，
 * 而那与期间届满的通常理解不符。
 */
export function addPeriod(
  date: { y: number; mo: number; d: number },
  amount: number,
  unit: PeriodSpan["unit"],
): { y: number; mo: number; d: number } {
  if (unit === "day") {
    const t = new Date(Date.UTC(date.y, date.mo - 1, date.d + amount));
    return { y: t.getUTCFullYear(), mo: t.getUTCMonth() + 1, d: t.getUTCDate() };
  }
  const months = unit === "year" ? amount * 12 : amount;
  const zeroBased = date.mo - 1 + months;
  const targetY = date.y + Math.floor(zeroBased / 12);
  const targetMo = ((zeroBased % 12) + 12) % 12;
  const clamped = Math.min(date.d, daysInMonth(targetY, targetMo + 1));
  return { y: targetY, mo: targetMo + 1, d: clamped };
}

function formatDate(date: { y: number; mo: number; d: number }): string {
  return `${date.y} 年 ${date.mo} 月 ${date.d} 日`;
}

/** 期日/期间语境——「自……起」「于……前」「内」等。 */
const FROM_DATE_CONTEXT_RE = /自|从|于|起|前|内/;

/**
 * 期限届满日：**显式日期 + 紧随其后的期间** → 到期日。
 *
 * 例：「乙方应自 2026 年 1 月 1 日起 30 日内完成交付。」→ 2026 年 1 月 31 日。
 *
 * **两条不产出的边界**（都是"算不出来就不说"）：
 *   1. 期间写的是**工作日** —— 折算需要节假日表，本仓没有，**不猜**；
 *   2. 找不到显式日期（如「收到本函之日起十日内」）—— 没有起点就算不出。
 */
export function computeDeadlineFact(text: string): DerivedFact | undefined {
  const dates = findExplicitDates(text);
  if (dates.length === 0) {
    return undefined;
  }
  const masked = maskSpans(
    text,
    dates.map((d) => ({ index: d.index, length: d.span.length })),
  );
  const periods = findPeriods(masked);
  if (periods.length === 0) {
    return undefined;
  }

  // 期间必须紧跟在某个日期之后（同句），否则起点无法确定
  for (const period of periods) {
    if (period.businessDays) {
      continue; // 工作日不折算
    }
    const anchor = dates
      .filter((d) => d.index < period.index)
      .toSorted((a, b) => b.index - a.index)[0];
    if (!anchor) {
      continue;
    }
    const between = text.slice(anchor.index + anchor.span.length, period.index);
    if (!FROM_DATE_CONTEXT_RE.test(between) || between.length > 12) {
      continue;
    }
    const due = addPeriod(anchor, period.amount, period.unit);
    const unitLabel = period.unit === "day" ? "日" : period.unit === "month" ? "个月" : "年";
    return {
      kind: "deadline",
      statement: `自 ${formatDate(anchor)} 起 ${period.amount} ${unitLabel}届满，即 **${formatDate(due)}**。`,
      arithmetic: `${formatDate(anchor)} + ${period.amount} ${unitLabel} = ${formatDate(due)}`,
      citations: [],
      provenance: [
        { label: "起算日", span: anchor.span },
        { label: "期间", span: period.span },
      ],
    };
  }
  return undefined;
}

/** 诉讼时效语境——起算点由这些表述给出。 */
const LIMITATION_START_RE = /知道或(?:者)?应当知道|知道权利(?:受到)?损害|权利(?:受到)?损害|时效/;

/**
 * 诉讼时效届满日：`起算日 + 3 年`（民法典第188条）。
 *
 * 期间值来自 `lint/statute-params.ts` 的 `DEFAULT_LIMITATION`（带 `source` 与
 * `effectiveFrom`）——**不是硬编码**。这也是本模块与 §3.8.8 里
 * 「4×LPR 不做」的分界：LPR 序列未入库，而普通时效三年是有出处的常量。
 *
 * **前提写在产出里**：起算点取自语料本身（「知道或应当知道权利受到损害之日」），
 * 「该日是否构成法律上的起算点」是判断问题，不在本模块职权内。
 * 陈述里明确标注这一点，避免它被读成一个法律结论。
 */
export function computeLimitationDeadlineFact(text: string): DerivedFact | undefined {
  if (!/诉讼时效|时效期间/.test(text)) {
    return undefined;
  }
  const dates = findExplicitDates(text);
  if (dates.length === 0) {
    return undefined;
  }
  for (const date of dates) {
    const ctx = sentenceAround(text, date.index);
    if (!LIMITATION_START_RE.test(ctx)) {
      continue;
    }
    const years = DEFAULT_LIMITATION.value;
    const due = addPeriod(date, years, "year");
    return {
      kind: "limitation_deadline",
      statement:
        `以文中 ${formatDate(date)}（「知道或应当知道权利受到损害」之日）为起算点，` +
        `${DEFAULT_LIMITATION.source}规定的 ${years} 年诉讼时效期间于 **${formatDate(due)}** 届满。` +
        `（起算点取自语料原文；该起点是否成立属法律判断。）`,
      arithmetic: `${formatDate(date)} + ${years} 年 = ${formatDate(due)}`,
      citations: [DEFAULT_LIMITATION.source],
      provenance: [{ label: "起算日", span: date.span }],
    };
  }
  return undefined;
}

// ─────────────────────────────────────────────
// 汇总入口
// ─────────────────────────────────────────────

type Computer = (text: string, ctx: { deliverableType?: string }) => DerivedFact | undefined;

/**
 * 已注册的 computer。**这里的顺序就是优先级**——`formatDerivedFactsPromptBlock`
 * 在预算不足时从**尾部整条丢弃**，所以越靠前越不可能被丢。
 *
 * 注意这条只对**渲染**成立：`collectDerivedFacts` **不再**按条数先截一刀
 * （见 `DEFAULT_DERIVED_FACTS_LIMIT`），否则尾部这几类在真实回合里根本到不了渲染器。
 *
 * 排序依据（信号强度 × 出错代价）：
 *   1. `deliverable_scope` —— 决定模型怎么理解**整篇文书**，框错了后面全偏；且很短。
 *   2. `deposit_cap_ratio` —— 法条硬上限，错了是 blocker 级。
 *   3. `payment_sum` / `unit_price_times_quantity` / `total_inconsistent`
 *      —— 都是**硬矛盾**（付的钱不等于总价、单价乘不出来、同一个总额两个值）。
 *   4. `payment_ratio_sum` —— 同类硬矛盾，但更少见。
 *   5. `penalty_asymmetry` —— 只给可比性材料，不判好坏，故排后。
 */
const COMPUTERS: ReadonlyArray<Computer> = [
  computeDeliverableScopeFact,
  computeDepositCapFact,
  computePaymentSumFact,
  computeUnitPriceFact,
  computeTotalConsistencyFact,
  computePaymentRatioSumFact,
  computeLimitationDeadlineFact,
  computeDeadlineFact,
  computePenaltyAsymmetryFact,
];

/**
 * 从文本算出全部可证明的派生事实。**纯函数、永不抛、算不出就是空数组。**
 *
 * `limit` **默认不设**（见 `DEFAULT_DERIVED_FACTS_LIMIT`）：条数上限会静默丢掉
 * 排在后面的 computer，而渲染器的字符预算会**整条取舍并写明**还剩几条。
 * 只有在调用方需要硬上界时才显式传 `limit`（测试里大量这么用）。
 */
export function collectDerivedFacts(text: string, opts?: DerivedFactsOptions): DerivedFact[] {
  try {
    const body = text ?? "";
    const ctx = opts?.deliverableType ? { deliverableType: opts.deliverableType } : {};
    // 体裁事实只依赖 deliverableType，不依赖正文长度——它先算，不受短文本门槛影响。
    const out: DerivedFact[] = [];
    const scopeFact = computeDeliverableScopeFact(body, ctx);
    if (scopeFact) {
      out.push(scopeFact);
    }
    if (body.trim().length >= 20) {
      for (const compute of COMPUTERS) {
        if (compute === computeDeliverableScopeFact) {
          continue; // 已单独处理
        }
        const fact = compute(body, ctx);
        if (fact) {
          out.push(fact);
        }
      }
    }
    return out.slice(0, opts?.limit ?? DEFAULT_DERIVED_FACTS_LIMIT);
  } catch {
    return [];
  }
}

/**
 * 注入块的总字符上限。
 *
 * **为什么上限放在格式化器里，而不是让 prompt 打包器去截**：
 * 实测抓到的——打包器在**块中间**截断，把后面的整条事实（以及早先那个版本里
 * 每例末尾的「律师说明」）切掉了。被腰斩的事实比没有更糟：它看起来像一句完整的
 * 断言，而算式可能正好落在被切掉的那一半。
 *
 * 所以这里**整条取舍**：放不下的事实整条丢掉，并注明还剩几条。
 *
 * 720 字 ≈ 445 tokens（CJK 约 1 token/字，见 `context-budget.ts` 的
 * `estimateTextTokens`）——与 `memory_hit` 的默认 200 tokens 相比需要显式放宽，
 * 见 `turn-orchestrator-prompt.ts` 的 `queue(..., { capTokens })`。
 */
export const MAX_FACTS_BLOCK_CHARS = 720;

/** 与 `MAX_FACTS_BLOCK_CHARS` 配套的 token 预算（供调用方传给 prompt 片段）。 */
export const DERIVED_FACTS_CAP_TOKENS = 470;

/**
 * 渲染成 prompt 块。
 *
 * **文案即契约**（与改稿范例同一纪律）：
 *   - 明说这是**代码算出来的**、不是模型推的——让它知道可以信任这组数字；
 *   - 明说**算式已给出**，鼓励它复核而不是照抄；
 *   - 明说这些是**事实而非结论**，要不要据此改动由它判断；
 *   - 有测试断言不得出现「必须 / 一律 / 禁止 / 不得」。
 *
 * **渲染要紧凑**：实测这个块有 951 字 / 25 行，会被打包器截断。
 * 现在每条约两行（事实 + 括号内的算式与出处），并省掉「原料」行——
 * 那些片段本来就已经写在事实陈述里了。数据里仍保留 `provenance` 供审计。
 *
 * 返回 `undefined` 表示没有可证明的事实 → **整块不注入**（不注入空标题）。
 */
export function formatDerivedFactsPromptBlock(
  facts: readonly DerivedFact[],
  opts?: { maxChars?: number },
): string | undefined {
  if (facts.length === 0) {
    return undefined;
  }
  const cap = Math.max(120, opts?.maxChars ?? MAX_FACTS_BLOCK_CHARS);
  const header = [
    "## 已算好的事实（代码计算，可复核）",
    "下列数字由代码算出，**不是模型的推断**；括号内是算式，可自行复核。这些是**事实**而非结论。",
  ].join("\n");

  const lines: string[] = [header];
  let used = header.length;
  let rendered = 0;
  for (const f of facts) {
    const detail = [f.arithmetic.split("\n").join("；"), ...f.citations]
      .filter(Boolean)
      .join(" · ");
    const block = `- ${f.statement}\n  （${detail}）`;
    if (used + block.length > cap && rendered > 0) {
      break; // 整条丢弃，不腰斩
    }
    lines.push(block);
    used += block.length;
    rendered += 1;
  }
  const dropped = facts.length - rendered;
  if (dropped > 0) {
    lines.push(`（另有 ${dropped} 条算好的事实未展开——本章只保留最关键的几条。）`);
  }
  return lines.join("\n\n");
}

/** 供 Doctor / CLI：一句话概括。 */
export function describeDerivedFacts(facts: readonly DerivedFact[]): string {
  if (facts.length === 0) {
    return "派生事实：本材料上无可证明的计算（不是「没有问题」，是「算不出来就不说」）。";
  }
  return `派生事实：${facts.length} 条 — ${facts.map((f) => f.kind).join("、")}`;
}

// ─────────────────────────────────────────────
// 从案件材料装载（有界读取）
// ─────────────────────────────────────────────

/** 单次最多读几份材料。 */
export const DERIVED_FACTS_MAX_FILES = 8;
/** 单次最多读多少字符——防止一份超长合同把 prompt 预算吃光。 */
export const DERIVED_FACTS_MAX_CHARS = 200_000;

/**
 * 只读这些扩展名。**刻意不碰 `.docx` / `.pdf`**：
 * 二进制要解析就得引入一套新的提取器，而本模块的立论是「只算能证明的」——
 * 读不了就是读不了，不猜（模块头第 3 条）。
 */
const TEXT_MATERIAL_RE = /\.(md|markdown|txt|text)$/i;

/**
 * 从案件的 `cases/<matterId>/materials/` 读文本材料，算出派生事实。
 *
 * 三条边界：
 *   - **有界**：文件数 `DERIVED_FACTS_MAX_FILES`、总字符 `DERIVED_FACTS_MAX_CHARS`；
 *   - **确定序**：按路径序（不是 mtime），同一批材料两次跑得到同一结果；
 *   - **永不抛**：读不到、读不了、算不出 → 空数组。它是素材，不是前置条件。
 *
 * 为什么按路径序而不是「最近修改」：事实是可缓存、可复现的输入，
 * 不能因为某份文件刚被 touch 就换一组数字。
 */
export function loadDerivedFactsForMatter(opts: {
  workspaceDir: string;
  matterId?: string;
  deliverableType?: string;
  maxFiles?: number;
  maxChars?: number;
  /** 条数硬上界；**默认不设**（截断交给渲染器的字符预算，见 `DEFAULT_DERIVED_FACTS_LIMIT`）。 */
  limit?: number;
}): DerivedFact[] {
  const matterId = opts.matterId?.trim();
  if (!matterId) {
    return [];
  }
  try {
    const listings = listMatterMaterialFiles(opts.workspaceDir, matterId, {
      maxFiles: opts.maxFiles ?? DERIVED_FACTS_MAX_FILES,
      order: "path",
    }).filter((l) => TEXT_MATERIAL_RE.test(l.fileName));
    if (listings.length === 0) {
      return [];
    }
    const dir = matterMaterialsDir(opts.workspaceDir, matterId);
    const capChars = opts.maxChars ?? DERIVED_FACTS_MAX_CHARS;
    let joined = "";
    for (const row of listings) {
      if (joined.length >= capChars) {
        break;
      }
      // `relPath` 形如 `materials/xxx`，落盘时要剥掉前缀再接回目录。
      const rel = row.relPath.replace(/^materials\//, "");
      let content = "";
      try {
        content = fs.readFileSync(path.join(dir, rel), "utf8");
      } catch {
        continue; // 单份读失败不影响其它材料
      }
      joined += `${content}\n\n`;
    }
    if (!joined.trim()) {
      return [];
    }
    const text = joined.slice(0, capChars);
    const collectOpts = {
      ...(opts.deliverableType ? { deliverableType: opts.deliverableType } : {}),
      ...(opts.limit !== undefined ? { limit: opts.limit } : {}),
    };
    return collectDerivedFacts(text, collectOpts);
  } catch {
    return [];
  }
}
