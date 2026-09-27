/**
 * Adapter: 口语要件提取 → CompileFillIR。抽不到的槽留缺口，不补事实。
 */

import {
  extractLegalElements,
  LEGAL_ELEMENT_LABELS,
  type LegalElementSlot,
} from "../reasoning/legal-elements.js";
import { collectGaps, type CompileFillIR, type CompileFillSlot } from "./compile-fill.js";

const SLOT_ORDER = Object.keys(LEGAL_ELEMENT_LABELS) as LegalElementSlot[];

export function extractLegalElementsCompileFill(instruction: string): CompileFillIR {
  const extracted = extractLegalElements(instruction);
  const slots: CompileFillSlot[] = SLOT_ORDER.map((key) => {
    const value = extracted.slots[key];
    const label = LEGAL_ELEMENT_LABELS[key];
    return {
      key,
      label,
      value,
      gap: value ? undefined : label,
    };
  });
  return {
    kind: "legal.elements",
    slots,
    gaps: collectGaps(slots),
    computed: extracted,
  };
}
