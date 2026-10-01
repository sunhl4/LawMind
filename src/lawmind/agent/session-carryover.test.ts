import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readAllAuditLogs } from "../audit/index.js";
import { isCompactSyntheticUserMessage } from "./compact-insert.js";
import { resolveContextTuning } from "./context-tuning.js";
import { beginLiveTurnProgress, resetLiveTurnProgressStore } from "./live-turn-progress.js";
import {
  blockingActionsForFork,
  buildCarryoverDraft,
  CARRYOVER_SEED_MARKER,
  composeCarryoverMessages,
  forkSessionWithCarryover,
  forkTitle,
  resolveCarryoverSeedCharCap,
} from "./session-carryover.js";
import { createSession, loadSession, saveSession } from "./session.js";
import type { AgentMessage, AgentSession } from "./types.js";

const tempDirs: string[] = [];

afterEach(() => {
  resetLiveTurnProgressStore();
  for (const dir of tempDirs.splice(0)) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  }
});

function workspace(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-carryover-"));
  tempDirs.push(dir);
  fs.writeFileSync(path.join(dir, "MEMORY.md"), "# 通用记忆\n", "utf8");
  return dir;
}

/** 一段有实质内容的源会话：法条引用 + 律师要求 + 未完成清单 + 待澄清键。 */
function seedSourceSession(ws: string, opts?: { matterId?: string }): AgentSession {
  const session = createSession({
    workspaceDir: ws,
    matterId: opts?.matterId ?? "m-承前",
    actorId: "lawyer",
    assistantId: "default",
  });
  const now = new Date().toISOString();
  const history: AgentMessage[] = [
    { role: "system", content: "sys", timestamp: now },
    {
      role: "user",
      content: "帮我把竞业限制解除条款与三方义务分配写出来，落到 Word 稿。",
      timestamp: now,
    },
    { role: "assistant", content: "先读合同与检索法条。", timestamp: now },
    {
      role: "assistant",
      content: "",
      timestamp: now,
      toolCalls: [{ id: "c1", name: "search_statute", arguments: { q: "竞业限制" } }],
    },
    {
      role: "tool",
      content: JSON.stringify({ ok: true, data: { hits: ["《劳动合同法》第23条"] } }),
      timestamp: now,
      toolCallResponses: [
        {
          toolCallId: "c1",
          name: "search_statute",
          result: { ok: true, data: { hits: ["《劳动合同法》第23条"] } },
        },
      ],
    },
    {
      role: "assistant",
      content: "已定位《劳动合同法》第23条，接着起草解除条款。",
      timestamp: now,
    },
  ];
  session.conversationHistory = history;
  session.pendingClarificationKeys = ["竞业限制补偿标准"];
  session.lastConfirmedAnswers = { 己方立场: "委托方" };
  session.turnPlan = {
    items: [
      { step: "读竞业限制条款", status: "completed" },
      { step: "写解除条款", status: "in_progress" },
      { step: "分配三方义务", status: "pending" },
    ],
    updatedAt: now,
  };
  session.lastBoundCapabilityId = "contract.review";
  session.disclosedToolNames = ["apply_surgical_edits"];
  saveSession(ws, session);
  return session;
}

describe("forkTitle", () => {
  it("保留源标题并加「承前」后缀，不重复叠加", () => {
    const base = { title: "竞业限制解除" } as AgentSession;
    expect(forkTitle(base)).toBe("竞业限制解除（承前）");
    expect(forkTitle(base, "自定义标题")).toBe("自定义标题（承前）");
    expect(forkTitle({ title: "已（承前）" } as AgentSession)).toBe("已（承前）");
  });
});

describe("blockingActionsForFork", () => {
  it("授权 / 升级 / 工作流 / 检查点一律阻塞，澄清不阻塞（它走迁移）", () => {
    expect(
      blockingActionsForFork([
        { kind: "tool_approval" },
        { kind: "clarification" },
        { kind: "continue_tools" },
        { kind: "judgment_escalation" },
        { kind: "matter_approval" },
        { kind: "workflow_blocked" },
      ] as never),
    ).toEqual([
      "tool_approval",
      "continue_tools",
      "judgment_escalation",
      "matter_approval",
      "workflow_blocked",
    ]);
    expect(blockingActionsForFork([{ kind: "clarification" }] as never)).toEqual([]);
    expect(blockingActionsForFork(undefined)).toEqual([]);
  });
});

describe("buildCarryoverDraft", () => {
  it("状态头带待澄清键 / 已确认答案 / 未完成清单，蒸馏保法条锚点，指针给重读路径", () => {
    const ws = workspace();
    const session = seedSourceSession(ws);

    const draft = buildCarryoverDraft({ session, workspaceDir: ws });

    expect(draft.migrated.matterId).toBe("m-承前");
    expect(draft.migrated.pendingClarificationKeys).toEqual(["竞业限制补偿标准"]);
    expect(draft.migrated.lastConfirmedAnswers).toEqual({ 己方立场: "委托方" });
    expect(draft.migrated.lastBoundCapabilityId).toBe("contract.review");
    expect(draft.migrated.disclosedToolNames).toEqual(["apply_surgical_edits"]);

    expect(draft.frame).toContain(CARRYOVER_SEED_MARKER);
    expect(draft.frame).toContain(
      "待澄清键（缺口标【待核实】进稿，不因此停写；律师可在修订里改或回一句补充）",
    );
    expect(draft.frame).toContain("竞业限制补偿标准");
    expect(draft.frame).toContain("己方立场=委托方");
    expect(draft.frame).toContain("进行中 写解除条款");
    expect(draft.frame).toContain("待办 分配三方义务");
    // 指针段：要原文就自己再读，不搬正文。
    expect(draft.frame).toContain("cases/m-承前/CASE.md");
    expect(draft.frame).toContain(`sessions/${session.sessionId}.json`);

    // 蒸馏保法条锚点（压缩同款能力）。
    expect(draft.extractiveDigest).toContain("《劳动合同法》第23条");
    expect(draft.stats.droppedMessageCount).toBeGreaterThan(0);
  });

  it("窗口越大种子额度越大，且 clamp 在 [8k, 32k]", () => {
    expect(resolveCarryoverSeedCharCap(16_000)).toBe(8_000);
    expect(resolveCarryoverSeedCharCap(128_000)).toBe(12_800);
    expect(resolveCarryoverSeedCharCap(1_000_000)).toBe(32_000);
    expect(resolveCarryoverSeedCharCap(undefined)).toBe(12_800);
  });

  it("种子额度可由 policy 调（比例 / 上下界）", () => {
    const tuning = resolveContextTuning({
      schemaVersion: 1,
      context: { carryover: { seedCharRatio: 0.2, seedMinChars: 1_000, seedMaxChars: 10_000 } },
    });
    expect(resolveCarryoverSeedCharCap(128_000, tuning)).toBe(10_000);
    expect(resolveCarryoverSeedCharCap(16_000, tuning)).toBe(3_200);
    expect(resolveCarryoverSeedCharCap(1_000, tuning)).toBe(1_000);
    // 默认不变。
    expect(resolveCarryoverSeedCharCap(128_000)).toBe(12_800);
  });

  it("骨架超长时按额度截断，不无界膨胀", () => {
    const ws = workspace();
    const session = seedSourceSession(ws);
    session.pendingClarificationKeys = Array.from({ length: 200 }, (_, i) => `键${i}`);
    saveSession(ws, session);

    const draft = buildCarryoverDraft({ session, workspaceDir: ws, charCap: 2_000 });
    expect(draft.frame.length).toBeLessThanOrEqual(2_000);
    expect(draft.stats.frameChars).toBe(draft.frame.length);
  });
});

describe("composeCarryoverMessages", () => {
  it("合成 user 消息、标记为律师不可见、被压缩识别为合成消息", () => {
    const ws = workspace();
    const session = seedSourceSession(ws);
    const draft = buildCarryoverDraft({ session, workspaceDir: ws });

    const messages = composeCarryoverMessages(draft, "【压缩前对话蒸馏】摘要：已写到解除条款。");
    expect(messages).toHaveLength(1);
    expect(messages[0]?.role).toBe("user");
    expect(messages[0]?.hiddenFromLawyer).toBe(true);
    expect(messages[0]?.content).toContain("摘要：已写到解除条款。");
    // 合成消息：不被当成律师真实提问（压缩整条丢弃、红线重注插在真问题前）。
    expect(isCompactSyntheticUserMessage(messages[0]?.content ?? "")).toBe(true);
  });

  it("没有摘要时也给出诚实的「用指针读原文」", () => {
    const ws = workspace();
    const session = createSession({ workspaceDir: ws, actorId: "lawyer" });
    saveSession(ws, session);
    const draft = buildCarryoverDraft({ session, workspaceDir: ws });
    const messages = composeCarryoverMessages(draft, "");
    expect(messages[0]?.content).toContain("源会话没有可提取的对话要点");
  });
});

describe("forkSessionWithCarryover", () => {
  it("新会话带状态头 + 迁移闸门状态 + 双向指针，源会话冻结为 forkedTo", async () => {
    const ws = workspace();
    const source = seedSourceSession(ws);

    const result = await forkSessionWithCarryover({
      workspaceDir: ws,
      sourceSessionId: source.sessionId,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    const target = result.session;
    expect(target.sessionId).not.toBe(source.sessionId);
    expect(target.matterId).toBe("m-承前");
    expect(target.assistantId).toBe("default");
    expect(target.title).toBe("竞业限制解除（承前）".replace("竞业限制解除", source.title!));
    // 闸门状态迁移：丢了就是静默放开起草硬门禁。
    expect(target.pendingClarificationKeys).toEqual(["竞业限制补偿标准"]);
    expect(target.lastConfirmedAnswers).toEqual({ 己方立场: "委托方" });
    expect(target.turnPlan?.items).toHaveLength(3);
    expect(target.lastBoundCapabilityId).toBe("contract.review");
    expect(target.disclosedToolNames).toEqual(["apply_surgical_edits"]);
    // 种子进历史且不进律师气泡。
    expect(target.conversationHistory).toHaveLength(1);
    expect(target.carriedOverFrom?.sessionId).toBe(source.sessionId);
    expect(target.carriedOverFrom?.digestChars).toBeGreaterThan(0);
    expect(target.carriedOverFrom?.digestPreview?.length).toBeLessThanOrEqual(400);

    const reloadedSource = loadSession(ws, source.sessionId)!;
    expect(reloadedSource.forkedTo?.sessionId).toBe(target.sessionId);
    expect(reloadedSource.forkedTo?.digestSource).toBe("extractive");
  });

  it("LLM 摘要可用时替换提取式，并记账 digestSource=llm", async () => {
    const ws = workspace();
    const source = seedSourceSession(ws);
    const enhance = vi
      .fn()
      .mockResolvedValue("【压缩前对话蒸馏】摘要：律师要解除条款，已定位第23条。");

    const result = await forkSessionWithCarryover({
      workspaceDir: ws,
      sourceSessionId: source.sessionId,
      enhanceDigest: enhance,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.digestSource).toBe("llm");
    expect(result.session.conversationHistory[0]?.content).toContain("摘要：律师要解除条款");
    expect(enhance).toHaveBeenCalledTimes(1);
  });

  it("LLM 摘要失败时回落提取式：fork 必须永远成功", async () => {
    const ws = workspace();
    const source = seedSourceSession(ws);
    const result = await forkSessionWithCarryover({
      workspaceDir: ws,
      sourceSessionId: source.sessionId,
      enhanceDigest: () => {
        throw new Error("model down");
      },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.digestSource).toBe("extractive");
    expect(result.session.conversationHistory[0]?.content).toContain("《劳动合同法》第23条");
  });

  it("同一 nonce 复用一个新会话（不造第二份）", async () => {
    const ws = workspace();
    const source = seedSourceSession(ws);
    const first = await forkSessionWithCarryover({
      workspaceDir: ws,
      sourceSessionId: source.sessionId,
      clientNonce: "n-1",
    });
    const second = await forkSessionWithCarryover({
      workspaceDir: ws,
      sourceSessionId: source.sessionId,
      clientNonce: "n-1",
    });
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) {
      return;
    }
    expect(second.reused).toBe(true);
    expect(second.session.sessionId).toBe(first.session.sessionId);
    expect(
      fs.readdirSync(path.join(ws, "sessions")).filter((n) => n.endsWith(".json")),
    ).toHaveLength(2);
  });

  it("目标会话已被删除时视为未续接，重新创建", async () => {
    const ws = workspace();
    const source = seedSourceSession(ws);
    const first = await forkSessionWithCarryover({
      workspaceDir: ws,
      sourceSessionId: source.sessionId,
      clientNonce: "n-1",
    });
    expect(first.ok).toBe(true);
    if (!first.ok) {
      return;
    }
    fs.rmSync(path.join(ws, "sessions", `${first.session.sessionId}.json`));

    const second = await forkSessionWithCarryover({
      workspaceDir: ws,
      sourceSessionId: source.sessionId,
      clientNonce: "n-1",
    });
    expect(second.ok).toBe(true);
    if (!second.ok) {
      return;
    }
    expect(second.reused).toBe(false);
    expect(second.session.sessionId).not.toBe(first.session.sessionId);
  });

  it("回合在跑 / 有待批准授权时拒绝，且不产生新会话", async () => {
    const ws = workspace();
    const source = seedSourceSession(ws);

    beginLiveTurnProgress(source.sessionId);
    const live = await forkSessionWithCarryover({
      workspaceDir: ws,
      sourceSessionId: source.sessionId,
    });
    expect(live).toEqual({
      ok: false,
      code: "turn_live",
      message: expect.any(String),
    });
    resetLiveTurnProgressStore();

    source.pendingRequiresAction = [
      { kind: "tool_approval", taskId: "t1" },
      { kind: "clarification" },
    ] as never;
    saveSession(ws, source);
    const blocked = await forkSessionWithCarryover({
      workspaceDir: ws,
      sourceSessionId: source.sessionId,
    });
    expect(blocked.ok).toBe(false);
    if (blocked.ok) {
      return;
    }
    expect(blocked.code).toBe("pending_authorization");
    expect(blocked.blockingActions).toEqual(["tool_approval"]);

    expect(
      fs.readdirSync(path.join(ws, "sessions")).filter((n) => n.endsWith(".json")),
    ).toHaveLength(1);
  });

  it("源会话不存在时如实报错", async () => {
    const ws = workspace();
    const result = await forkSessionWithCarryover({
      workspaceDir: ws,
      sourceSessionId: "s-missing",
    });
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.code).toBe("source_not_found");
  });

  it("落审计：from/to、摘要来源、迁移了哪些闸门", async () => {
    const ws = workspace();
    const source = seedSourceSession(ws);
    const result = await forkSessionWithCarryover({
      workspaceDir: ws,
      sourceSessionId: source.sessionId,
    });
    expect(result.ok).toBe(true);
    const events = await readAllAuditLogs(path.join(ws, "audit"));
    const forked = events.find((e) => e.kind === "session.forked_with_carryover");
    expect(forked).toBeTruthy();
    const detail = JSON.parse(forked!.detail ?? "{}") as {
      from?: string;
      to?: string;
      migrated?: string[];
    };
    expect(detail.from).toBe(source.sessionId);
    expect(detail.migrated).toContain("pendingClarificationKeys");
    expect(detail.migrated).toContain("lastConfirmedAnswers");
  });
});
