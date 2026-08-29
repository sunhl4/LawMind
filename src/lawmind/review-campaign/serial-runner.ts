/**
 * Serial heuristic role runner — findings (no LLM) for reproducible Score.
 * Firm parallel LLM runners come later (S6).
 */

import { extractReviewBrief, formatReviewBriefHeader, hasReviewBrief } from "./review-brief.js";
import { aggregateSafetyScore } from "./safety-score.js";
import type {
  FleetPlaybook,
  ReviewCampaignFinding,
  ReviewCampaignRoleId,
  ReviewCampaignRoleResult,
} from "./types.js";

function findingsForRole(
  roleId: ReviewCampaignRoleId,
  text: string,
): { score: number; findings: ReviewCampaignFinding[]; summary: string } {
  const t = text;
  const findings: ReviewCampaignFinding[] = [];

  if (roleId === "clause") {
    if (!/定义|释义|Definitions/i.test(t)) {
      findings.push({
        severity: "medium",
        title: "缺少定义条款",
        detail: "未发现明显「定义/释义」段落，建议核对关键术语是否一致。",
        negotiatePriority: 2,
      });
    }
    if ((t.match(/第[一二三四五六七八九十\d]+条/g) ?? []).length < 3 && t.length > 200) {
      findings.push({
        severity: "low",
        title: "条款结构偏简",
        detail: "正文较长但条款编号较少，建议确认章节完整性。",
        negotiatePriority: 1,
      });
    }
    return {
      score: Math.max(40, 90 - findings.length * 12),
      findings,
      summary: findings.length ? "条款结构有待补强。" : "条款结构未见明显缺口。",
    };
  }

  if (roleId === "risk") {
    const brief = extractReviewBrief(t);
    if (hasReviewBrief(brief)) {
      findings.push({
        severity: "low",
        title: "沿用原审查口径",
        detail: `专案组按交办口径复核：${formatReviewBriefHeader(brief).replace("【审查口径】", "")}。风险与责任须对照此立场与重点，不得改成中立默认。`,
        negotiatePriority: 1,
      });
    }
    if (!/责任上限|赔偿上限|limitation of liability|累计责任/i.test(t)) {
      findings.push({
        severity: "high",
        title: "未见责任上限",
        detail: "未识别责任限制/赔偿上限表述，高风险偏移需律师确认。",
        negotiatePriority: 5,
      });
    }
    if (/无限责任|全部损失|间接损失不予/i.test(t)) {
      findings.push({
        severity: "high",
        title: "责任表述偏极端",
        detail: "出现无限责任或单方排除间接损失等表述，建议列入谈判优先项。",
        negotiatePriority: 5,
      });
    }
    if (!/解除|终止|termination/i.test(t)) {
      findings.push({
        severity: "medium",
        title: "解除/终止条款弱",
        detail: "未明显覆盖解除或终止机制。",
        negotiatePriority: 3,
      });
    }
    return {
      score: Math.max(
        25,
        88 - findings.filter((f) => f.severity === "high").length * 18 - findings.length * 6,
      ),
      findings,
      summary: findings.length ? "风险与责任需重点谈判。" : "风险条款未见高危缺口。",
    };
  }

  if (roleId === "compliance") {
    if (/个人[信息|资料]|个人信息|GDPR|数据出境/i.test(t) && !/安全|加密|授权/i.test(t)) {
      findings.push({
        severity: "high",
        title: "数据处理义务不足",
        detail: "涉及个人/数据但缺少安全或授权表述。",
        negotiatePriority: 4,
      });
    }
    if (!/适用法律|管辖|governing law/i.test(t)) {
      findings.push({
        severity: "medium",
        title: "管辖/适用法未明示",
        detail: "建议补充适用法律与争议解决条款。",
        negotiatePriority: 2,
      });
    }
    return {
      score: Math.max(35, 86 - findings.length * 14),
      findings,
      summary: findings.length ? "合规项有缺口。" : "合规扫描未见明显缺口。",
    };
  }

  if (roleId === "obligation_timeline") {
    if (!/\d+\s*日|\d+\s*天|工作日|calendar day|通知期/i.test(t)) {
      findings.push({
        severity: "medium",
        title: "期限表述稀少",
        detail: "未抽取到明确日/工作日节点，义务时间线可能不完整。",
        negotiatePriority: 3,
      });
    }
    if (/自动续期|自动延长|auto-?renew/i.test(t)) {
      findings.push({
        severity: "medium",
        title: "存在自动续期",
        detail: "自动续期条款应核对通知窗口与退出成本。",
        negotiatePriority: 3,
      });
    }
    return {
      score: Math.max(40, 88 - findings.length * 12),
      findings,
      summary: findings.length ? "义务时间线需律师核对。" : "期限节点未见明显陷阱。",
    };
  }

  // citation_check
  if (!/\[src-|来源|引用|待核实|citation/i.test(t)) {
    findings.push({
      severity: "medium",
      title: "高风险结论缺引用标注",
      detail: "正文未见来源/待核实标记，严格援引模式下导出可能被拦截。",
      negotiatePriority: 3,
    });
  }
  if (/必须|必然|毫无疑问/.test(t) && !/来源|引用|依据/.test(t)) {
    findings.push({
      severity: "low",
      title: "断言语气偏强",
      detail: "存在强硬断言但未附依据，建议降级或补源。",
      negotiatePriority: 1,
    });
  }
  return {
    score: Math.max(40, 90 - findings.length * 12),
    findings,
    summary: findings.length ? "引用核验待补强。" : "引用标注未见明显问题。",
  };
}

/** Run all roles serially; mutates role results in order. */
export function runCampaignRolesSerial(
  playbook: FleetPlaybook,
  sourceText: string,
): { roles: ReviewCampaignRoleResult[]; safetyScore: ReturnType<typeof aggregateSafetyScore> } {
  const now = () => new Date().toISOString();
  const roles: ReviewCampaignRoleResult[] = playbook.roles.map((r) => ({
    roleId: r.id,
    label: r.label,
    status: "pending" as const,
    weight: r.weight,
    findings: [],
  }));

  for (let i = 0; i < roles.length; i++) {
    const role = roles[i];
    const startedAt = now();
    role.status = "running";
    role.startedAt = startedAt;
    const out = findingsForRole(role.roleId, sourceText);
    role.status = "done";
    role.finishedAt = now();
    role.score = out.score;
    role.findings = out.findings;
    role.summary = out.summary;
  }

  return { roles, safetyScore: aggregateSafetyScore(roles) };
}

/**
 * Firm parallel path — same heuristics, independent per-role timestamps
 * (no cross-role ordering dependency). Solo must not call this.
 */
export function runCampaignRolesParallel(
  playbook: FleetPlaybook,
  sourceText: string,
): { roles: ReviewCampaignRoleResult[]; safetyScore: ReturnType<typeof aggregateSafetyScore> } {
  const startedAt = new Date().toISOString();
  const roles: ReviewCampaignRoleResult[] = playbook.roles.map((r) => {
    const out = findingsForRole(r.id, sourceText);
    const finishedAt = new Date().toISOString();
    return {
      roleId: r.id,
      label: r.label,
      status: "done" as const,
      weight: r.weight,
      startedAt,
      finishedAt,
      score: out.score,
      findings: out.findings,
      summary: out.summary,
    };
  });
  return { roles, safetyScore: aggregateSafetyScore(roles) };
}

/** Re-run a single role; keeps other role results. */
export function rerunCampaignRole(
  playbook: FleetPlaybook,
  roles: ReviewCampaignRoleResult[],
  roleId: ReviewCampaignRoleId,
  sourceText: string,
): { roles: ReviewCampaignRoleResult[]; safetyScore: ReturnType<typeof aggregateSafetyScore> } {
  const spec = playbook.roles.find((r) => r.id === roleId);
  if (!spec) {
    throw new Error(`unknown_role:${roleId}`);
  }
  const next = roles.map((r) => ({ ...r, findings: [...r.findings] }));
  const idx = next.findIndex((r) => r.roleId === roleId);
  const startedAt = new Date().toISOString();
  const out = findingsForRole(roleId, sourceText);
  const updated: ReviewCampaignRoleResult = {
    roleId,
    label: spec.label,
    status: "done",
    weight: spec.weight,
    startedAt,
    finishedAt: new Date().toISOString(),
    score: out.score,
    findings: out.findings,
    summary: out.summary,
  };
  if (idx >= 0) {
    next[idx] = updated;
  } else {
    next.push(updated);
  }
  return { roles: next, safetyScore: aggregateSafetyScore(next) };
}
