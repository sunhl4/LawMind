import type { AssistantProfile } from "./types.js";

function orgRoleLabel(r: AssistantProfile["orgRole"]): string {
  if (r === "lead") {
    return "主办";
  }
  if (r === "member") {
    return "协办";
  }
  if (r === "intern") {
    return "实习/辅助";
  }
  return "";
}

/**
 * When any assistant has org metadata, inject a short org chart into the system prompt.
 */
export function formatTeamOrgOverviewForPrompt(profiles: AssistantProfile[]): string | undefined {
  const anyOrg = profiles.some(
    (p) => p.orgRole || p.reportsToAssistantId || p.peerReviewDefaultAssistantId,
  );
  if (!anyOrg) {
    return undefined;
  }
  const byId = new Map(profiles.map((p) => [p.assistantId, p]));
  return profiles
    .map((p) => {
      const extras: string[] = [];
      const rl = orgRoleLabel(p.orgRole);
      if (rl) {
        extras.push(rl);
      }
      if (p.reportsToAssistantId) {
        const boss = byId.get(p.reportsToAssistantId)?.displayName ?? p.reportsToAssistantId;
        extras.push(`向 **${boss}** 汇报`);
      }
      if (p.peerReviewDefaultAssistantId) {
        const bud =
          byId.get(p.peerReviewDefaultAssistantId)?.displayName ?? p.peerReviewDefaultAssistantId;
        extras.push(`建议互审：**${bud}**`);
      }
      return extras.length > 0
        ? `- **${p.displayName}** (\`${p.assistantId}\`)：${extras.join("；")}`
        : `- **${p.displayName}** (\`${p.assistantId}\`)`;
    })
    .join("\n");
}

export function formatCurrentAssistantOrgLine(
  profile: AssistantProfile | undefined,
  all: AssistantProfile[],
): string | undefined {
  if (!profile) {
    return undefined;
  }
  const byId = new Map(all.map((p) => [p.assistantId, p]));
  const parts: string[] = [];
  const rl = orgRoleLabel(profile.orgRole);
  if (rl) {
    parts.push(`组织角色：${rl}`);
  }
  if (profile.reportsToAssistantId) {
    const boss =
      byId.get(profile.reportsToAssistantId)?.displayName ?? profile.reportsToAssistantId;
    parts.push(`汇报对象：${boss}`);
  }
  if (profile.peerReviewDefaultAssistantId) {
    const bud =
      byId.get(profile.peerReviewDefaultAssistantId)?.displayName ??
      profile.peerReviewDefaultAssistantId;
    parts.push(`互审首选：${bud}`);
  }
  return parts.length > 0 ? parts.join(" · ") : undefined;
}
