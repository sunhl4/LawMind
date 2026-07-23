/**
 * Attorney verification checklist — Skills epic E6.
 * Incomplete checklist blocks review approve (422).
 */

import type { DeliverableType } from "../types.js";

export type VerificationChecklistItemSpec = {
  id: string;
  label: string;
  /** When true, must be checked before approve */
  required: boolean;
};

export type VerificationChecklistSpec = {
  id: string;
  deliverableTypes: DeliverableType[] | ["*"];
  items: VerificationChecklistItemSpec[];
};

export type VerificationChecklistState = {
  specId: string;
  /** itemId → checked */
  checked: Record<string, boolean>;
  updatedAt?: string;
};

export type VerificationChecklistView = {
  spec: VerificationChecklistSpec;
  state: VerificationChecklistState;
  requiredTotal: number;
  requiredDone: number;
  complete: boolean;
  missingRequiredIds: string[];
};

const SPECS: VerificationChecklistSpec[] = [
  {
    id: "contract-review-v1",
    deliverableTypes: ["contract.review", "contract.general", "contract.rental", "contract.nda"],
    items: [
      { id: "parties", label: "已核对当事人名称与签约主体一致性", required: true },
      { id: "liability", label: "已审阅责任限制 / 赔偿上限条款", required: true },
      { id: "ip", label: "已审阅知识产权与保密条款（如适用）", required: true },
      { id: "terminate", label: "已审阅解除/终止与违约后果", required: true },
      { id: "citations", label: "高风险结论已核对引用或标注待核实", required: true },
      { id: "negotiate", label: "已形成谈判优先级或接受理由", required: false },
      { id: "client", label: "可对外摘要不含未核实断言", required: false },
    ],
  },
  {
    id: "demand-letter-v1",
    deliverableTypes: ["letter.demand"],
    items: [
      { id: "facts", label: "关键事实与证据指向一致", required: true },
      { id: "claim", label: "主张内容与金额可核对", required: true },
      { id: "deadline", label: "履行期限与后果表述准确", required: true },
      { id: "tone", label: "语气与送达意图符合办案策略", required: false },
    ],
  },
  {
    id: "general-v1",
    deliverableTypes: ["*"],
    items: [
      { id: "scope", label: "交付范围与律师指令一致", required: true },
      { id: "placeholders", label: "无未处理的【待补充】占位（或已明示）", required: true },
      { id: "citations", label: "关键依据已标注来源或待检索", required: true },
      { id: "risk", label: "已知风险已向律师可见", required: false },
    ],
  },
];

export function listVerificationChecklistSpecs(): VerificationChecklistSpec[] {
  return SPECS;
}

export function resolveVerificationChecklistSpec(
  deliverableType: DeliverableType | undefined,
): VerificationChecklistSpec {
  const dt = (deliverableType ?? "").trim();
  const exact = SPECS.find(
    (s) => s.deliverableTypes[0] !== "*" && (s.deliverableTypes as string[]).includes(dt),
  );
  if (exact) {
    return exact;
  }
  return SPECS.find((s) => s.deliverableTypes[0] === "*")!;
}

export function emptyChecklistState(spec: VerificationChecklistSpec): VerificationChecklistState {
  return {
    specId: spec.id,
    checked: Object.fromEntries(spec.items.map((i) => [i.id, false])),
  };
}

export function buildChecklistView(
  deliverableType: DeliverableType | undefined,
  state?: VerificationChecklistState | null,
): VerificationChecklistView {
  const spec = resolveVerificationChecklistSpec(deliverableType);
  // Empty / mismatched specId: still honor provided `checked` (desktop often omits specId).
  const base =
    !state || state.specId === spec.id || !state.specId?.trim() ? state : emptyChecklistState(spec);
  const checked = {
    ...emptyChecklistState(spec).checked,
    ...base?.checked,
  };
  const required = spec.items.filter((i) => i.required);
  const missing = required.filter((i) => !checked[i.id]).map((i) => i.id);
  return {
    spec,
    state: { ...base, specId: spec.id, checked },
    requiredTotal: required.length,
    requiredDone: required.length - missing.length,
    complete: missing.length === 0,
    missingRequiredIds: missing,
  };
}

/** Mark all required items checked (optional items unchanged). For desk one-click. */
export function checkAllRequiredChecklistItems(
  view: VerificationChecklistView,
  current?: Record<string, boolean>,
): Record<string, boolean> {
  const next = { ...(current ?? view.state.checked) };
  for (const item of view.spec.items) {
    if (item.required) {
      next[item.id] = true;
    }
  }
  return next;
}

export function assertChecklistCompleteForApprove(view: VerificationChecklistView): void {
  if (!view.complete) {
    const err = new Error(
      `checklist_incomplete: missing ${view.missingRequiredIds.join(",")}`,
    ) as Error & { code: string; missingRequiredIds: string[] };
    err.code = "checklist_incomplete";
    err.missingRequiredIds = view.missingRequiredIds;
    throw err;
  }
}
