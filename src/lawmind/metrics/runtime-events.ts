/**
 * Runtime events for north-star metrics (task 1 P1).
 *
 * These events are emitted by the engine / agent at execution time and stored
 * under workspace/lawmind/metrics/runtime-events.jsonl.  They are kept separate
 * from the derived product-metrics so that:
 *   - north-star.ts can continue to use the existing product-events aggregation
 *     without being disrupted;
 *   - future consumers can join runtime events to product metrics by eventId.
 */

import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export type RuntimeEventKind = "tool_call" | "lint_run" | "lawyer_edit" | "deliver";

export type RuntimeEventMeta = Record<
  string,
  string | number | boolean | null | string[] | undefined
>;

export type RuntimeEvent = {
  eventId: string;
  ts: string;
  kind: RuntimeEventKind;
  taskId?: string;
  matterId?: string;
  deliverableType?: string;
  meta?: RuntimeEventMeta;
};

export function runtimeEventsPath(workspaceDir: string): string {
  return path.join(workspaceDir, "lawmind", "metrics", "runtime-events.jsonl");
}

export function appendRuntimeEvent(
  workspaceDir: string,
  event: Omit<RuntimeEvent, "eventId" | "ts">,
): RuntimeEvent {
  const dir = path.dirname(runtimeEventsPath(workspaceDir));
  fs.mkdirSync(dir, { recursive: true });
  const row: RuntimeEvent = { ...event, eventId: randomUUID(), ts: new Date().toISOString() };
  fs.appendFileSync(runtimeEventsPath(workspaceDir), `${JSON.stringify(row)}\n`, "utf8");
  return row;
}

export function listRuntimeEvents(workspaceDir: string, limit = 5000): RuntimeEvent[] {
  const file = runtimeEventsPath(workspaceDir);
  if (!fs.existsSync(file)) {
    return [];
  }
  const lines = fs.readFileSync(file, "utf8").split("\n").filter(Boolean);
  const events: RuntimeEvent[] = [];
  for (const line of lines.slice(-limit)) {
    try {
      events.push(JSON.parse(line) as RuntimeEvent);
    } catch {
      /* skip malformed lines */
    }
  }
  return events;
}

export function readRuntimeEventById(
  workspaceDir: string,
  eventId: string,
): RuntimeEvent | undefined {
  return listRuntimeEvents(workspaceDir).find((e) => e.eventId === eventId);
}

// ─────────────────────────────────────────────
// Convenience recorders
// ─────────────────────────────────────────────

export type ToolCallRuntimeEventInput = {
  toolName: string;
  toolCallId: string;
  roundIndex: number;
  approvalRequired: boolean;
  resultStatus: "ok" | "error" | "aborted" | "skipped";
  taskId?: string;
  matterId?: string;
  deliverableType?: string;
};

export function recordToolCallEvent(
  workspaceDir: string,
  input: ToolCallRuntimeEventInput,
): RuntimeEvent {
  return appendRuntimeEvent(workspaceDir, {
    kind: "tool_call",
    taskId: input.taskId,
    matterId: input.matterId,
    deliverableType: input.deliverableType,
    meta: {
      toolName: input.toolName,
      toolCallId: input.toolCallId,
      roundIndex: input.roundIndex,
      approvalRequired: input.approvalRequired,
      resultStatus: input.resultStatus,
    },
  });
}

export type LintRunRuntimeEventInput = {
  taskId?: string;
  matterId?: string;
  deliverableType?: string;
  ruleIds: string[];
  failCount: number;
  blockerCount: number;
  warningCount: number;
};

export function recordLintRunEvent(
  workspaceDir: string,
  input: LintRunRuntimeEventInput,
): RuntimeEvent {
  return appendRuntimeEvent(workspaceDir, {
    kind: "lint_run",
    taskId: input.taskId,
    matterId: input.matterId,
    deliverableType: input.deliverableType,
    meta: {
      ruleIds: input.ruleIds,
      failCount: input.failCount,
      blockerCount: input.blockerCount,
      warningCount: input.warningCount,
    },
  });
}

export type LawyerEditRuntimeEventInput = {
  taskId?: string;
  matterId?: string;
  deliverableType?: string;
  outcome: "approved" | "modified" | "rejected";
  lintEscape: boolean;
  note?: string;
};

export function recordLawyerEditEvent(
  workspaceDir: string,
  input: LawyerEditRuntimeEventInput,
): RuntimeEvent {
  return appendRuntimeEvent(workspaceDir, {
    kind: "lawyer_edit",
    taskId: input.taskId,
    matterId: input.matterId,
    deliverableType: input.deliverableType,
    meta: {
      outcome: input.outcome,
      lintEscape: input.lintEscape,
      ...(input.note ? { note: input.note } : {}),
    },
  });
}

/**
 * 交付事件的「为什么没打断」+「律师后验态度」判定（G2）。
 *
 * 抽成纯函数放在 metrics 层，便于单测与复用；`engine/rendering.ts` 只负责喂事实。
 *
 * **外生性纪律**：`reviewedBy` 以 `system:` 开头（自动交付）时，
 * `humanAcceptance` 一律 `"unknown"` —— 系统给自己签的字不算验收（SEAL 原理）。
 */
export function resolveDeliverSignals(input: {
  reviewStatus?: string;
  reviewedBy?: string;
  reviewNotesCount: number;
  /** 是否有实质改稿幅度（律师真动过）。 */
  hasRewriteAmplitude: boolean;
  blockerCount: number;
  warningCount: number;
}): {
  interruptionReason: DeliverInterruptionReason;
  humanAcceptance: DeliverHumanAcceptance;
} {
  const systemAttributed = (input.reviewedBy ?? "").trim().toLowerCase().startsWith("system:");
  const changed = input.reviewNotesCount > 0 || input.hasRewriteAmplitude;
  const status = (input.reviewStatus ?? "").trim().toLowerCase();

  let humanAcceptance: DeliverHumanAcceptance = "unknown";
  if (!systemAttributed && status === "approved") {
    humanAcceptance = changed ? "accepted_with_change" : "accepted_clean";
  } else if (!systemAttributed && (status === "rejected" || status === "needs_changes")) {
    // 律师明确驳回/要求修改 = 有反面证据，同样是决定性信号。
    humanAcceptance = "accepted_with_change";
  }
  // 其余（pending / 系统自动批准）→ unknown：信号未到，不猜。

  let interruptionReason: DeliverInterruptionReason = "unknown";
  if (input.blockerCount === 0 && input.warningCount === 0) {
    interruptionReason = "all_gates_green";
  } else if (input.blockerCount === 0) {
    // 有发现但只到 advisory 一档 —— 没到阻断线。
    interruptionReason = "advisory_only";
  }
  // 有 blocker 却走到了交付：不是我们能在这一层解释的情形，留 unknown。

  return { interruptionReason, humanAcceptance };
}

export type DeliverRuntimeEventInput = {
  taskId?: string;
  matterId?: string;
  deliverableType?: string;
  firstPass: boolean;
  lintEscape: boolean;
  outputPath?: string;
  /**
   * G2：本次交付**没有**打断律师的原因（SEAL 原理的落地形态）。
   *
   * 只记录事实，不改任何门禁。缺省 `"unknown"`——**不猜**。
   * 这个字段回答的是：「系统这次自己决定了放行，凭什么？」
   */
  interruptionReason?: DeliverInterruptionReason;
  /**
   * G2：**外生验收信号**——律师在交付时对本次交付的态度。
   *
   * 这是 `delivery/judgement-ratchet.ts` 的 `cleanDelivery` 唯一可接受的来源。
   * 必须是**律师发起**的事实；系统自己批准（自动交付）**不算**——
   * 那会构成"判定器给自己判卷"（SEAL：需要 agent 无法控制的验收信号）。
   *
   * 三态而非布尔：`"unknown"` 表示**信号还没到**（例如律师尚未审核），
   * 此时棘轮**必须整条不产出**，而不是把它当成「不干净」。
   */
  humanAcceptance?: DeliverHumanAcceptance;
};

/**
 * 为什么本次交付没有打断律师。
 *
 * - `all_gates_green`：全部门禁绿，无事可报。
 * - `advisory_only`：有发现但只到 advisory（不阻断）。
 * - `escalation_disabled`：升级通道在配置上关着。
 * - `unknown`：本次没有可判定的原因——**诚实缺省**，不要拿它当 `all_gates_green`。
 */
export type DeliverInterruptionReason =
  | "all_gates_green"
  | "advisory_only"
  | "escalation_disabled"
  | "unknown";

/**
 * 律师对本次交付的态度（外生信号）。
 *
 * - `accepted_clean`：律师批准、未写意见、未改稿——**干净接受**。
 * - `accepted_with_change`：律师动了（写意见 / 改稿 / 驳回）——该项是真报项。
 * - `unknown`：尚无律师动作（或批准来自系统自动交付）——**信号未到，不得猜测**。
 */
export type DeliverHumanAcceptance = "accepted_clean" | "accepted_with_change" | "unknown";

export function recordDeliverEvent(
  workspaceDir: string,
  input: DeliverRuntimeEventInput,
): RuntimeEvent {
  return appendRuntimeEvent(workspaceDir, {
    kind: "deliver",
    taskId: input.taskId,
    matterId: input.matterId,
    deliverableType: input.deliverableType,
    meta: {
      firstPass: input.firstPass,
      lintEscape: input.lintEscape,
      interruptionReason: input.interruptionReason ?? "unknown",
      humanAcceptance: input.humanAcceptance ?? "unknown",
      ...(input.outputPath ? { outputPath: input.outputPath } : {}),
    },
  });
}
