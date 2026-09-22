/**
 * E10 privilege tip — lightweight preflight for compose / outbound text.
 * Configurable via workspace policy `privilegeSentinel` or env LAWMIND_PRIVILEGE_SENTINEL=0 to disable.
 *
 * 2026-09-20（P0-4c）：从「纯文本正则」升级为**结构化评估**。
 *
 * 旧实现的缺陷不是正则写错，而是**判据维度缺失**：`scanPrivilegeTip(text)` 只看正文，
 * 于是「同一段对内策略，发给自己的助理」和「发给对方律师」被判成同一个等级。
 * 特权风险本质上是**内容 × 收件人**的联合函数——脱离收件人判特权，必然在真正危险的那条路径上低估。
 *
 * 现在分两层：
 *   - `scanPrivilegeTip(text)`：纯文本原语，保留（renderer 的写作时提示镜像它，且它本身是有效信号）。
 *   - `assessOutboundPrivilege(input)`：**结构化评估**——文本标记 × 受众 × 附件名。
 *     出站门禁（`runtime/legal-verify-middleware.ts`）改用这一个。
 *
 * 升级原则：**只加严，不放松**。新函数在旧函数返回 warn 的场合仍返回 warn；
 * 额外在「外部受众 × 特权内容/附件」时升级。绝不在任何组合下把等级调低。
 */

export type PrivilegeTip = {
  level: "info" | "warn";
  code: string;
  message: string;
};

/** 仅正文文本的信号（保持旧行为，不引入收件人维度）。 */
const TEXT_PATTERNS: Array<{
  re: RegExp;
  code: string;
  message: string;
  level: PrivilegeTip["level"];
}> = [
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

/**
 * 视为「所外」的受众。与 `platform/outbound-audience.ts` 的
 * `OutboundAudienceKind` 对齐（此处用字面量，避免 policy → platform 的反向依赖）。
 * `internal` / `client` 不算所外：对所内同事与委托人披露工作成果是该走的路，
 * 触发特权门禁只会变成噪声，最终让律师把整个提示关掉。
 */
const EXTERNAL_AUDIENCE_KINDS: ReadonlySet<string> = new Set(["opposing", "court", "public"]);

/** 附件文件名像「对内策略」。与 `outbound-audience.ts` 的同名判据同源，但这里只看文件名。 */
const PRIVILEGED_ATTACHMENT_NAME_RE = /策略|内部备忘|privileged|工作成果|底线|不得外传|仅供所内/i;

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

/** 纯文本信号：返回第一个命中，或 null。出站判断请优先用 `assessOutboundPrivilege`。 */
export function scanPrivilegeTip(text: string): PrivilegeTip | null {
  const t = text.trim();
  if (!t) {
    return null;
  }
  for (const p of TEXT_PATTERNS) {
    if (p.re.test(t)) {
      return { level: p.level, code: p.code, message: p.message };
    }
  }
  return null;
}

export type OutboundPrivilegeInput = {
  /** 主题或正文（两者拼接后判断） */
  text: string;
  /**
   * 受众类型。取值对齐 `platform/outbound-audience.ts` 的 `OutboundAudienceKind`：
   * `client | opposing | court | public | internal | unknown`。
   * 不传时按 `unknown` 处理——**未知不等于安全**，但也不当作所外（避免误报）。
   */
  audienceKind?: string;
  /** 附件文件名（不是完整路径，只用于名称判据）。 */
  attachmentNames?: readonly string[];
};

/**
 * 结构化特权评估：文本标记 × 受众 × 附件名。
 *
 * 返回 null 表示**没有命中任何信号**——注意这不等于「可以放心发」，
 * 它只是说这些判据没命中；特权判断的最终责任仍在律师。
 */
export function assessOutboundPrivilege(input: OutboundPrivilegeInput): PrivilegeTip | null {
  const textTip = scanPrivilegeTip(input.text);
  const external = EXTERNAL_AUDIENCE_KINDS.has((input.audienceKind ?? "unknown").trim());

  const privilegedAttachments = (input.attachmentNames ?? [])
    .map((n) => n.trim())
    .filter((n) => n.length > 0 && PRIVILEGED_ATTACHMENT_NAME_RE.test(n));

  // 1. 正文明确带特权标记 —— 无论收件人是谁都 warn（收件人信息可能识别错，不能因此放松）。
  if (textTip?.code === "privilege_marker") {
    return textTip;
  }

  // 2. 所外受众 × 特权外观附件 —— 升级为 warn。这是旧实现完全看不到的一条路径。
  if (external && privilegedAttachments.length > 0) {
    return {
      level: "warn",
      code: "privileged_attachment_external",
      message: `收件人像所外，而附件名含对内材料（${privilegedAttachments.slice(0, 3).join("、")}）：发送前请确认不含工作成果/诉讼策略，或改走所内渠道。`,
    };
  }

  // 3. 所外受众 × 正文含工作成果/诉讼策略 —— 升级为 warn（纯文本层只是 info）。
  if (external && textTip?.code === "work_product") {
    return {
      level: "warn",
      code: "work_product_external",
      message:
        "正文含工作成果/诉讼策略表述，且收件人像所外：建议脱敏、删除对内判断，或改走所内审批。",
    };
  }

  // 4. 其余沿用文本信号（可能为 null）。
  return textTip;
}
