/**
 * Matter work kind — contract / litigation / general.
 * Optional on existing matters; missing file field means general. Never blocks create.
 */

export const MATTER_KINDS = ["contract", "litigation", "general"] as const;

export type MatterKind = (typeof MATTER_KINDS)[number];

export const MATTER_KIND_LABELS: Record<MatterKind, string> = {
  contract: "合同",
  litigation: "诉讼",
  general: "其他",
};

const LITIGATION_RE = /传票|开庭|起诉|答辩|案号|诉讼|仲裁申请|举证期限|应诉|一审|二审|执行异议/;
const CONTRACT_RE = /合同|协议|NDA|保密协议|审查这份|条款|红线/;

export function parseMatterKind(value: unknown): MatterKind {
  if (value === "contract" || value === "litigation" || value === "general") {
    return value;
  }
  return "general";
}

export function inferMatterKind(text: string): MatterKind {
  const t = text.trim();
  if (!t) {
    return "general";
  }
  if (LITIGATION_RE.test(t)) {
    return "litigation";
  }
  if (CONTRACT_RE.test(t)) {
    return "contract";
  }
  return "general";
}

export type MatterDocket = {
  caseNo?: string;
  court?: string;
  instance?: string;
  standing?: string;
  hearingAt?: string;
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
