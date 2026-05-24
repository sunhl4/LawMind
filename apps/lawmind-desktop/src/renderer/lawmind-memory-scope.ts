import type { MemorySourceLayer } from "../../../../src/lawmind/memory/index.ts";

export const MEMORY_SCOPE_LABELS: Record<string, string> = {
  firm: "律所",
  lawyer: "律师",
  matter: "案件",
  client: "客户",
  playbook: "剧本",
  assistant: "助手",
  opponent: "对方",
  project: "项目",
  other: "其他",
};

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
