/**
 * Structured matter brief fragment (对标 Harvey II「打开案件即继承上下文」).
 *
 * CASE.md 窗口（matter_index）之外的结构化补齐：matter.json 当事人 SSOT、
 * deadlines.jsonl 未决期限、材料清单、本案时间线摘录——这些都不在 CASE 正文里。
 * 全部为本机同步读取；无内容时不产出 fragment（不占 token）。
 */

import { loadMatter } from "../adapters/matter-storage/index.js";
import { listDeadlinesForMatter } from "../application/services/deadline-service.js";
import { listMatterMaterialFiles } from "../desk/matter-materials.js";
import { hydrateMatterParties, MATTER_PARTY_ROLE_ZH } from "../desk/matter-parties.js";
import { buildMatterPulse } from "../desk/matter-pulse.js";

const MAX_PARTIES = 8;
const MAX_OPEN_DEADLINES = 5;
const MAX_MATERIALS = 8;
const MAX_TIMELINE = 5;

function formatDay(iso: string | undefined): string {
  const t = (iso ?? "").trim();
  return t.length >= 10 ? t.slice(0, 10) : t;
}

/**
 * Build the 「本案速览」 fragment body. Returns undefined when the matter has
 * no structured content worth spending tokens on.
 */
export function buildMatterContextFragmentBody(opts: {
  workspaceDir: string;
  matterId: string;
}): string | undefined {
  const matterId = opts.matterId.trim();
  if (!matterId) {
    return undefined;
  }
  const rec = loadMatter(opts.workspaceDir, matterId);
  if (!rec) {
    return undefined;
  }

  const sections: string[] = [];

  const parties = hydrateMatterParties(rec).slice(0, MAX_PARTIES);
  if (parties.length > 0) {
    const line = parties
      .map((p) => `${MATTER_PARTY_ROLE_ZH[p.role] ?? p.role} ${p.name}`)
      .join("；");
    sections.push(`当事人：${line}`);
  }

  const openDeadlines = listDeadlinesForMatter(opts.workspaceDir, matterId)
    .filter((d) => d.status === "open" || d.status === "snoozed")
    .toSorted((a, b) => a.dueAt.localeCompare(b.dueAt))
    .slice(0, MAX_OPEN_DEADLINES);
  if (openDeadlines.length > 0) {
    const lines = openDeadlines.map((d) => {
      const sev = d.severity === "hard" || d.severity === "critical" ? "（硬）" : "";
      const kind = d.eventKind === "hearing" ? "开庭" : d.eventKind === "limitation" ? "时效" : "";
      return `- ${formatDay(d.dueAt)} ${d.title}${sev}${kind ? `（${kind}）` : ""}`;
    });
    sections.push(["未决期限：", ...lines].join("\n"));
  }

  const materials = listMatterMaterialFiles(opts.workspaceDir, matterId, {
    maxFiles: MAX_MATERIALS,
  });
  if (materials.length > 0) {
    const lines = materials.map((m) => `- ${m.fileName}`);
    sections.push([`材料（近期 ${materials.length} 项）：`, ...lines].join("\n"));
  }

  const pulse = buildMatterPulse(opts.workspaceDir, matterId);
  const timeline = (pulse?.timeline ?? []).slice(-MAX_TIMELINE);
  if (timeline.length > 0) {
    const lines = timeline.map((t) => `- ${formatDay(t.at)} ${t.title}`);
    sections.push(["近期进展：", ...lines].join("\n"));
  }

  if (sections.length === 0) {
    return undefined;
  }
  return [
    `## 本案速览 [${matterId}]（结构化档案；事实细节以 CASE 与材料原文为准）`,
    "",
    sections.join("\n\n"),
  ].join("\n");
}
