/**
 * 另起新对话并带上文（fork with carryover）—— 客户要的「上下文过多 → 跳转新对话，但要有原对话记忆」。
 *
 * 主流的两条路：
 * - Codex：token-budget compaction 可以**开新窗口但不做模型摘要**；自动压缩会保留初始上下文 +
 *   最近约 20k token 的用户消息。它自己也承认「长会话与多次压缩会让准确率下降」。
 * - Cursor：`/summarize` 把整段对话交给摘要模型，重建为「system + 结构化摘要」，并明确
 *   **「the file is the whole handoff」**——硬性要求放 rules / `TASK.md`，别指望会话记忆。
 *
 * LawMind 走的是**真·新会话 + 续接种子**，而不是原地清空可见线程：
 * 1. 新会话（同 matter / 同助手），开场注入一份**续接种子**（合成 user 消息，律师气泡看不到）；
 * 2. 源会话冻结为只读前史，标 `forkedTo`，侧栏显示「→ 由此续接」；
 * 3. 「记忆」不新造一套：复用案件级载体（`session-summary.md` / `CASE.md` / 待办队列 /
 *    草稿 acceptance）＋一份会话级种子。种子只做三件事——
 *    **状态头**（案件、待澄清键、已确认答案、本轮清单、绑定的办件）、
 *    **对话蒸馏**（提取式保底，可被 LLM 摘要替换）、
 *    **重读指针**（CASE.md / 材料目录 / 草稿 taskId / 源会话 id，要原文自己再读）。
 *
 * 闸门状态是本功能最容易出事的地方，因此：
 * - **迁移**：待澄清键、已确认答案、本轮清单、绑定的办件、已披露工具表 —— 丢了就是静默放开
 *   起草硬门禁或让工具表回退（仓库里最不可接受的一类 bug）。
 * - **拦截**：待批准的工具 / 案件审批、升级给律师的判断、被阻断的工作流、检查点续跑，
 *   以及回合仍在跑 —— 这些是**活的授权或活的状态**，跨会话搬会断审计链，一律 409。
 * - **不迁移**：钉选材料（语义是「本回合重点」），只写进指针段。
 */

import { emit } from "../audit/index.js";
import { recordContextPressure } from "../metrics/context-pressure.js";
import type { LawMindRequiresAction } from "../platform/requires-action.js";
import {
  buildDroppedSpanDigest,
  collectCompactAttachmentNotes,
  readSessionSummary,
} from "./compact.js";
import { createSession, loadSession, saveSession } from "./session.js";
import { isSessionTurnLive } from "./turn-interrupt.js";
import type { AgentTurnPlan } from "./turn-plan-model.js";
import type { AgentMessage, AgentSession } from "./types.js";

/** 合成续接种子的前缀；同时登记进 `COMPACT_SYNTHETIC_USER_MARKERS`（压缩可整条丢弃）。 */
export const CARRYOVER_SEED_MARKER = "【前序对话续接】";

/**
 * 种子长度占模型窗口的比例。比原地压缩的 8% 略宽：新会话几乎空窗，多带一点更划算；
 * 上界仍收在 32k，避免把新会话一上来就顶到自动整理线。
 */
export const CARRYOVER_SEED_CHAR_RATIO = 0.1;

export function resolveCarryoverSeedCharCap(contextTokens?: number): number {
  const ctx = typeof contextTokens === "number" && contextTokens > 0 ? contextTokens : 128_000;
  return Math.min(32_000, Math.max(8_000, Math.floor(ctx * CARRYOVER_SEED_CHAR_RATIO)));
}

/** 律师侧「续接来源」卡片的摘要预览长度。完整整理稿在会话上下文里，不在这里重复存。 */
export const CARRYOVER_DIGEST_PREVIEW_CHARS = 400;

/**
 * 可在会话间安全迁移的闸门状态。字段名与 `AgentSession` 一一对应，便于审计比对。
 */
export type CarryoverMigratedState = {
  matterId?: string;
  linkedTaskId?: string;
  pendingClarificationKeys?: string[];
  lastConfirmedAnswers?: Record<string, string>;
  turnPlan?: AgentTurnPlan;
  lastBoundCapabilityId?: import("../skills/lawyer-capability-lock.js").LawyerCapabilityId;
  disclosedToolNames?: string[];
};

export type CarryoverDraft = {
  sourceSessionId: string;
  /** 被蒸馏的对话（源会话全部非 system 消息）——LLM 摘要与统计都用它。 */
  dropped: AgentMessage[];
  /** 提取式保底摘要；LLM 失败时就用它。 */
  extractiveDigest: string;
  /** 状态头 + 重读指针（不含摘要正文）。 */
  frame: string;
  migrated: CarryoverMigratedState;
  stats: {
    droppedMessageCount: number;
    extractiveDigestChars: number;
    frameChars: number;
    charCap: number;
  };
};

function isLawyerDialogue(msg: AgentMessage): boolean {
  return msg.role === "user" || msg.role === "assistant";
}

function dialogueOf(session: AgentSession): AgentMessage[] {
  return session.conversationHistory.filter(
    (msg) => msg.role !== "system" && isLawyerDialogue(msg),
  );
}

/** 阻塞续接的在办动作：这些都是活的授权或活的状态，跨会话搬会断审计链。 */
const BLOCKING_ACTION_KINDS: ReadonlySet<string> = new Set([
  "tool_approval",
  "matter_approval",
  "judgment_escalation",
  "workflow_blocked",
  "continue_tools",
]);

export function blockingActionsForFork(
  actions: readonly LawMindRequiresAction[] | undefined,
): string[] {
  return (actions ?? [])
    .map((action) => action.kind)
    .filter((kind) => BLOCKING_ACTION_KINDS.has(kind));
}

/**
 * 状态头：能不能接着办，全看这一段。刻意手写（不调 `buildPostCompactSystemNote`）：
 * 那边是压缩场景的固定几行，这里还要同步清单、已确认答案、绑定办件与源会话指针。
 */
function buildCarryoverFrame(opts: {
  session: AgentSession;
  workspaceDir: string;
  linkedTaskId?: string;
  migrated: CarryoverMigratedState;
}): string {
  const { session, workspaceDir, migrated } = opts;
  const lines: string[] = [
    `${CARRYOVER_SEED_MARKER}律师从上一段对话另起了新会话，以下为**续接事实**（不是新指令）。`,
    "",
    "## 一、状态头",
  ];
  lines.push(`- 源会话: ${session.sessionId}`);
  if (migrated.matterId) {
    lines.push(`- matterId: ${migrated.matterId}`);
  }
  const linkedTaskId = migrated.linkedTaskId ?? opts.linkedTaskId;
  if (linkedTaskId) {
    lines.push(`- linkedTaskId: ${linkedTaskId}`);
  }
  if (migrated.lastBoundCapabilityId) {
    lines.push(`- 已绑定办件: ${migrated.lastBoundCapabilityId}`);
  }
  if (migrated.pendingClarificationKeys?.length) {
    lines.push(
      `- 待澄清键（仍生效，未答齐前不得起草/渲染）: ${migrated.pendingClarificationKeys.join(", ")}`,
    );
  }
  const confirmed = Object.entries(migrated.lastConfirmedAnswers ?? {});
  if (confirmed.length > 0) {
    lines.push(`- 律师已确认的澄清答案: ${confirmed.map(([k, v]) => `${k}=${v}`).join("；")}`);
  }
  if (migrated.turnPlan?.items?.length) {
    const open = migrated.turnPlan.items.filter((i) => i.status !== "completed");
    if (open.length > 0) {
      lines.push(
        `- 上一段未完成的清单: ${open.map((i) => `${i.status === "in_progress" ? "进行中" : "待办"} ${i.step}`).join("；")}`,
      );
    }
  }
  lines.push(
    "- 交付物验收与 render 门禁仍遵守当前草稿 acceptance 状态；未批准不得 send_email / 危险工具。",
  );

  const attachments = collectCompactAttachmentNotes(workspaceDir, {
    matterId: migrated.matterId,
    linkedTaskId,
    pendingClarificationKeys: migrated.pendingClarificationKeys,
  });
  if (attachments.length > 0) {
    lines.push("", ...attachments.map((block) => `${block}\n`));
  }
  return lines.join("\n");
}

/** 重读指针：不搬正文，要原文就自己用工具再读（与「整块取舍 + 溢出指针」同一取向）。 */
function buildCarryoverPointers(opts: {
  session: AgentSession;
  workspaceDir: string;
  migrated: CarryoverMigratedState;
}): string {
  const lines: string[] = ["## 三、重读指针（需要原文时用工具再读，不要凭摘要引用）"];
  const matterId = opts.migrated.matterId;
  if (matterId) {
    lines.push(`- 案件档案: \`cases/${matterId}/CASE.md\``);
    lines.push(`- 本案材料目录: \`cases/${matterId}/materials/\``);
    if (readSessionSummary(opts.workspaceDir, matterId)) {
      lines.push(`- 案件会话摘要: \`cases/${matterId}/session-summary.md\``);
    }
  }
  if (opts.migrated.linkedTaskId) {
    lines.push(`- 关联草稿: taskId \`${opts.migrated.linkedTaskId}\`（在办可见）`);
  }
  lines.push(`- 源会话存档（只读追溯）: \`sessions/${opts.session.sessionId}.json\``);
  lines.push("- `.env` / 密钥 / 工作区外路径一律不在此列，需要时按既有授权流程取得。");
  return lines.join("\n");
}

/**
 * 组装续接草稿（**不做 LLM 调用**，纯本地、幂等、可测）。
 * 摘要正文单独返回，便于调用方决定是否用模型再润一次。
 */
export function buildCarryoverDraft(opts: {
  session: AgentSession;
  workspaceDir: string;
  contextTokens?: number;
  linkedTaskId?: string;
  charCap?: number;
}): CarryoverDraft {
  const { session, workspaceDir } = opts;
  const charCap = opts.charCap ?? resolveCarryoverSeedCharCap(opts.contextTokens);
  const dropped = session.conversationHistory.filter((msg) => msg.role !== "system");
  const linkedTaskId = opts.linkedTaskId ?? session.pendingRequiresAction?.[0]?.taskId;
  const migrated: CarryoverMigratedState = {
    ...(session.matterId ? { matterId: session.matterId } : {}),
    ...(typeof linkedTaskId === "string" && linkedTaskId.trim()
      ? { linkedTaskId: linkedTaskId.trim() }
      : {}),
    ...(session.pendingClarificationKeys?.length
      ? { pendingClarificationKeys: [...session.pendingClarificationKeys] }
      : {}),
    ...(session.lastConfirmedAnswers && Object.keys(session.lastConfirmedAnswers).length > 0
      ? { lastConfirmedAnswers: { ...session.lastConfirmedAnswers } }
      : {}),
    ...(session.turnPlan ? { turnPlan: session.turnPlan } : {}),
    ...(session.lastBoundCapabilityId
      ? { lastBoundCapabilityId: session.lastBoundCapabilityId }
      : {}),
    ...(session.disclosedToolNames?.length
      ? { disclosedToolNames: [...session.disclosedToolNames] }
      : {}),
  };

  // 摘要额度：整体字符帽里给正文留大头，其余给状态头与指针。
  const digestCap = Math.max(1_000, Math.floor(charCap * 0.6));
  const frameCap = Math.max(500, charCap - digestCap);
  const dialogue = dialogueOf(session);
  const extractiveDigest = buildDroppedSpanDigest(dialogue, digestCap);
  const frameFull = [
    buildCarryoverFrame({ session, workspaceDir, linkedTaskId, migrated }),
    buildCarryoverPointers({ session, workspaceDir, migrated }),
  ].join("\n\n");
  const frame =
    frameFull.length > frameCap
      ? `${frameFull.slice(0, Math.max(0, frameCap - 12))}\n…[指针截断]`
      : frameFull;

  return {
    sourceSessionId: session.sessionId,
    dropped,
    extractiveDigest,
    frame,
    migrated,
    stats: {
      droppedMessageCount: dropped.length,
      extractiveDigestChars: extractiveDigest.length,
      frameChars: frame.length,
      charCap,
    },
  };
}

/** 把草稿 + 摘要正文渲染成模型可见的合成消息（律师气泡看不到）。 */
export function composeCarryoverMessages(draft: CarryoverDraft, digest: string): AgentMessage[] {
  const timestamp = new Date().toISOString();
  const digestText = digest.trim() || draft.extractiveDigest.trim();
  const body = digestText
    ? `${draft.frame}\n\n## 二、对话蒸馏\n${digestText}`
    : `${draft.frame}\n\n## 二、对话蒸馏\n（源会话没有可提取的对话要点；请用上面的指针读原文。）`;
  return [
    {
      role: "user",
      content: body.slice(0, draft.stats.charCap),
      timestamp,
      hiddenFromLawyer: true,
    },
  ];
}

export type ForkBlockedCode = "source_not_found" | "turn_live" | "pending_authorization";

export type ForkWithCarryoverResult =
  | {
      ok: true;
      session: AgentSession;
      reused: boolean;
      digestSource: "llm" | "extractive" | "none";
      migrated: CarryoverMigratedState;
      stats: { droppedMessageCount: number; digestChars: number; seedChars: number };
    }
  | {
      ok: false;
      code: ForkBlockedCode;
      message: string;
      blockingActions?: string[];
    };

/** 拒绝分叉：记一条可对账的 fork_blocked（原因进 meta.code），再原样返回。 */
function blockFork(code: ForkBlockedCode): ForkWithCarryoverResult {
  return { ok: false, code, message: BLOCKED_MESSAGES[code] };
}

const BLOCKED_MESSAGES: Record<ForkBlockedCode, string> = {
  source_not_found: "找不到要续接的对话。",
  turn_live: "当前对话还在办理中，先停稳再另起新对话（避免读到半轮历史）。",
  pending_authorization:
    "当前对话有未处理的批准 / 升级 / 工作流结论，须先在原对话处理完再另起新对话（授权不能跨会话搬）。",
};

/**
 * 另起新对话并带上文。
 *
 * 幂等：带 `clientNonce` 且与源会话 `forkedTo.nonce` 命中时，直接返回上一次的结果（不造第二份）；
 * 目标会话已被删除时视为未续接，重新创建。源会话读不到、回合在跑、有待批准授权时返回 409 语义。
 */
export async function forkSessionWithCarryover(opts: {
  workspaceDir: string;
  sourceSessionId: string;
  title?: string;
  clientNonce?: string;
  contextTokens?: number;
  linkedTaskId?: string;
  /** 可选 LLM 摘要；抛错或返回空则回落提取式（fork 必须永远成功）。 */
  enhanceDigest?: (input: {
    draft: CarryoverDraft;
  }) => Promise<string | undefined> | string | undefined;
}): Promise<ForkWithCarryoverResult> {
  const source = loadSession(opts.workspaceDir, opts.sourceSessionId);
  if (!source) {
    return blockFork("source_not_found");
  }

  const nonce = opts.clientNonce?.trim();
  const existing = source.forkedTo;
  if (existing && nonce && existing.nonce === nonce) {
    const target = loadSession(opts.workspaceDir, existing.sessionId);
    if (target) {
      return {
        ok: true,
        session: target,
        reused: true,
        digestSource: existing.digestSource ?? "extractive",
        migrated: readCarryoverState(target),
        stats: {
          droppedMessageCount: existing.droppedMessageCount ?? 0,
          digestChars: existing.digestChars ?? 0,
          seedChars: 0,
        },
      };
    }
  }

  if (
    isSessionTurnLive(opts.workspaceDir, source.sessionId) ||
    source.turns.some((turn) => turn.status === "running")
  ) {
    return blockFork("turn_live");
  }
  const blocking = blockingActionsForFork(source.pendingRequiresAction);
  if (blocking.length > 0) {
    recordContextPressure(opts.workspaceDir, "fork_blocked", {
      ...(source.matterId ? { matterId: source.matterId } : {}),
      sessionId: source.sessionId,
      meta: { code: "pending_authorization", blocking: blocking.join(",") },
    });
    return {
      ok: false,
      code: "pending_authorization",
      message: BLOCKED_MESSAGES.pending_authorization,
      blockingActions: blocking,
    };
  }

  const draft = buildCarryoverDraft({
    session: source,
    workspaceDir: opts.workspaceDir,
    contextTokens: opts.contextTokens,
    linkedTaskId: opts.linkedTaskId,
  });

  let digest = draft.extractiveDigest;
  let digestSource: "llm" | "extractive" | "none" = digest ? "extractive" : "none";
  if (opts.enhanceDigest && digest.trim()) {
    try {
      const enhanced = (await opts.enhanceDigest({ draft }))?.trim();
      if (enhanced && enhanced.length > 0) {
        digest = enhanced;
        digestSource = "llm";
      }
    } catch {
      /* 保留提取式：fork 不允许因为摘要失败而失败 */
    }
  }

  const title = forkTitle(source, opts.title);
  const target = createSession({
    workspaceDir: opts.workspaceDir,
    matterId: draft.migrated.matterId,
    actorId: source.actorId,
    assistantId: source.assistantId,
    title,
  });

  const seedMessages = composeCarryoverMessages(draft, digest);
  target.conversationHistory = seedMessages;
  // ── 闸门状态迁移：丢了就是静默放开起草硬门禁 / 让工具表回退。
  if (draft.migrated.pendingClarificationKeys?.length) {
    target.pendingClarificationKeys = [...draft.migrated.pendingClarificationKeys];
  }
  if (draft.migrated.lastConfirmedAnswers) {
    target.lastConfirmedAnswers = { ...draft.migrated.lastConfirmedAnswers };
  }
  if (draft.migrated.turnPlan) {
    target.turnPlan = draft.migrated.turnPlan;
  }
  if (draft.migrated.lastBoundCapabilityId) {
    target.lastBoundCapabilityId = draft.migrated.lastBoundCapabilityId;
  }
  if (draft.migrated.disclosedToolNames?.length) {
    target.disclosedToolNames = [...draft.migrated.disclosedToolNames];
  }
  const seedChars = seedMessages.reduce((n, m) => n + (m.content?.length ?? 0), 0);
  target.carriedOverFrom = {
    sessionId: source.sessionId,
    at: new Date().toISOString(),
    ...(source.title ? { title: source.title } : {}),
    digestSource,
    digestChars: digest.length,
    droppedMessageCount: draft.stats.droppedMessageCount,
    seedChars,
    digestPreview: digest.slice(0, CARRYOVER_DIGEST_PREVIEW_CHARS),
  };
  saveSession(opts.workspaceDir, target);

  source.forkedTo = {
    sessionId: target.sessionId,
    at: new Date().toISOString(),
    ...(title ? { title } : {}),
    ...(nonce ? { nonce } : {}),
    digestSource,
    digestChars: digest.length,
    droppedMessageCount: draft.stats.droppedMessageCount,
  };
  saveSession(opts.workspaceDir, source);

  try {
    await emit(`${opts.workspaceDir}/audit`, {
      kind: "session.forked_with_carryover",
      actor: "lawyer",
      // 会话级事件没有 task；用源会话 id 作审计主键，明细里带 from/to 便于对账。
      taskId: source.sessionId,
      ...(draft.migrated.matterId ? { matterId: draft.migrated.matterId } : {}),
      detail: JSON.stringify({
        from: source.sessionId,
        to: target.sessionId,
        digestSource,
        digestChars: digest.length,
        droppedMessageCount: draft.stats.droppedMessageCount,
        seedChars,
        migrated: Object.keys(draft.migrated),
      }),
    });
  } catch {
    /* 审计失败不阻塞律师已经拿到的结果 */
  }

  recordContextPressure(opts.workspaceDir, "fork_created", {
    ...(draft.migrated.matterId ? { matterId: draft.migrated.matterId } : {}),
    sessionId: source.sessionId,
    meta: {
      to: target.sessionId,
      digestSource,
      droppedMessageCount: draft.stats.droppedMessageCount,
      seedChars,
      migratedKeys: Object.keys(draft.migrated).length,
      reused: false,
    },
  });
  return {
    ok: true,
    session: target,
    reused: false,
    digestSource,
    migrated: draft.migrated,
    stats: {
      droppedMessageCount: draft.stats.droppedMessageCount,
      digestChars: digest.length,
      seedChars,
    },
  };
}

function readCarryoverState(session: AgentSession): CarryoverMigratedState {
  return {
    ...(session.matterId ? { matterId: session.matterId } : {}),
    ...(session.pendingClarificationKeys?.length
      ? { pendingClarificationKeys: [...session.pendingClarificationKeys] }
      : {}),
    ...(session.lastConfirmedAnswers && Object.keys(session.lastConfirmedAnswers).length > 0
      ? { lastConfirmedAnswers: { ...session.lastConfirmedAnswers } }
      : {}),
    ...(session.turnPlan ? { turnPlan: session.turnPlan } : {}),
    ...(session.lastBoundCapabilityId
      ? { lastBoundCapabilityId: session.lastBoundCapabilityId }
      : {}),
    ...(session.disclosedToolNames?.length
      ? { disclosedToolNames: [...session.disclosedToolNames] }
      : {}),
  };
}

/** 标题：带「（承前）」后缀便于侧栏区分，源标题已含则不重复。 */
export function forkTitle(source: AgentSession, requested?: string): string {
  const base = requested?.trim() || source.title?.trim() || "新对话";
  if (base.includes("承前")) {
    return base;
  }
  return `${base}（承前）`.slice(0, 200);
}
