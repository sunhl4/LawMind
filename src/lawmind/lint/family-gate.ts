import type { LegalLintContext, LegalLintFamily } from "./types.js";

/**
 * 族 → 适用交付物类型集（双门之一）。各族清单均为合同/协议类核对项，
 * 只适用于合同类交付物；意见书、备忘录、诉讼文书、报告等提及关键词不触发。
 * 适用类型集待执业法律顾问复核。
 */
const FAMILY_DELIVERABLE_TYPES: Partial<Record<LegalLintFamily, readonly string[]>> = {
  sale: ["contract.general", "contract.review"],
  loan: ["contract.general", "contract.review"],
  lease: ["contract.rental", "contract.general", "contract.review"],
  employment: ["contract.general", "contract.review"],
  equity: ["contract.general", "contract.review"],
  construction: ["contract.general", "contract.review"],
};

/**
 * 族触发双门之类型门：deliverableType 已知时须落在该族适用类型集内；
 * 未知（缺省/空串）时不跑族规则，避免意见书/备忘录仅因关键词套上合同清单。
 */
export function familyDeliverableMatches(family: LegalLintFamily, ctx?: LegalLintContext): boolean {
  const deliverableType = ctx?.deliverableType?.trim();
  if (!deliverableType) {
    return false;
  }
  const applicable = FAMILY_DELIVERABLE_TYPES[family];
  if (!applicable) {
    return true;
  }
  return applicable.includes(deliverableType);
}
