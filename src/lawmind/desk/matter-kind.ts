/**
 * Matter work kind — contract / litigation / general.
 * Optional on existing matters; a missing file field displays as 其他. Never blocks create.
 *
 * 门类是办事方式，不是案由。买卖合同纠纷仍是诉讼；合同只指审改协议；顾问、函件、备忘归其他。
 */

export const MATTER_KINDS = ["contract", "litigation", "general"] as const;

export type MatterKind = (typeof MATTER_KINDS)[number];

export const MATTER_KIND_LABELS: Record<MatterKind, string> = {
  contract: "合同",
  litigation: "诉讼",
  general: "其他",
};

/** 法院/仲裁程序。不含光秃秃的「起诉」，避免把「不要起诉」判成诉讼。 */
const PROCEDURE_RE =
  /传票|开庭|起诉状|答辩状|上诉状|案号|诉讼|应诉|一审|二审|再审|民初|民终|民再|刑初|行初|行终|仲裁申请|举证期限|执行异议|立案/;

/** 正在审、改一份协议，而不是案由里出现了「合同」。 */
const CONTRACT_WORK_RE = /审查|改稿|红线|条款|NDA|保密协议|框架协议|补充协议|合同|协议/;

const ADVISORY_RE = /法律顾问|常年顾问|专项顾问/;

export function parseMatterKind(value: unknown): MatterKind {
  if (value === "contract" || value === "litigation" || value === "general") {
    return value;
  }
  return "general";
}

function isExplicitMatterKind(value: unknown): value is MatterKind {
  return value === "contract" || value === "litigation" || value === "general";
}

/** 去掉「纠纷解决 / 争议解决」和合同里的争议条款后再看案由。 */
function hasCauseOfAction(text: string): boolean {
  const stripped = text.replace(/纠纷解决|争议解决|争议条款|争议焦点/g, "");
  return /纠纷|争议/.test(stripped);
}

/** 「非诉讼 / 非诉」是顾问工作，不能因为里面有「诉讼」两个字就判成诉讼。 */
function hasProcedure(text: string): boolean {
  const stripped = text.replace(/非诉讼|非诉/g, "");
  return PROCEDURE_RE.test(stripped);
}

export function inferMatterKind(text: string): MatterKind {
  const t = text.trim();
  if (!t) {
    return "general";
  }
  if (hasProcedure(t) || hasCauseOfAction(t)) {
    return "litigation";
  }
  if (ADVISORY_RE.test(t) && !/审查|改稿|红线/.test(t)) {
    return "general";
  }
  if (CONTRACT_WORK_RE.test(t)) {
    return "contract";
  }
  return "general";
}

export type ResolvedMatterKind = {
  kind: MatterKind;
  /** 调用方给了门类，但和标题里的程序/案由不一致，已改写。 */
  adjusted: boolean;
  reason?: string;
};

/**
 * 没给门类时按标题推断。给了「合同」但标题是诉讼案由或顾问委托时改写。
 * 律师在案情里手选的值走表单保存，不经过这里。
 */
export function resolveMatterKind(explicit: unknown, text: string): ResolvedMatterKind {
  const inferred = inferMatterKind(text);
  if (!isExplicitMatterKind(explicit)) {
    return explicit === undefined || explicit === null || explicit === ""
      ? { kind: inferred, adjusted: false }
      : { kind: inferred, adjusted: true, reason: "门类取值无效，已按标题判断。" };
  }
  if (explicit === "contract" && inferred === "litigation") {
    return {
      kind: "litigation",
      adjusted: true,
      reason: "标题是诉讼案由或法院程序，门类改为诉讼。案由里的「合同」不是合同审查。",
    };
  }
  if (explicit === "contract" && inferred === "general" && ADVISORY_RE.test(text)) {
    return {
      kind: "general",
      adjusted: true,
      reason: "常年顾问、专项顾问归入其他，不是合同审查。",
    };
  }
  return { kind: explicit, adjusted: false };
}

export type MatterDocket = {
  caseNo?: string;
  court?: string;
  instance?: string;
  standing?: string;
  hearingAt?: string;
  /**
   * 标的金额（自由文本，容忍「人民币 32,100 元」「3.21 万元」等写法）。
   * 不解析成数字：金额表述方式多且可能含多个请求项，解析反而会丢信息；
   * 需要计算时由 calculate / run_compute 显式解析。
   */
  claimAmount?: string;
};

export function parseMatterDocket(raw: unknown): MatterDocket | undefined {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }
  const o = raw as Record<string, unknown>;
  const pick = (k: string): string | undefined => {
    const v = typeof o[k] === "string" ? o[k].trim() : "";
    return v ? v.slice(0, 200) : undefined;
  };
  const docket: MatterDocket = {
    ...(pick("caseNo") ? { caseNo: pick("caseNo") } : {}),
    ...(pick("court") ? { court: pick("court") } : {}),
    ...(pick("instance") ? { instance: pick("instance") } : {}),
    ...(pick("standing") ? { standing: pick("standing") } : {}),
    ...(pick("hearingAt") ? { hearingAt: pick("hearingAt") } : {}),
    ...(pick("claimAmount") ? { claimAmount: pick("claimAmount") } : {}),
  };
  return Object.keys(docket).length > 0 ? docket : undefined;
}

export function parsePracticeTags(raw: unknown): string[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .slice(0, 12);
}
