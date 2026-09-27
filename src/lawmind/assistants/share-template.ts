/**
 * 岗位模板导出。接收方得到一份独立副本：没有记忆、用量、汇报对象和本机路径。
 *
 * 硬拦只针对密钥与私钥（交出去就会泄密）。电话、证件号只作提醒，
 * 律师确认后仍可导出——这不是用关键词去卡模型写稿。
 */

import type { AssistantProfile } from "./types.js";
import { normalizeAssistantJobBrief } from "./types.js";

export type AssistantShareRoutine = {
  title: string;
  schedule: string;
  expectedResult?: string;
  approvalBoundary?: string;
  eventMatch?: string;
};

export type AssistantShareTemplate = {
  kind: "lawmind-assistant-template";
  displayName: string;
  introduction: string;
  presetKey?: string;
  customRoleTitle?: string;
  customRoleInstructions?: string;
  jobBrief?: AssistantProfile["jobBrief"];
  /** 这位助手名下的常设工作定义。不含邮箱、记忆和运行记录。 */
  routines?: AssistantShareRoutine[];
};

export type AssistantShareChecklist = {
  ok: boolean;
  blockers: string[];
  warnings: string[];
  template?: AssistantShareTemplate;
};

const SECRET_RE =
  /(?:sk-[A-Za-z0-9]{8,}|api[_-]?key\s*[:=]\s*\S+|Bearer\s+[A-Za-z0-9._-]{8,}|-----BEGIN [A-Z ]+PRIVATE KEY-----)/i;
const PHONE_RE = /(?<!\d)1[3-9]\d{9}(?!\d)/;
const ID_RE = /(?<!\d)\d{17}[\dXx](?!\d)/;

function stripUrlQuery(text: string): string {
  return text.replace(/https?:\/\/[^\s]+/gi, (url) => {
    try {
      const parsed = new URL(url);
      parsed.search = "";
      parsed.hash = "";
      return parsed.toString();
    } catch {
      return url.split("?")[0] ?? url;
    }
  });
}

function clean(text: string | undefined): string {
  return stripUrlQuery(text ?? "").trim();
}

export function reviewAssistantShare(
  profile: AssistantProfile,
  routines: AssistantShareRoutine[] = [],
): AssistantShareChecklist {
  const template: AssistantShareTemplate = {
    kind: "lawmind-assistant-template",
    displayName: clean(profile.displayName) || "助手",
    introduction: clean(profile.introduction),
    presetKey: profile.presetKey,
    customRoleTitle: clean(profile.customRoleTitle) || undefined,
    customRoleInstructions: clean(profile.customRoleInstructions) || undefined,
    jobBrief: normalizeAssistantJobBrief({
      responsibility: clean(profile.jobBrief?.responsibility),
      sources: clean(profile.jobBrief?.sources),
      deliverables: clean(profile.jobBrief?.deliverables),
      prohibitions: clean(profile.jobBrief?.prohibitions),
      escalation: clean(profile.jobBrief?.escalation),
    }),
    routines:
      routines.length > 0
        ? routines.map((routine) => ({
            title: clean(routine.title) || "常设工作",
            schedule: clean(routine.schedule),
            expectedResult: clean(routine.expectedResult) || undefined,
            approvalBoundary: clean(routine.approvalBoundary) || undefined,
            eventMatch: clean(routine.eventMatch) || undefined,
          }))
        : undefined,
  };
  const blob = JSON.stringify(template);
  const blockers: string[] = [];
  const warnings: string[] = [];
  if (SECRET_RE.test(blob)) {
    blockers.push("职务说明里有密钥或私钥，导出前请删掉");
  }
  if (PHONE_RE.test(blob) || ID_RE.test(blob)) {
    warnings.push("里面像是有电话或证件号。确认不是客户资料后再导出");
  }
  if (blockers.length > 0) {
    return { ok: false, blockers, warnings };
  }
  return { ok: true, blockers, warnings, template };
}

export function exportAssistantShare(
  profile: AssistantProfile,
  acknowledgeWarnings: boolean,
  routines: AssistantShareRoutine[] = [],
): AssistantShareChecklist {
  const reviewed = reviewAssistantShare(profile, routines);
  if (!reviewed.ok) {
    return reviewed;
  }
  if (reviewed.warnings.length > 0 && !acknowledgeWarnings) {
    return { ok: false, blockers: [], warnings: reviewed.warnings };
  }
  return reviewed;
}
