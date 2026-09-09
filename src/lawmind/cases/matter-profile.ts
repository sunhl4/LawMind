/**
 * 案件档案（事后补全）：从 CASE.md §1 解析可选字段，供工作台表单回填。
 */

const CAUSE_RE = /^案由[:：]\s*(.+)$/;
const COUNTERPARTY_RE = /^对方当事人[:：]\s*(.+)$/;
const CLIENT_LINE_RE = /^客户\s*\/\s*clientId[:：]\s*(.+)$/i;
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
