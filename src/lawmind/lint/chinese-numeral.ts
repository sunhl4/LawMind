/**
 * 中文数字解析（lint 专用，保守）：只认 零一二两三四五六七八九 与 十/百/点。
 * 解析失败返回 NaN，由调用方按「未识别」处理（宁可少报）。
 */

const DIGITS: Record<string, number> = {
  零: 0,
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
};

/** 中文整数字符类（十/百，无小数），供条号等整数场景拼正则用。 */
export const CHINESE_INTEGER_PATTERN = "[零一二两三四五六七八九十百]+";

/** 中文数字字符类（不含单位），供各规则拼正则用。 */
export const CHINESE_NUMERAL_PATTERN = `${CHINESE_INTEGER_PATTERN}(?:\\.[零一二两三四五六七八九]+|点[零一二两三四五六七八九]+)?`;

/** 解析 0–999 的中文整数（十/百），如 十五→15、三十→30、一百二十→120。 */
export function parseChineseInteger(raw: string): number {
  const s = (raw ?? "").trim();
  if (!s) {
    return Number.NaN;
  }
  if (/^\d+$/.test(s)) {
    return Number.parseInt(s, 10);
  }
  let result = 0;
  let current = 0;
  for (const ch of s) {
    if (ch === "十" || ch === "百") {
      const unit = ch === "十" ? 10 : 100;
      result += (current === 0 ? 1 : current) * unit;
      current = 0;
    } else {
      const d = DIGITS[ch];
      if (d === undefined) {
        return Number.NaN;
      }
      current = d;
    }
  }
  return result + current;
}

/** 解析中文小数，如 二十五点五→25.5、三十→30。 */
export function parseChineseDecimal(raw: string): number {
  const s = (raw ?? "").trim();
  if (!s) {
    return Number.NaN;
  }
  if (/^\d+(?:\.\d+)?$/.test(s)) {
    return Number.parseFloat(s);
  }
  const [intRaw, decRaw] = s.split(/[点.]/);
  const int = parseChineseInteger(intRaw ?? "");
  if (!Number.isFinite(int)) {
    return Number.NaN;
  }
  if (!decRaw) {
    return int;
  }
  let frac = 0;
  for (let i = 0; i < decRaw.length; i += 1) {
    const d = DIGITS[decRaw[i] ?? ""];
    if (d === undefined) {
      return Number.NaN;
    }
    frac += d * 10 ** -(i + 1);
  }
  return int + frac;
}

const CN_DIGITS = "零一二三四五六七八九";

/** 格式化 0–99 的中文整数（够表达百分比上限），如 20→二十、15→十五。 */
export function formatChineseInteger(n: number): string {
  if (!Number.isInteger(n) || n < 0 || n > 99) {
    return String(n);
  }
  if (n < 10) {
    return CN_DIGITS[n] ?? String(n);
  }
  const tens = Math.floor(n / 10);
  const ones = n % 10;
  const head = tens === 1 ? "十" : `${CN_DIGITS[tens]}十`;
  return ones === 0 ? head : `${head}${CN_DIGITS[ones]}`;
}
