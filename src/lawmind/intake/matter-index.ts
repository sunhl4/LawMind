/**
 * 判案用的案件快照：未结案案件的案号、当事人、联系方式，加上邮件线程表。
 * 每批来件建一次，不常驻内存。
 */

import { loadMatter } from "../adapters/matter-storage/index.js";
import { listMatterIdsFromStorage } from "../adapters/matter-storage/io.js";
import { hydrateMatterParties } from "../desk/matter-parties.js";
import type { IntakeMatterIndex, IntakeMatterProfile } from "./resolve.js";
import { splitDocketCaseNos } from "./resolve.js";
import { readIntakeThreadRefs } from "./store.js";

export function buildIntakeMatterIndex(workspaceDir: string): IntakeMatterIndex {
  const matters: IntakeMatterProfile[] = [];
  for (const matterId of listMatterIdsFromStorage(workspaceDir)) {
    let record;
    try {
      record = loadMatter(workspaceDir, matterId);
    } catch {
      continue;
    }
    if (!record || record.status === "closed") {
      continue;
    }
    const parties = hydrateMatterParties(record);
    matters.push({
      matterId: record.matterId,
      title: record.title,
      caseNos: splitDocketCaseNos(record.docket?.caseNo),
      parties: parties.map((p) => ({ partyId: p.partyId, name: p.name })),
      contacts: parties.flatMap((p) =>
        (p.contacts ?? []).map((c) => ({
          partyId: p.partyId,
          kind: c.kind,
          value: c.value,
          verified: c.verified === true,
          ...(c.account ? { account: c.account } : {}),
          ...(c.externalId ? { externalId: c.externalId } : {}),
        })),
      ),
    });
  }
  return { matters, threadRefs: readIntakeThreadRefs(workspaceDir) };
}
