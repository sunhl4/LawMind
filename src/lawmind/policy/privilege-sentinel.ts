/**
 * E10 privilege tip — lightweight preflight for compose / outbound text.
 * Configurable via workspace policy `privilegeSentinel` or env LAWMIND_PRIVILEGE_SENTINEL=0 to disable.
 */

export type PrivilegeTip = {
  level: "info" | "warn";
  code: string;
  message: string;
};

const PATTERNS: Array<{ re: RegExp; code: string; message: string; level: PrivilegeTip["level"] }> =
  [
    {
      re: /attorney[- ]client|律师[- ]?客户|特权通信|privileged\s+and\s+confidential/i,
      code: "privilege_marker",
      message: "文本含特权/保密标记：发送前请确认收件人与渠道符合所内 privilege 政策。",
      level: "warn",
    },
    {
      re: /工作成果|work\s*product|诉讼策略|内部备忘/i,
      code: "work_product",
      message: "可能含工作成果/诉讼策略表述：对外发送前建议脱敏或改走所内审批。",
      level: "info",
    },
  ];

export function isPrivilegeSentinelEnabled(opts?: {
  policy?: { privilegeSentinel?: boolean } | null;
  env?: NodeJS.ProcessEnv;
}): boolean {
  const env = opts?.env ?? process.env;
  if (env.LAWMIND_PRIVILEGE_SENTINEL === "0" || env.LAWMIND_PRIVILEGE_SENTINEL === "false") {
    return false;
  }
  if (opts?.policy && opts.policy.privilegeSentinel === false) {
    return false;
  }
  return true;
}

/** Return first matching tip, or null. */
export function scanPrivilegeTip(text: string): PrivilegeTip | null {
  const t = text.trim();
  if (!t) {
    return null;
  }
  for (const p of PATTERNS) {
    if (p.re.test(t)) {
      return { level: p.level, code: p.code, message: p.message };
    }
  }
  return null;
}
