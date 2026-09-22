/** Detect resume-protocol user messages so the chat UI can show a status chip instead of a bubble. */

export type LawyerGateKind = "approved" | "rejected" | "edited";

export type LawyerGateMessage = {
  kind: LawyerGateKind;
  /** Human tool label when present, e.g. 写回草稿 */
  toolLabel?: string;
};

const GATE_RE =
  /^【律师已(批准|拒绝|取消|修改参数并批准)】(?:请继续完成「([^」]+)」|「([^」]+)」)?/;

export function parseLawyerGateMessage(text: string): LawyerGateMessage | null {
  const trimmed = text.trim();
  const m = GATE_RE.exec(trimmed);
  if (!m) {
    return null;
  }
  const verb = m[1];
  const toolLabel = (m[2] ?? m[3])?.trim() || undefined;
  if (verb === "修改参数并批准") {
    return { kind: "edited", toolLabel };
  }
  if (verb === "拒绝" || verb === "取消") {
    return { kind: "rejected", toolLabel };
  }
  return { kind: "approved", toolLabel };
}

export function formatLawyerGateChip(gate: LawyerGateMessage): string {
  const target = gate.toolLabel ? `「${gate.toolLabel}」` : "该步骤";
  if (gate.kind === "edited") {
    return `已改参数并批准继续 ${target}`;
  }
  if (gate.kind === "rejected") {
    return `已取消 ${target}`;
  }
  return `已批准继续 ${target}`;
}
