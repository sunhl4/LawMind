/**
 * Remaining lawyer-facing pauses after「交办即终稿」(2026-10-01).
 *
 * Product north star: mid-delivery must not interrupt the lawyer. Every entry
 * here is a deliberate exception with an explicit "model couldn't / physics"
 * assumption so upgrades can ablate it.
 *
 * Do not add pauses for clarification gaps, verify-red, tool budget, or
 * send_email — those already complete with gaps / 待发信.
 */

export type LawyerPauseKind =
  | "user_abort"
  | "icloud_download"
  | "ethics_wall_outbound"
  | "judgment_escalation"
  | "workflow_blocked_gate"
  | "legacy_continue_tools";

export type LawyerPauseEntry = {
  kind: LawyerPauseKind;
  /** Why this still stops the lawyer (assumption that may expire). */
  assumption: string;
  /** Lawyer-visible surface. */
  surface: string;
  /** Ablate when this becomes true. */
  ablateWhen: string;
};

/** Canonical registry — keep this list short; cassette-lock any addition. */
export const LAWYER_PAUSE_REGISTRY: readonly LawyerPauseEntry[] = [
  {
    kind: "user_abort",
    assumption: "律师主动点了停止；进度检查点需要可恢复。",
    surface: "paused + continue_tools（用户中断）",
    ablateWhen: "从不消融——人主动停必须可续。",
  },
  {
    kind: "icloud_download",
    assumption: "材料还在 iCloud 占位，本机没有正文，无法起草。",
    surface: "awaiting_clarification（icloudDownloadAsk）",
    ablateWhen: "本地已有可读副本或引擎能透明拉取全文。",
  },
  {
    kind: "ethics_wall_outbound",
    assumption: "利益冲突墙命中：外发离开本机前必须律师确认。",
    surface: "approvalRequest / ethics wall hold",
    ablateWhen: "从不因模型变强而消融——离开本机的合规确认是产品骨架。",
  },
  {
    kind: "judgment_escalation",
    assumption: "两条路会写出相反生效文本，且档案/材料没有默认。",
    surface: "judgment_escalation 卡",
    ablateWhen: "真稿集上模型能稳定选保守默认并在文内标清备选，且律师不误发。",
  },
  {
    kind: "workflow_blocked_gate",
    assumption: "Guardian/硬门禁耗尽覆盖轮次：继续改只会磨稿。",
    surface: "completed + 【待核实】回复 + workflow_blocked 知会卡（非中途打断）",
    ablateWhen: "真稿集上内部重写在耗尽前总能交可用稿，知会卡也可去掉。",
  },
  {
    kind: "legacy_continue_tools",
    assumption: "旧会话曾挂过预算/验收 continue_tools 卡；恢复路径仍要能点继续。",
    surface: "continue_tools（仅遗留）",
    ablateWhen: "工作区不再有 pending continue_tools 动作。",
  },
] as const;

export function lawyerPauseKinds(): LawyerPauseKind[] {
  return LAWYER_PAUSE_REGISTRY.map((e) => e.kind);
}

export function findLawyerPause(kind: LawyerPauseKind): LawyerPauseEntry | undefined {
  return LAWYER_PAUSE_REGISTRY.find((e) => e.kind === kind);
}
