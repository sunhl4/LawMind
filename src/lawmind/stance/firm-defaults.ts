import { readStanceItems, writeStanceItems } from "./store.js";
import type { StanceItem } from "./types.js";

const DEFAULTS: Omit<StanceItem, "id" | "createdAt" | "updatedAt">[] = [
  {
    clauseType: "管辖",
    family: "general",
    position: "争议解决须单一确定",
    preferredLanguage: "争议提交一家明确的仲裁机构或一家有管辖权的人民法院，不写或裁或诉。",
    source: "manual",
    confidence: 0.45,
    occurrences: 1,
  },
  {
    clauseType: "定金",
    family: "sale",
    position: "定金不超过法定上限",
    preferredLanguage: "定金不超过主合同标的额的百分之二十。",
    statuteBasis: "民法典第586条",
    source: "manual",
    confidence: 0.45,
    occurrences: 1,
  },
];

/** Seed firm defaults only when the stance file does not exist yet. */
export function ensureFirmStanceDefaults(workspaceDir: string): number {
  const existing = readStanceItems(workspaceDir);
  if (existing.length > 0) {
    return 0;
  }
  const now = new Date().toISOString();
  const items: StanceItem[] = DEFAULTS.map((row, i) => ({
    ...row,
    id: `firm_default_${i + 1}`,
    createdAt: now,
    updatedAt: now,
  }));
  writeStanceItems(workspaceDir, items);
  return items.length;
}
