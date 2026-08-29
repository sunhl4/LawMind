import type { MemorySourceLayer } from "../../../../src/lawmind/memory/index.ts";

export const MEMORY_SCOPE_LABELS: Record<string, string> = {
  firm: "律所惯例",
  lawyer: "我的习惯",
  matter: "本案",
  client: "客户",
  playbook: "条款要点",
  assistant: "助手人设",
  opponent: "对方",
  project: "项目",
  other: "其他",
};

/** Suggestion kind → lawyer-facing label */
export const MEMORY_KIND_LABELS: Record<string, string> = {
  "lawyer.profile_learning": "办案偏好",
  "case.core_issue": "核心争点",
  "case.risk_note": "风险备注",
  "playbook.clause_learning": "条款审查要点",
  "firm.preference": "所内惯例",
  "assistant.profile_section": "助手补充",
  "historical.knowledge": "历史材料整理",
  "lawyer.habit_pattern": "重复改法（待确认）",
};

export function memoryKindLabel(kind: string): string {
  return MEMORY_KIND_LABELS[kind] ?? kind;
}

export function mapMemoryLayerToScope(layer: MemorySourceLayer): string {
  const id = layer.id;
  const norm = layer.relativePath.replace(/\\/g, "/");
  if (id === "firm_profile" || norm.includes("FIRM_PROFILE")) {
    return "firm";
  }
  if (id === "lawyer_profile" || norm.includes("LAWYER_PROFILE")) {
    return "lawyer";
  }
  if (id.startsWith("case_") || norm.startsWith("cases/")) {
    return "matter";
  }
  if (id.startsWith("client_") || norm.startsWith("clients/")) {
    return "client";
  }
  if (norm.startsWith("playbooks/")) {
    return "playbook";
  }
  if (norm.startsWith("assistants/")) {
    return "assistant";
  }
  if (id === "project_dir" || norm.startsWith("projects/")) {
    return "project";
  }
  return "other";
}

export function memoryScopeLabel(scope: string): string {
  return MEMORY_SCOPE_LABELS[scope] ?? scope;
}
