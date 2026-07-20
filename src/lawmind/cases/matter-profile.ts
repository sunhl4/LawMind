/**
 * 案件档案（事后补全）：从 CASE.md §1 解析可选字段，供工作台表单回填。
 */

const CAUSE_RE = /^案由[:：]\s*(.+)$/;
const COUNTERPARTY_RE = /^对方当事人[:：]\s*(.+)$/;
const CLIENT_LINE_RE = /^客户\s*\/\s*clientId[:：]\s*(.+)$/i;

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
    needsEnrichment,
  };
}
