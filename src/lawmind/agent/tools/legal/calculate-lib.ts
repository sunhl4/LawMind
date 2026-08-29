/**
 * Deterministic legal math. Results always include formula + inputs for the file.
 * LPR / 牌价 must be supplied by the lawyer — never invented.
 */

export type CalculateOp =
  | "interest"
  | "interest_lpr"
  | "date_span"
  | "limitation"
  | "column_sum"
  | "weighted_average"
  | "liquidated_damages";

export type CalculateResult = {
  op: CalculateOp;
  value: number | string;
  formula: string;
  inputs: Record<string, unknown>;
  notes?: string;
};

export type CalculateOk = { ok: true; result: CalculateResult };
export type CalculateErr = { ok: false; error: string };

const YMD = /^(\d{4})-(\d{2})-(\d{2})$/;

export function parseYmd(raw: string): { y: number; m: number; d: number } | undefined {
  const m = YMD.exec(raw.trim());
  if (!m) {
    return undefined;
  }
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) {
    return undefined;
  }
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) {
    return undefined;
  }
  return { y, m: mo, d };
}

function utcFromYmd(p: { y: number; m: number; d: number }): Date {
  return new Date(Date.UTC(p.y, p.m - 1, p.d));
}

/** Calendar days from start to end (end exclusive of start; 同日为 0). */
export function daysBetweenYmd(start: string, end: string): number | undefined {
  const a = parseYmd(start);
  const b = parseYmd(end);
  if (!a || !b) {
    return undefined;
  }
  return Math.round((utcFromYmd(b).getTime() - utcFromYmd(a).getTime()) / 86_400_000);
}

export function addCalendarYears(start: string, years: number): string | undefined {
  const p = parseYmd(start);
  if (!p) {
    return undefined;
  }
  const y = p.y + years;
  const last = new Date(Date.UTC(y, p.m, 0)).getUTCDate();
  const d = Math.min(p.d, last);
  return `${y}-${String(p.m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function asNum(value: unknown, name: string): { ok: true; n: number } | CalculateErr {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) {
    return { ok: false, error: `${name} 必须是数字。` };
  }
  return { ok: true, n };
}

function asYmd(value: unknown, name: string): { ok: true; s: string } | CalculateErr {
  if (typeof value !== "string" || !parseYmd(value)) {
    return { ok: false, error: `${name} 必须是 YYYY-MM-DD。` };
  }
  return { ok: true, s: value.trim() };
}

export function calculateLegal(
  op: string,
  inputs: Record<string, unknown>,
): CalculateOk | CalculateErr {
  if (op === "interest") {
    const principal = asNum(inputs.principal, "principal");
    if (!principal.ok) {
      return principal;
    }
    const rate = asNum(inputs.annualRate, "annualRate");
    if (!rate.ok) {
      return rate;
    }
    const start = asYmd(inputs.start, "start");
    if (!start.ok) {
      return start;
    }
    const end = asYmd(inputs.end, "end");
    if (!end.ok) {
      return end;
    }
    const days = daysBetweenYmd(start.s, end.s);
    if (days === undefined || days < 0) {
      return { ok: false, error: "起止日无效或结束早于开始。" };
    }
    const value = principal.n * rate.n * (days / 365);
    return {
      ok: true,
      result: {
        op,
        value: Number(value.toFixed(2)),
        formula: `${principal.n} × ${rate.n} × ${days} / 365`,
        inputs: { principal: principal.n, annualRate: rate.n, start: start.s, end: end.s, days },
        notes: "按年利率÷365 计日息；分段 LPR 请用 interest_lpr，并由律师提供各段利率。",
      },
    };
  }

  if (op === "interest_lpr") {
    const principal = asNum(inputs.principal, "principal");
    if (!principal.ok) {
      return principal;
    }
    if (!Array.isArray(inputs.segments) || inputs.segments.length === 0) {
      return {
        ok: false,
        error: "interest_lpr 需要 segments（律师提供各段起止日与年利率，不假装实时牌价）。",
      };
    }
    if (inputs.segments.length > 60) {
      return { ok: false, error: "segments 最多 60 段。" };
    }
    let total = 0;
    const parts: string[] = [];
    const norm: Array<{
      start: string;
      end: string;
      annualRate: number;
      days: number;
      interest: number;
    }> = [];
    for (const row of inputs.segments) {
      if (!row || typeof row !== "object") {
        return { ok: false, error: "segments 项必须是对象。" };
      }
      const s = row as Record<string, unknown>;
      const start = asYmd(s.start, "segment.start");
      if (!start.ok) {
        return start;
      }
      const end = asYmd(s.end, "segment.end");
      if (!end.ok) {
        return end;
      }
      const rate = asNum(s.annualRate, "segment.annualRate");
      if (!rate.ok) {
        return rate;
      }
      const days = daysBetweenYmd(start.s, end.s);
      if (days === undefined || days < 0) {
        return { ok: false, error: "分段起止日无效。" };
      }
      const interest = principal.n * rate.n * (days / 365);
      total += interest;
      parts.push(`${principal.n} × ${rate.n} × ${days} / 365`);
      norm.push({
        start: start.s,
        end: end.s,
        annualRate: rate.n,
        days,
        interest: Number(interest.toFixed(2)),
      });
    }
    return {
      ok: true,
      result: {
        op,
        value: Number(total.toFixed(2)),
        formula: parts.join(" + "),
        inputs: { principal: principal.n, segments: norm },
        notes: "各段年利率由律师录入；本工具不查询人民银行或报价行牌价。",
      },
    };
  }

  if (op === "date_span") {
    const start = asYmd(inputs.start, "start");
    if (!start.ok) {
      return start;
    }
    const end = asYmd(inputs.end, "end");
    if (!end.ok) {
      return end;
    }
    const days = daysBetweenYmd(start.s, end.s);
    if (days === undefined) {
      return { ok: false, error: "日期无效。" };
    }
    return {
      ok: true,
      result: {
        op,
        value: days,
        formula: `${end.s} − ${start.s}（日历日）`,
        inputs: { start: start.s, end: end.s, days },
      },
    };
  }

  if (op === "limitation") {
    const start = asYmd(inputs.start, "start");
    if (!start.ok) {
      return start;
    }
    const yearsRaw = inputs.years == null ? 3 : inputs.years;
    const years = asNum(yearsRaw, "years");
    if (!years.ok) {
      return years;
    }
    const y = Math.floor(years.n);
    if (y < 1 || y > 20) {
      return { ok: false, error: "years 应在 1–20。" };
    }
    const end = addCalendarYears(start.s, y);
    if (!end) {
      return { ok: false, error: "无法计算届满日。" };
    }
    return {
      ok: true,
      result: {
        op,
        value: end,
        formula: `${start.s} + ${y} 年（日历年）`,
        inputs: { start: start.s, years: y, expires: end },
        notes: "默认三年普通诉讼时效（民法典第 188 条）。中断、中止、最长二十年请律师另行判断。",
      },
    };
  }

  if (op === "column_sum") {
    if (!Array.isArray(inputs.values)) {
      return { ok: false, error: "column_sum 需要 values 数组。" };
    }
    if (inputs.values.length > 2_000) {
      return { ok: false, error: "values 最多 2000 项。" };
    }
    const nums: number[] = [];
    for (const v of inputs.values) {
      const n = asNum(v, "values");
      if (!n.ok) {
        return n;
      }
      nums.push(n.n);
    }
    const sum = nums.reduce((a, b) => a + b, 0);
    return {
      ok: true,
      result: {
        op,
        value: Number(sum.toFixed(6)),
        formula: nums.join(" + ") || "0",
        inputs: { values: nums, count: nums.length },
      },
    };
  }

  if (op === "weighted_average") {
    if (!Array.isArray(inputs.values) || !Array.isArray(inputs.weights)) {
      return { ok: false, error: "weighted_average 需要 values 与 weights。" };
    }
    if (inputs.values.length !== inputs.weights.length || inputs.values.length === 0) {
      return { ok: false, error: "values 与 weights 长度必须一致且非空。" };
    }
    if (inputs.values.length > 2_000) {
      return { ok: false, error: "values 最多 2000 项。" };
    }
    let weighted = 0;
    let wsum = 0;
    const pairs: Array<{ value: number; weight: number }> = [];
    for (let i = 0; i < inputs.values.length; i++) {
      const v = asNum(inputs.values[i], "values");
      if (!v.ok) {
        return v;
      }
      const w = asNum(inputs.weights[i], "weights");
      if (!w.ok) {
        return w;
      }
      weighted += v.n * w.n;
      wsum += w.n;
      pairs.push({ value: v.n, weight: w.n });
    }
    if (wsum === 0) {
      return { ok: false, error: "权重和不能为 0。" };
    }
    return {
      ok: true,
      result: {
        op,
        value: Number((weighted / wsum).toFixed(6)),
        formula: `(${pairs.map((p) => `${p.value}×${p.weight}`).join(" + ")}) / ${wsum}`,
        inputs: { pairs, weightSum: wsum },
      },
    };
  }

  if (op === "liquidated_damages") {
    const base = asNum(inputs.base, "base");
    if (!base.ok) {
      return base;
    }
    const ratio = asNum(inputs.ratio, "ratio");
    if (!ratio.ok) {
      return ratio;
    }
    const value = base.n * ratio.n;
    return {
      ok: true,
      result: {
        op,
        value: Number(value.toFixed(2)),
        formula: `${base.n} × ${ratio.n}`,
        inputs: { base: base.n, ratio: ratio.n },
        notes: "按约定比例试算。是否过高或过低、法院可否调减，只提示、不算死（民法典第 585 条）。",
      },
    };
  }

  return { ok: false, error: `不支持的计算：${op}` };
}
