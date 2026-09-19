/**
 * 标的金额解析：把卷宗里的自由文本金额解析成元数值，供诉讼费估算使用。
 *
 * 设计立场（与 `docs/LAWMIND-CHAT-MATTER-FILL.md` 原则 0 一致）：
 *   - 解析**只读**，不改写卷宗里的原文本——律师看到的仍是「32,100 元」。
 *   - 有歧义就**诚实失败**，不猜。宁可让界面提示「请填数值」，也不要按错的
 *     金额算出错的受理费（SECURITY.md：错误的法定参数比没有更糟）。
 *
 * 支持：`32100`、`32,100.50`、`32,100 元`、`3.21万元`、`人民币 32100 元`、
 *      `叁万贰仟壹佰元`（大写）、`三万二千一百元`（小写）。
 */

const CN_DIGIT: Record<string, number> = {
  零: 0,
  〇: 0,
  一: 1,
  壹: 1,
  二: 2,
  贰: 2,
  两: 2,
  三: 3,
  叁: 3,
  四: 4,
  肆: 4,
  五: 5,
  伍: 5,
  六: 6,
  陆: 6,
  七: 7,
  柒: 7,
  八: 8,
  捌: 8,
  九: 9,
  玖: 9,
};

/** 十/百/千 级单位（阿拉伯数字后也常用「万」，但那是万级，另处理）。 */
const CN_UNIT: Record<string, number> = {
  十: 10,
  拾: 10,
  百: 100,
  佰: 100,
  千: 1_000,
  仟: 1_000,
};

/** 万/亿 级单位。 */
const CN_SECTION: Record<string, number> = {
  万: 10_000,
  萬: 10_000,
  亿: 100_000_000,
  億: 100_000_000,
};

const CN_AMOUNT_RE = /^[零〇一二两三四五六七八九十百千万亿壹贰叁肆伍陆柒捌玖拾佰仟萬億]+$/;

/** 解析中文金额（大小写通用），如 叁万贰仟壹佰→32100、十五→15。 */
export function parseChineseAmount(raw: string): number | undefined {
  const s = raw.trim();
  if (!s) {
    return undefined;
  }
  let total = 0;
  let section = 0;
  let current = 0;
  let seenDigit = false;
  for (const ch of s) {
    if (ch === "零" || ch === "〇") {
      seenDigit = true;
      continue;
    }
    const digit = CN_DIGIT[ch];
    if (digit !== undefined) {
      current = digit;
      seenDigit = true;
      continue;
    }
    const unit = CN_UNIT[ch];
    if (unit !== undefined) {
      // 「十五」的十前面没有数字，按 1 处理。
      section += (current === 0 ? 1 : current) * unit;
      current = 0;
      seenDigit = true;
      continue;
    }
    const sect = CN_SECTION[ch];
    if (sect !== undefined) {
      section = (section + current) * sect;
      total += section;
      section = 0;
      current = 0;
      seenDigit = true;
      continue;
    }
    return undefined;
  }
  if (!seenDigit) {
    return undefined;
  }
  return total + section + current;
}

export type ParsedClaimAmount =
  | { ok: true; yuan: number; raw: string }
  | { ok: false; reason: string; candidates?: number[] };

function normalize(raw: string): string {
  return raw
    .replace(/[人民币￥¥元圆整]/g, (m) => (m === "元" || m === "圆" ? "元" : ""))
    .replace(/[\s\u00a0]/g, "")
    .trim();
}

function numericWithUnit(s: string): number | undefined {
  // 「3.21万元」「32,100元」「32100」
  const m = /^(\d+(?:,\d{3})*(?:\.\d+)?)(万|萬)?元?$/.exec(s);
  if (!m) {
    return undefined;
  }
  const base = Number.parseFloat((m[1] ?? "").replace(/,/g, ""));
  if (!Number.isFinite(base)) {
    return undefined;
  }
  return m[2] ? base * 10_000 : base;
}

/**
 * 解析标的金额文本。成功返回元数值；有歧义或无法识别时返回原因。
 */
export function parseClaimAmount(raw: string | undefined): ParsedClaimAmount {
  const input = (raw ?? "").trim();
  if (!input) {
    return { ok: false, reason: "未填标的金额。" };
  }
  const s = normalize(input);
  if (!s) {
    return { ok: false, reason: `无法从「${input}」识别金额。` };
  }
  const direct = numericWithUnit(s);
  if (direct !== undefined) {
    return { ok: true, yuan: direct, raw: input };
  }
  // 中文大写/小写：先剥掉尾部「元」，再由中文数字解析。
  const cnPart = s.replace(/元$/, "");
  if (cnPart && CN_AMOUNT_RE.test(cnPart)) {
    const cn = parseChineseAmount(cnPart);
    if (cn !== undefined && cn > 0) {
      return { ok: true, yuan: cn, raw: input };
    }
    return { ok: false, reason: `无法从「${input}」解析中文金额。` };
  }
  // 混合文本：只认带「万」或「元」的金额片段；多于一个不同值即为歧义。
  const found = new Map<number, string>();
  for (const match of s.matchAll(/(\d+(?:,\d{3})*(?:\.\d+)?)(万|萬)?(元)?/g)) {
    const token = match[0];
    if (!match[2] && !match[3]) {
      continue; // 裸数字（如案号年份）不算金额
    }
    const value = numericWithUnit(token);
    if (value !== undefined && value > 0) {
      found.set(value, token);
    }
  }
  for (const match of s.matchAll(
    /[零〇一二两三四五六七八九十百千万亿壹贰叁肆伍陆柒捌玖拾佰仟萬億]+元/g,
  )) {
    const value = parseChineseAmount(match[0]);
    if (value !== undefined && value > 0) {
      found.set(value, match[0]);
    }
  }
  if (found.size === 0) {
    return { ok: false, reason: `无法从「${input}」识别金额；请直接填数字（元）。` };
  }
  if (found.size > 1) {
    return {
      ok: false,
      reason: `「${input}」里有多个金额，无法确定诉讼请求总额；请填单一数字（元）。`,
      candidates: [...found.keys()],
    };
  }
  const [yuan] = [...found.keys()];
  return { ok: true, yuan: yuan, raw: input };
}
