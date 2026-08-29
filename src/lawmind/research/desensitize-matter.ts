/**
 * Desensitization gate before using matter materials in training decks.
 */

export type DesensitizeFinding = {
  id: string;
  kind: "phone" | "id_card" | "bank" | "email" | "amount" | "name_hint" | "case_no";
  severity: "blocker" | "warning";
  sample: string;
  hint: string;
};

export type DesensitizeScanResult = {
  findings: DesensitizeFinding[];
  blockerCount: number;
  warningCount: number;
  ready: boolean;
};

const PATTERNS: Array<{
  id: string;
  kind: DesensitizeFinding["kind"];
  severity: DesensitizeFinding["severity"];
  re: RegExp;
  hint: string;
}> = [
  {
    id: "phone",
    kind: "phone",
    severity: "blocker",
    re: /(?<!\d)(?:\+?86[-\s]?)?1[3-9]\d{9}(?!\d)/g,
    hint: "疑似手机号，培训课件前请脱敏",
  },
  {
    id: "id_card",
    kind: "id_card",
    severity: "blocker",
    re: /(?<!\d)[1-9]\d{5}(?:19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[\dXx](?!\d)/g,
    hint: "疑似身份证号，培训课件前请脱敏",
  },
  {
    id: "bank",
    kind: "bank",
    severity: "warning",
    // Require common card prefix heuristics to cut false positives on random digit runs.
    re: /(?<!\d)(?:4\d{15}|5[1-5]\d{14}|62\d{14,17})(?!\d)/g,
    hint: "疑似银行卡号，请确认并脱敏",
  },
  {
    id: "email",
    kind: "email",
    severity: "warning",
    re: /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,
    hint: "含电子邮箱，对外培训建议替换为角色邮箱",
  },
  {
    id: "amount",
    kind: "amount",
    severity: "warning",
    re: /(?:人民币|RMB|CNY|¥|￥)\s*[\d,]+(?:\.\d+)?(?:\s*万)?/gi,
    hint: "含金额，脱敏培训可改为区间或符号",
  },
  {
    id: "case_no",
    kind: "case_no",
    severity: "warning",
    re: /[（(]\d{4}[）)][\u4e00-\u9fa5]{0,8}第?\d+号/g,
    hint: "含案号，公开培训前请确认是否可披露",
  },
];

function maskSample(raw: string): string {
  if (raw.length <= 4) {
    return "***";
  }
  return `${raw.slice(0, 2)}***${raw.slice(-2)}`;
}

export function scanTextForTrainingLeak(text: string): DesensitizeScanResult {
  const findings: DesensitizeFinding[] = [];
  const seen = new Set<string>();
  for (const p of PATTERNS) {
    p.re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = p.re.exec(text)) !== null) {
      const sample = maskSample(m[0] ?? "");
      const key = `${p.id}:${sample}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      findings.push({
        id: `${p.id}-${findings.length + 1}`,
        kind: p.kind,
        severity: p.severity,
        sample,
        hint: p.hint,
      });
      if (findings.length >= 40) {
        break;
      }
    }
    if (findings.length >= 40) {
      break;
    }
  }
  const blockerCount = findings.filter((f) => f.severity === "blocker").length;
  const warningCount = findings.filter((f) => f.severity === "warning").length;
  return {
    findings,
    blockerCount,
    warningCount,
    ready: blockerCount === 0,
  };
}

export function desensitizeConfirmedInText(text: string): boolean {
  return /(已脱敏|脱敏完成|desensitiz(e|ed)|redacted|匿名化完成)/i.test(text);
}

/**
 * Gate for training PPT that may include matter text.
 * Blockers require explicit desensitization confirmation in the instruction.
 */
export function assertTrainingDesensitizeGate(opts: {
  matterText: string;
  instruction: string;
}):
  | { ok: true; scan: DesensitizeScanResult }
  | { ok: false; scan: DesensitizeScanResult; error: string } {
  const scan = scanTextForTrainingLeak(opts.matterText);
  if (scan.ready) {
    return { ok: true, scan };
  }
  if (desensitizeConfirmedInText(opts.instruction)) {
    return { ok: true, scan };
  }
  const samples = scan.findings
    .filter((f) => f.severity === "blocker")
    .slice(0, 5)
    .map((f) => `${f.hint}（样例 ${f.sample}）`)
    .join("；");
  return {
    ok: false,
    scan,
    error: `培训课件使用案件材料前须脱敏。发现 ${scan.blockerCount} 项阻断项：${samples}。请脱敏后在指令中注明「已脱敏」再继续。`,
  };
}

/** Lightweight redaction helper for demos / previews (not a substitute for lawyer review). */
export function redactTrainingText(text: string): string {
  let out = text;
  out = out.replace(/(?<!\d)(?:\+?86[-\s]?)?1[3-9]\d{9}(?!\d)/g, "[手机号已脱敏]");
  out = out.replace(
    /(?<!\d)[1-9]\d{5}(?:19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[\dXx](?!\d)/g,
    "[证件号已脱敏]",
  );
  out = out.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[邮箱已脱敏]");
  return out;
}
