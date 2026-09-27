/**
 * 案件档案（事后补全）：从 CASE.md §1 解析可选字段，供工作台表单回填。
 */

const CAUSE_RE = /^案由[:：]\s*(.+)$/;
const COUNTERPARTY_RE = /^(?:对方当事人|对方)[:：]\s*(.+)$/;
const CLIENT_LINE_RE = /^(?:客户(?:\s*\/\s*clientId)?|委托人|我方)[:：]\s*(.+)$/i;
const CASE_NO_RE = /^案号[:：]\s*(.+)$/;
const COURT_RE = /^法院[:：]\s*(.+)$/;
const INSTANCE_RE = /^审级[:：]\s*(.+)$/;
const STANDING_RE = /^诉讼地位[:：]\s*(.+)$/;
const HEARING_RE = /^开庭日[:：]\s*(.+)$/;
const KIND_RE = /^工作门类[:：]\s*(.+)$/;

function stripPlaceholder(raw: string): string {
  const v = raw
    .replace(/^\s*_\s*/, "")
    .replace(/\s*_\s*$/, "")
    .trim();
  if (!v || v.startsWith("_（") || v.startsWith("_(") || v.startsWith("（")) {
    return "";
  }
  return v;
}

function scanBasicInfoLines(caseMemory: string): string[] {
  const pattern = /## 1\.\s*基本信息\n\n([\s\S]*?)(?:\n##\s+\d+\.|$)/;
  const match = pattern.exec(caseMemory);
  if (!match) {
    return [];
  }
  return match[1]
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("-"))
    .map((line) => line.replace(/^-\s*/, "").trim());
}

export type MatterCaseProfileFields = {
  causeOfAction?: string;
  counterparty?: string;
  clientIdFromCase?: string;
  caseNo?: string;
  court?: string;
  instance?: string;
  standing?: string;
  hearingAt?: string;
  matterKindLabel?: string;
};

function partySectionLines(caseMemory: string): string[] {
  const match = /##\s*2\.\s*当事人\n+([\s\S]*?)(?:\n##\s+\d+\.|$)/.exec(caseMemory);
  if (!match?.[1]) {
    return [];
  }
  return match[1]
    .split("\n")
    .map((line) => line.trim().replace(/^-\s*/, "").trim())
    .filter((line) => line.length > 0);
}

/**
 * 没有客户编号时，用档案里的姓名。委托人/我方对对方；只有甲乙方时，诉讼地位写明甲方或乙方才定我方。
 */
export function partySidesFromCase(caseMemory: string): {
  clients: string[];
  counterparties: string[];
} {
  const basic = parseMatterCaseProfileFields(caseMemory);
  const clients = basic.clientIdFromCase ? [basic.clientIdFromCase] : [];
  const counterparties = basic.counterparty ? [basic.counterparty] : [];
  if (clients.length > 0 && counterparties.length > 0) {
    return { clients, counterparties };
  }
  const named = new Map<string, string>();
  for (const body of partySectionLines(caseMemory)) {
    const match = /^(甲方|乙方|委托人|我方|对方当事人|对方)[:：]\s*(.+)$/.exec(body);
    if (!match) {
      continue;
    }
    const value = stripPlaceholder(match[2] ?? "");
    if (value) {
      named.set(match[1] ?? "", value);
    }
  }
  const namedClient = named.get("委托人") || named.get("我方");
  const namedCounter = named.get("对方当事人") || named.get("对方");
  if (namedClient && !clients.includes(namedClient)) {
    clients.push(namedClient);
  }
  if (namedCounter && !counterparties.includes(namedCounter)) {
    counterparties.push(namedCounter);
  }
  if (clients.length > 0 && counterparties.length > 0) {
    return { clients, counterparties };
  }
  const jia = named.get("甲方");
  const yi = named.get("乙方");
  const roles = new Set(basic.standing?.match(/甲方|乙方/g) ?? []);
  if (jia && yi && roles.size === 1 && roles.has("乙方")) {
    return { clients: [yi], counterparties: [jia] };
  }
  if (jia && yi && roles.size === 1 && roles.has("甲方")) {
    return { clients: [jia], counterparties: [yi] };
  }
  return { clients, counterparties };
}

export function parseMatterCaseProfileFields(caseMemory: string): MatterCaseProfileFields {
  const out: MatterCaseProfileFields = {};
  for (const body of scanBasicInfoLines(caseMemory)) {
    const cause = CAUSE_RE.exec(body);
    if (cause) {
      const v = stripPlaceholder(cause[1] ?? "");
      if (v) {
        out.causeOfAction = v;
      }
      continue;
    }
    const cp = COUNTERPARTY_RE.exec(body);
    if (cp) {
      const v = stripPlaceholder(cp[1] ?? "");
      if (v) {
        out.counterparty = v;
      }
      continue;
    }
    const client = CLIENT_LINE_RE.exec(body);
    if (client) {
      const v = stripPlaceholder(client[1] ?? "");
      if (v) {
        out.clientIdFromCase = v;
      }
      continue;
    }
    const caseNo = CASE_NO_RE.exec(body);
    if (caseNo) {
      const v = stripPlaceholder(caseNo[1] ?? "");
      if (v) {
        out.caseNo = v;
      }
      continue;
    }
    const court = COURT_RE.exec(body);
    if (court) {
      const v = stripPlaceholder(court[1] ?? "");
      if (v) {
        out.court = v;
      }
      continue;
    }
    const instance = INSTANCE_RE.exec(body);
    if (instance) {
      const v = stripPlaceholder(instance[1] ?? "");
      if (v) {
        out.instance = v;
      }
      continue;
    }
    const standing = STANDING_RE.exec(body);
    if (standing) {
      const v = stripPlaceholder(standing[1] ?? "");
      if (v) {
        out.standing = v;
      }
      continue;
    }
    const hearing = HEARING_RE.exec(body);
    if (hearing) {
      const v = stripPlaceholder(hearing[1] ?? "");
      if (v) {
        out.hearingAt = v;
      }
      continue;
    }
    const kind = KIND_RE.exec(body);
    if (kind) {
      const v = stripPlaceholder(kind[1] ?? "");
      if (v) {
        out.matterKindLabel = v;
      }
    }
  }
  return out;
}

export type MatterProfileView = {
  matterId: string;
  title: string;
  clientId?: string;
  sensitivity: "normal" | "high" | "restricted";
  status: string;
  causeOfAction?: string;
  counterparty?: string;
  matterKind?: string;
  caseNo?: string;
  court?: string;
  instance?: string;
  standing?: string;
  hearingAt?: string;
  /** 建议补全：仍为接洽中，或关键档案字段为空 */
  needsEnrichment: boolean;
};

export function buildMatterProfileView(input: {
  matterId: string;
  title: string;
  clientId?: string;
  sensitivity: "normal" | "high" | "restricted";
  status: string;
  causeOfAction?: string;
  counterparty?: string;
  matterKind?: string;
  caseNo?: string;
  court?: string;
  instance?: string;
  standing?: string;
  hearingAt?: string;
}): MatterProfileView {
  const clientId = input.clientId?.trim() || undefined;
  const causeOfAction = input.causeOfAction?.trim() || undefined;
  const needsEnrichment = input.status === "intake" || !clientId || !causeOfAction;
  return {
    matterId: input.matterId,
    title: input.title,
    clientId,
    sensitivity: input.sensitivity,
    status: input.status,
    causeOfAction,
    counterparty: input.counterparty?.trim() || undefined,
    matterKind: input.matterKind,
    caseNo: input.caseNo?.trim() || undefined,
    court: input.court?.trim() || undefined,
    instance: input.instance?.trim() || undefined,
    standing: input.standing?.trim() || undefined,
    hearingAt: input.hearingAt?.trim() || undefined,
    needsEnrichment,
  };
}
