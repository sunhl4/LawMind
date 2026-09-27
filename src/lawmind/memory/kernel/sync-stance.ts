import { readMatterParties } from "../../host-access/matter-fence.js";
import type { StanceItem } from "../../stance/types.js";
import { replaceMemoryRecord } from "./store.js";

/** 立场文件仍是律师可打开的投影；内核行以 stance id 对齐，已撤回的不复活。 */
export function syncStanceItemsToKernel(workspaceDir: string, items: StanceItem[]): void {
  for (const item of items) {
    const evidenceMatterIds = [
      ...new Set(
        (item.evidence ?? []).map((e) => e.matterId).filter((x): x is string => Boolean(x)),
      ),
    ];
    const parties = evidenceMatterIds[0]
      ? readMatterParties(workspaceDir, evidenceMatterIds[0])
      : {};
    const firmDefault = item.id.startsWith("firm_default_");
    const body = [item.preferredLanguage, item.position].filter(Boolean).join(" ").trim();
    if (!body) {
      continue;
    }
    replaceMemoryRecord(workspaceDir, {
      id: `stance_${item.id}`,
      kind: "stance",
      scope: "lawyer",
      key: `stance.${item.clauseType}`,
      body,
      confirmation: firmDefault || item.supersededBy ? "pending" : "confirmed",
      validity: item.supersededBy ? "superseded" : "current",
      origin: firmDefault ? "firm_default" : "stance",
      confidence: item.modelConfidence ?? item.confidence,
      evidenceMatterIds,
      ...(item.supersededBy ? { supersededBy: `stance_${item.supersededBy}` } : {}),
      ...(evidenceMatterIds[0] ? { sourceMatterId: evidenceMatterIds[0] } : {}),
      ...(parties.clientId ? { clientId: parties.clientId } : {}),
      ...(parties.counterparty ? { counterparty: parties.counterparty } : {}),
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    });
  }
}
