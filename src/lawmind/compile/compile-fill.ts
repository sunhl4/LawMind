/**
 * Shared compile-stage fill IR: extract slots from the instruction, run engines,
 * leave gaps as 待补. Adapters wrap existing labor/period/complaint/letter fills.
 * Mail short path and Word tracked lock do not use this.
 */

export type CompileFillKind =
  | "labor.calc"
  | "period.calc"
  | "litigation.complaint"
  | "letter.address"
  | "liability.cap"
  | "legal.elements";

export type CompileFillSlot = {
  key: string;
  label: string;
  value?: string;
  /** When set, slot is incomplete; never invent a value. */
  gap?: string;
};

export type CompileFillIR = {
  kind: CompileFillKind;
  slots: CompileFillSlot[];
  gaps: string[];
  /** Engine result or structured plan (compensation, period, complaint plan, …). */
  computed?: unknown;
};

export function collectGaps(slots: CompileFillSlot[]): string[] {
  const gaps: string[] = [];
  for (const slot of slots) {
    if (slot.gap) {
      gaps.push(slot.gap);
    } else if (slot.value === undefined || slot.value === "") {
      gaps.push(slot.label);
    }
  }
  return gaps;
}

export function formatSlotsAsLines(slots: CompileFillSlot[]): string {
  return slots
    .map((slot) => {
      if (slot.value !== undefined && slot.value !== "") {
        return `${slot.label}：${slot.value}`;
      }
      return `${slot.label}：【待补充】${slot.gap ? `（${slot.gap}）` : ""}`;
    })
    .join("\n");
}
