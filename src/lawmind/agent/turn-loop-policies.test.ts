import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { SameTurnVerifyTurnState } from "../runtime/same-turn-verify.js";
import {
  COMPLETION_POLICIES,
  TOOL_ROUND_POLICIES,
  resolveToolBudgetStop,
  runCompletionPolicies,
  runToolRoundPolicies,
  type CompletionFacts,
  type ToolRoundFacts,
} from "./turn-loop-policies.js";
import { createLoopFlags, stopReasonBucket } from "./turn-loop-state.js";
import {
  resolveTurnProfile,
  hasTrackedWordArtifact,
  toolResultWroteTrackedArtifact,
  type TurnCoachId,
} from "./turn-profile.js";
import type { AgentMessage, AgentTurn } from "./types.js";

const tempDirs: string[] = [];

function emptyWorkspace(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-policy-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  }
});

function profileWith(coaches: TurnCoachId[], requiresTrackedDraft = false) {
  return {
    id: "general" as const,
    coaches: new Set(coaches),
    requiresTrackedDraft,
    locksSearchAfterSynthesis: false,
  };
}

function toolFacts(overrides: Partial<ToolRoundFacts> = {}): ToolRoundFacts {
  return {
    instruction: "整理材料",
    workspaceDir: emptyWorkspace(),
    profile: profileWith([
      "write_synthesis",
      "calculate_params",
      "forbidden_shell",
      "identical_repeat",
    ]),
    flags: createLoopFlags(),
    wordRevision: false,
    roundIndex: 2,
    toolRefs: [],
    advertisedToolNames: [],
    toolNameCallCounts: {},
    messages: [],
    turnMessages: [],
    emit: () => undefined,
    ...overrides,
  };
}

function toolMessage(errors: string[]): AgentMessage {
  return {
    role: "tool",
    content: "",
    timestamp: "t",
    toolCallResponses: errors.map((error, index) => ({
      toolCallId: String(index),
      name: "run_host_command",
      result: { ok: false, error },
    })),
  };
}

function readMessage(callId: string, totalChars = 1200): AgentMessage {
  return {
    role: "tool",
    content: "",
    timestamp: "t",
    toolCallResponses: [
      {
        toolCallId: callId,
        name: "analyze_document",
        result: { ok: true, data: { hasMore: false, totalChars } },
      },
    ],
  };
}

function turn(overrides: Partial<AgentTurn> = {}): AgentTurn {
  return {
    turnId: "turn-1",
    sessionId: "session-1",
    instruction: "整理材料",
    messages: [],
    toolCallsExecuted: 0,
    status: "running",
    startedAt: "t",
    ...overrides,
  };
}

function completionFacts(overrides: Partial<CompletionFacts> = {}): CompletionFacts {
  return {
    instruction: "整理材料",
    workspaceDir: emptyWorkspace(),
    profile: profileWith([
      "write_synthesis",
      "calculate_params",
      "forbidden_shell",
      "identical_repeat",
      "missing_deliverables",
      "review_board_export",
      "steer",
    ]),
    flags: createLoopFlags(),
    turn: turn(),
    session: {
      sessionId: "session-1",
      conversationHistory: [],
      turns: [],
      createdAt: "t",
      updatedAt: "t",
    },
    assistantText: "材料已整理。",
    roundIndex: 2,
    wordRevision: false,
    pendingClarificationQuestions: [],
    deferralBounceMax: () => 2,
    emit: () => undefined,
    hideAssistantMessage: () => undefined,
    recordPressure: () => undefined,
    hasPendingSteer: () => false,
    ...overrides,
  };
}

function verifyState(bounceCount: number): SameTurnVerifyTurnState {
  return {
    red: true,
    bounceCount,
    issues: [
      {
        code: "lint_mechanical",
        gate: "acceptance_gate",
        message: "机械核对未过",
        nextTool: "update_draft",
      },
    ],
  };
}

describe("turn profile", () => {
  it("Word revision declares the export coach and requires a tracked draft", () => {
    const profile = resolveTurnProfile({
      instruction: "修改合同",
      wordRevision: true,
      mailContract: false,
    });
    expect(profile.id).toBe("word_revision");
    expect(profile.requiresTrackedDraft).toBe(true);
    expect(profile.locksSearchAfterSynthesis).toBe(false);
  });

  it("Word revision + consult keeps the search lock (改这份只列追问)", () => {
    const profile = resolveTurnProfile({
      instruction: "修改这份合同.docx，只列出追问，不要给完整法律意见。",
      wordRevision: true,
      mailContract: false,
    });
    expect(profile.id).toBe("word_revision");
    expect(profile.locksSearchAfterSynthesis).toBe(true);
  });

  it("pleading / memo / consult frames add only their own section coach", () => {
    const pleading = resolveTurnProfile({
      instruction: "写入 民事起诉状.docx，起草起诉状。",
      wordRevision: false,
      mailContract: false,
    });
    expect(pleading.id).toBe("pleading");
    expect(pleading.coaches.has("pleading_sections")).toBe(true);
    expect(pleading.coaches.has("memo_sections")).toBe(false);

    const consult = resolveTurnProfile({
      instruction: "只列出追问，不要给完整法律意见。",
      wordRevision: false,
      mailContract: false,
    });
    expect(consult.coaches.has("consult_questions")).toBe(true);
  });

  it("mail contract stays a distinct profile and never requires a tracked draft", () => {
    const profile = resolveTurnProfile({
      instruction: "把这封邮件合同处理一下",
      wordRevision: false,
      mailContract: true,
    });
    expect(profile.id).toBe("mail_contract");
    expect(profile.requiresTrackedDraft).toBe(false);
  });
});

describe("tool-round policy table", () => {
  it("exposes the documented order (coaches first, then guards)", () => {
    expect(TOOL_ROUND_POLICIES.map((policy) => policy.id)).toEqual([
      "write-synthesis",
      "pleading-sections",
      "consult-questions",
      "memo-sections",
      "calculate-params",
      "forbidden-shell",
      "identical-repeat",
    ]);
  });

  it("runs every co-firing coach in one round (consult + memo), then re-samples once", () => {
    const dir = emptyWorkspace();
    fs.writeFileSync(path.join(dir, "追问清单-8.md"), "1. 第一个问题？\n2. 第二个问题？", "utf8");
    const facts = toolFacts({
      workspaceDir: dir,
      instruction: "本轮只列出追问。用 write_document 写入 追问清单-8.md。",
      profile: profileWith([
        "write_synthesis",
        "calculate_params",
        "forbidden_shell",
        "identical_repeat",
        "consult_questions",
        "memo_sections",
      ]),
      toolRefs: [{ id: "1", name: "search_statute", arguments: { query: "民法典" } }],
    });
    const action = runToolRoundPolicies(facts);
    expect(action?.kind).toBe("resample");
    if (action?.kind === "resample") {
      expect(action.messages).toHaveLength(2);
      expect(action.messages?.[0]).toContain("【追问清单】");
      expect(action.messages?.[1]).toContain("【备忘录结构】");
    }
    // Guard policies must not run while any coach fired (old `steeredToWrite` barrier).
    expect(facts.flags.identicalToolStreak).toBeNull();
  });

  it("write-synthesis fires once, then keeps search locked while the named file is missing", () => {
    const dir = emptyWorkspace();
    const facts = toolFacts({
      workspaceDir: dir,
      instruction: "查完法条后写入 note.md。",
      profile: profileWith(["write_synthesis", "identical_repeat"]),
      advertisedToolNames: ["search_statute", "write_document"],
      // No live statute hit in history → demo-only cap (8), not the live cap (4).
      toolNameCallCounts: { search_statute: 8 },
    });
    const first = runToolRoundPolicies(facts);
    expect(first?.kind).toBe("resample");
    expect(facts.flags.synthesisNudged).toBe(true);
    expect(facts.flags.synthesisSearchLocked).toBe(false);

    // Still missing after the coach round → search stays withheld.
    runToolRoundPolicies(facts);
    expect(facts.flags.synthesisSearchLocked).toBe(true);
  });

  it("calculate params stops after the failure cap and only nudges once", () => {
    const failures = Array.from({ length: 2 }, (_, index) => ({
      role: "tool" as const,
      content: "",
      timestamp: "t",
      toolCallResponses: [
        {
          toolCallId: String(index),
          name: "calculate",
          result: { ok: false, error: "calculate 参数必须包含 amount" },
        },
      ],
    }));
    const facts = toolFacts({ messages: failures });
    const action = runToolRoundPolicies(facts);
    expect(action?.kind).toBe("resample");
    if (action?.kind === "resample") {
      expect(action.messages?.[0]).toContain("【计算停手】");
    }
    expect(runToolRoundPolicies(facts)).toBeNull();
  });

  it("nudges once on a repeated batch, then stops with repeat_stop", () => {
    const facts = toolFacts({
      toolRefs: [{ id: "1", name: "search_statute", arguments: { query: "民法典" } }],
    });
    const calls: Array<ReturnType<typeof runToolRoundPolicies>> = [];
    for (let i = 0; i < 4; i += 1) {
      calls.push(runToolRoundPolicies(facts));
    }
    expect(calls[0]).toBeNull();
    expect(calls[1]).toBeNull();
    expect(calls[2]?.kind).toBe("resample");
    expect(calls[3]?.kind).toBe("stop");
    if (calls[3]?.kind === "stop") {
      expect(calls[3].reason).toBe("repeat_stop");
      expect(calls[3].reply).toContain("同样的查找做了好几次");
    }
  });

  it("stops a finished reread as reread_stop but gives Word revision one extra sample", () => {
    const messages = [readMessage("call-1")];
    const toolRefs = [
      { id: "call-1", name: "analyze_document", arguments: { file_path: "a.docx" } },
    ];
    const plain = toolFacts({ toolRefs, messages });
    expect(runToolRoundPolicies(plain)).toBeNull();
    expect(runToolRoundPolicies(plain)).toBeNull();
    const third = runToolRoundPolicies(plain);
    expect(third?.kind).toBe("resample");
    const fourth = runToolRoundPolicies(plain);
    expect(fourth?.kind).toBe("stop");
    if (fourth?.kind === "stop") {
      expect(fourth.reason).toBe("reread_stop");
      expect(fourth.reply).toContain("这份材料已经读完");
    }

    const wordRevision = toolFacts({ toolRefs, messages, wordRevision: true });
    runToolRoundPolicies(wordRevision);
    runToolRoundPolicies(wordRevision);
    runToolRoundPolicies(wordRevision);
    const extra = runToolRoundPolicies(wordRevision);
    expect(extra?.kind).toBe("resample");
    expect(wordRevision.flags.documentRereadContinued).toBe(true);
    const afterExtra = runToolRoundPolicies(wordRevision);
    expect(afterExtra?.kind).toBe("stop");
    if (afterExtra?.kind === "stop") {
      expect(afterExtra.reason).toBe("reread_stop");
    }
  });

  it("stops forbidden shell retries after the single nudge", () => {
    const facts = toolFacts({
      messages: [toolMessage(["不允许运行 bash。不要再试。", "不允许运行 sh。不要再试。"])],
    });
    const nudge = runToolRoundPolicies(facts);
    expect(nudge?.kind).toBe("resample");
    expect(facts.flags.forbiddenShellNudged).toBe(true);

    facts.messages = [
      toolMessage([
        "不允许运行 bash。不要再试。",
        "不允许运行 sh。不要再试。",
        "不允许运行 zsh。不要再试。",
        "不允许运行 dash。不要再试。",
      ]),
    ];
    const stop = runToolRoundPolicies(facts);
    expect(stop?.kind).toBe("stop");
    if (stop?.kind === "stop") {
      expect(stop.reason).toBe("forbidden_shell");
    }
  });
});

describe("completion policy table", () => {
  it("keeps an explicit order", () => {
    expect(COMPLETION_POLICIES.map((policy) => policy.id)).toEqual([
      "prose-syndrome",
      "clarification",
      "same-turn-verify",
      "context-deferral",
      "word-revision-export",
      "review-board-export",
      "missing-deliverables",
      "steer",
    ]);
  });

  it("delivers clarification gaps as a completed turn, not a pause", () => {
    const action = runCompletionPolicies(
      completionFacts({
        pendingClarificationQuestions: [{ key: "party", question: "甲方是谁？" }],
      }),
    );
    expect(action?.kind).toBe("stop");
    if (action?.kind === "stop") {
      expect(action.reason).toBe("clarification_delivered");
      expect(action.status).toBe("completed");
      expect(action.consumeClarificationQuestions).toBe(true);
    }
  });

  it("bounces a red verifier, then delivers with gaps at the cap", () => {
    const facts = completionFacts({ turn: turn({ sameTurnVerify: verifyState(0) }) });
    const bounce = runCompletionPolicies(facts);
    expect(bounce?.kind).toBe("resample");
    expect(facts.turn.sameTurnVerify?.bounceCount).toBe(1);

    const capped = completionFacts({ turn: turn({ sameTurnVerify: verifyState(3) }) });
    const action = runCompletionPolicies(capped);
    expect(action?.kind).toBe("stop");
    if (action?.kind === "stop") {
      expect(action.reason).toBe("verify_cap");
      expect(action.reply).toContain("本轮稿件已交付");
    }
  });

  it("bounces a context deferral, then hands off with facts at the cap", () => {
    const text = "本轮上下文预算已接近上限，建议另开一轮继续办理。";
    const facts = completionFacts({ assistantText: text });
    const bounce = runCompletionPolicies(facts);
    expect(bounce?.kind).toBe("resample");
    if (bounce?.kind === "resample") {
      expect(bounce.forceCompact).toBe(true);
      bounce.afterResamplePrep?.();
    }
    expect(facts.turn.contextDeferralBounces).toBe(1);

    const capped = completionFacts({
      assistantText: text,
      turn: turn({ contextDeferralBounces: 2, toolCallsExecuted: 7 }),
    });
    const action = runCompletionPolicies(capped);
    expect(action?.kind).toBe("stop");
    if (action?.kind === "stop") {
      expect(action.reason).toBe("deferral_handoff");
      expect(action.reply).toContain("7");
    }
  });

  it("re-samples when a steer arrived during the closing sentence", () => {
    const action = runCompletionPolicies(completionFacts({ hasPendingSteer: () => true }));
    expect(action).toEqual({ kind: "resample", applyMechanicalNote: true });
  });

  it("streams the closing segment once, after prose declines and before a bounce", () => {
    const seen: string[] = [];
    runCompletionPolicies(completionFacts(), {
      beforeBounce: () => seen.push("segment"),
    });
    expect(seen).toEqual(["segment"]);

    const bounced: string[] = [];
    runCompletionPolicies(completionFacts({ turn: turn({ sameTurnVerify: verifyState(0) }) }), {
      beforeBounce: () => bounced.push("segment"),
    });
    expect(bounced).toEqual(["segment"]);
  });

  it("re-samples once when a named deliverable is still missing, then delivers", () => {
    const dir = emptyWorkspace();
    const facts = completionFacts({
      workspaceDir: dir,
      instruction: "把结论写入 意见书.md。",
    });
    const action = runCompletionPolicies(facts);
    expect(action?.kind).toBe("resample");
    if (action?.kind === "resample") {
      expect(action.message).toContain("意见书.md");
    }
    expect(facts.flags.deliverableNudged).toBe(true);
    expect(runCompletionPolicies(facts)).toBeNull();
  });

  it("bounces a review-board export deferral only once", () => {
    const text = "请律师在审核台放行后，才能出 Word。";
    const facts = completionFacts({ assistantText: text });
    const action = runCompletionPolicies(facts);
    expect(action?.kind).toBe("resample");
    if (action?.kind === "resample") {
      expect(action.message).toContain("【交办即终稿·出 Word】");
    }
    expect(facts.flags.reviewBoardExportBounces).toBe(1);
    expect(runCompletionPolicies(facts)).toBeNull();
  });

  it("returns null when no policy applies (plain delivery)", () => {
    expect(runCompletionPolicies(completionFacts())).toBeNull();
  });
});

describe("tool budget hard stop", () => {
  it("returns null below the ceiling", () => {
    expect(
      resolveToolBudgetStop({
        used: 10,
        hard: 80,
        wordRevision: false,
        assistantText: "进行中",
        turn: turn(),
        roundIndex: 3,
        pendingClarificationQuestions: [],
        emit: () => undefined,
      }),
    ).toBeNull();
  });

  it("delivers the assistant text at the ceiling instead of asking the lawyer", () => {
    const stop = resolveToolBudgetStop({
      used: 80,
      hard: 80,
      wordRevision: false,
      assistantText: "已整理完三份材料。",
      turn: turn({ toolCallsExecuted: 80 }),
      roundIndex: 9,
      pendingClarificationQuestions: [],
      emit: () => undefined,
    });
    expect(stop).toEqual({
      status: "completed",
      reason: "tool_budget",
      reply: "已整理完三份材料。",
    });
  });

  it("hands red verifier gaps over with 【待核实】 rather than pausing", () => {
    const gaps: string[] = [];
    const stop = resolveToolBudgetStop({
      used: 80,
      hard: 80,
      wordRevision: false,
      assistantText: "稿子已改。",
      turn: turn({ sameTurnVerify: verifyState(3) }),
      roundIndex: 12,
      pendingClarificationQuestions: [],
      emit: (event) => {
        if (event.type === "verify_gap") {
          gaps.push(event.message);
        }
      },
    });
    expect(stop?.reason).toBe("tool_budget");
    expect(stop?.reply).toContain("本轮稿件已交付");
    expect(stop?.consumedClarificationQuestions).toBeUndefined();
    expect(gaps).toHaveLength(1);
  });

  it("keeps placeholder gaps on the turn when delivering at the ceiling", () => {
    const pending = [{ key: "party", question: "甲方是谁？" }];
    const budgetTurn = turn({ toolCallsExecuted: 80 });
    const stop = resolveToolBudgetStop({
      used: 80,
      hard: 80,
      wordRevision: false,
      assistantText: "草稿已生成。",
      turn: budgetTurn,
      roundIndex: 12,
      pendingClarificationQuestions: pending,
      emit: () => undefined,
    });
    expect(stop?.reply).toContain("步数已到上限");
    expect(stop?.consumedClarificationQuestions).toBe(true);
    expect(budgetTurn.clarificationQuestions).toEqual(pending);
  });

  it("Word revision only claims an export when the file was really written", () => {
    const notExported = resolveToolBudgetStop({
      used: 80,
      hard: 80,
      wordRevision: true,
      assistantText: "改好了。",
      turn: turn({ toolNameCallCounts: { apply_surgical_edits: 3 } }),
      roundIndex: 20,
      pendingClarificationQuestions: [],
      emit: () => undefined,
    });
    expect(notExported?.reply).toContain("有新修订的，写在原文件旁边");

    // 调了工具但没落文件（失败 / 无可改段落）：不能算已交付
    const failedCall = resolveToolBudgetStop({
      used: 80,
      hard: 80,
      wordRevision: true,
      assistantText: "改好了。",
      turn: turn({ toolNameCallCounts: { render_tracked_draft: 1 } }),
      roundIndex: 20,
      pendingClarificationQuestions: [],
      emit: () => undefined,
    });
    expect(failedCall?.reply).toContain("有新修订的，写在原文件旁边");

    const exported = resolveToolBudgetStop({
      used: 80,
      hard: 80,
      wordRevision: true,
      assistantText: "改好了，已写在原文件旁边。",
      turn: turn({
        toolNameCallCounts: { render_tracked_draft: 1 },
        trackedArtifactWritten: true,
      }),
      roundIndex: 20,
      pendingClarificationQuestions: [],
      emit: () => undefined,
    });
    expect(exported?.reply).toBe("改好了，已写在原文件旁边。");
  });

  it("counts a format-revision copy as the tracked artifact for the turn", () => {
    // 律师只要求统一格式：不走内容改稿，但带痕迹的稿子已经写出来了
    const formatOnly = resolveToolBudgetStop({
      used: 80,
      hard: 80,
      wordRevision: true,
      assistantText: "格式已统一，副本写在原文件旁边。",
      turn: turn({
        toolNameCallCounts: { fix_document_format: 1 },
        trackedArtifactWritten: true,
      }),
      roundIndex: 20,
      pendingClarificationQuestions: [],
      emit: () => undefined,
    });
    expect(formatOnly?.reply).toBe("格式已统一，副本写在原文件旁边。");

    // 只有成功且返回 outputPath 才算写到文件
    expect(
      toolResultWroteTrackedArtifact("fix_document_format", {
        ok: true,
        data: { outputPath: "回稿_格式修订.docx" },
      }),
    ).toBe(true);
    expect(
      toolResultWroteTrackedArtifact("fix_document_format", {
        ok: true,
        data: { appliedParagraphs: 0, warning: "没有可改的段落" },
      }),
    ).toBe(false);
    expect(toolResultWroteTrackedArtifact("fix_document_format", { ok: false })).toBe(false);
    expect(toolResultWroteTrackedArtifact("render_tracked_draft", { ok: true, data: {} })).toBe(
      false,
    );
    expect(hasTrackedWordArtifact({})).toBe(false);
  });
});

describe("stop reason buckets", () => {
  it("groups stop reasons for replay rollups", () => {
    expect(stopReasonBucket("delivered")).toBe("delivered");
    expect(stopReasonBucket("verify_cap")).toBe("needs_lawyer");
    expect(stopReasonBucket("gate_stop")).toBe("needs_lawyer");
    expect(stopReasonBucket("tool_budget")).toBe("budget");
    expect(stopReasonBucket("round_ceiling")).toBe("budget");
    expect(stopReasonBucket("repeat_stop")).toBe("loop_guard");
    expect(stopReasonBucket("model_error")).toBe("model_error");
    expect(stopReasonBucket("aborted")).toBe("aborted");
    expect(stopReasonBucket(undefined)).toBe("unknown");
  });
});
