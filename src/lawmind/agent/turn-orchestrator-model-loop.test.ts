import { describe, expect, it } from "vitest";
import {
  advanceIdenticalToolStreak,
  completedDocumentReread,
  formatDocumentRereadContinue,
  formatDocumentRereadNudge,
  formatIdenticalToolRepeatNudge,
  formatIdenticalToolRepeatStop,
  identicalToolRepeatDecision,
  lawyerRepeatKind,
  resolveStrictUpstreamToolStreaming,
  shouldContinueCompletedDocumentReread,
  shouldWarnToolBudget,
  toolCallBatchSignature,
} from "./turn-orchestrator-model-loop.js";
import type { AgentMessage } from "./types.js";

describe("shouldWarnToolBudget", () => {
  it("warns at 80% of max (ceil)", () => {
    expect(shouldWarnToolBudget(31, 40)).toBe(false);
    expect(shouldWarnToolBudget(32, 40)).toBe(true);
    expect(shouldWarnToolBudget(0, 40)).toBe(false);
    expect(shouldWarnToolBudget(10, 0)).toBe(false);
  });
});

describe("identical tool-call streak", () => {
  const batch = [{ name: "search_matter", arguments: { q: "定金", limit: 5 } }];

  it("ignores argument key order", () => {
    const flipped = [{ name: "search_matter", arguments: { limit: 5, q: "定金" } }];
    expect(toolCallBatchSignature(batch)).toBe(toolCallBatchSignature(flipped));
  });

  it("nudges on the third identical batch and stops only after that nudge", () => {
    let streak = advanceIdenticalToolStreak(null, toolCallBatchSignature(batch));
    expect(identicalToolRepeatDecision(streak)).toBe("ok");
    streak = advanceIdenticalToolStreak(streak, toolCallBatchSignature(batch));
    expect(identicalToolRepeatDecision(streak)).toBe("ok");
    streak = advanceIdenticalToolStreak(streak, toolCallBatchSignature(batch));
    expect(identicalToolRepeatDecision(streak)).toBe("nudge");
    streak = { ...streak, nudged: true };
    streak = advanceIdenticalToolStreak(streak, toolCallBatchSignature(batch));
    expect(identicalToolRepeatDecision(streak)).toBe("stop");
    expect(formatIdenticalToolRepeatNudge().startsWith("【重复调用】")).toBe(true);
    expect(formatIdenticalToolRepeatStop()).toBe(
      "同一步做了好几次，没有新的进展，所以先停下来。已经做好的结果都还在。要继续办理，在这条对话里回复「继续」即可。",
    );
  });

  it("resets when the batch changes", () => {
    let streak = advanceIdenticalToolStreak(null, toolCallBatchSignature(batch));
    streak = advanceIdenticalToolStreak(streak, toolCallBatchSignature(batch));
    streak = { ...streak, nudged: true };
    streak = advanceIdenticalToolStreak(
      streak,
      toolCallBatchSignature([{ name: "read_host_file", arguments: { path: "a.docx" } }]),
    );
    expect(streak.streak).toBe(1);
    expect(streak.nudged).toBe(false);
    expect(identicalToolRepeatDecision(streak)).toBe("ok");
  });
});

function toolMessage(id: string, data: Record<string, unknown>, ok = true): AgentMessage {
  return {
    role: "tool",
    content: "",
    timestamp: "2026-09-27T00:00:00.000Z",
    toolCallResponses: [{ toolCallId: id, name: "analyze_document", result: { ok, data } }],
  };
}

describe("completed document reread", () => {
  const read = { id: "c1", name: "analyze_document" };

  it("accepts a single read that already returned the whole extract", () => {
    const found = completedDocumentReread(
      [read],
      [toolMessage("c1", { hasMore: false, totalChars: 628 })],
    );
    expect(found).toEqual({ totalChars: 628 });
    expect(
      shouldContinueCompletedDocumentReread({
        wordRevision: true,
        alreadyContinued: false,
        reread: found,
      }),
    ).toBe(true);
  });

  it("does not continue twice, off the Word path, or when the read is unfinished", () => {
    const finished = completedDocumentReread(
      [read],
      [toolMessage("c1", { hasMore: false, totalChars: 628 })],
    );
    expect(
      shouldContinueCompletedDocumentReread({
        wordRevision: true,
        alreadyContinued: true,
        reread: finished,
      }),
    ).toBe(false);
    expect(
      shouldContinueCompletedDocumentReread({
        wordRevision: false,
        alreadyContinued: false,
        reread: finished,
      }),
    ).toBe(false);
    expect(
      completedDocumentReread([read], [toolMessage("c1", { hasMore: true, nextOffset: 4000 })]),
    ).toBeNull();
    expect(
      completedDocumentReread([read], [toolMessage("c1", { hasMore: false }, false)]),
    ).toBeNull();
    expect(
      completedDocumentReread([read], [toolMessage("c1", { hasMore: false, kind: "directory" })]),
    ).toBeNull();
    expect(
      completedDocumentReread(
        [
          { id: "c1", name: "analyze_document" },
          { id: "c2", name: "draft_document" },
        ],
        [
          toolMessage("c1", { hasMore: false, totalChars: 10 }),
          toolMessage("c2", { hasMore: false }),
        ],
      ),
    ).toBeNull();
  });

  it("tells the lawyer what happened in plain language", () => {
    expect(lawyerRepeatKind(["search_matter"], false)).toBe("search");
    expect(lawyerRepeatKind(["analyze_document"], false)).toBe("read_stuck");
    expect(lawyerRepeatKind(["analyze_document"], true)).toBe("read_done");
    expect(lawyerRepeatKind(["draft_document"], false)).toBe("draft");
    const tracked = formatIdenticalToolRepeatStop({
      kind: "read_done",
      trackedDraftMissing: true,
    });
    expect(tracked).toContain("已经读完");
    expect(tracked).toContain("原文件旁边");
    expect(tracked).toContain("回复「继续」");
    expect(tracked).not.toMatch(/[a-z]+_[a-z]+/);
    expect(tracked).not.toContain("空转");
    expect(formatIdenticalToolRepeatStop({ kind: "search" })).toContain("查找");
    expect(formatDocumentRereadNudge({ totalChars: 628, wordRevision: true })).toContain("628");
    expect(formatDocumentRereadNudge({ wordRevision: false })).not.toContain(
      "apply_surgical_edits",
    );
    expect(formatDocumentRereadContinue({ totalChars: 628 })).toContain("apply_surgical_edits");
  });
});

describe("resolveStrictUpstreamToolStreaming", () => {
  it("is false without onEvent", () => {
    expect(resolveStrictUpstreamToolStreaming(false)).toBe(false);
  });

  it("defaults to relaxed when env unset (D3 opt-in)", () => {
    expect(resolveStrictUpstreamToolStreaming(true, {})).toBe(false);
  });

  it("enables when LAWMIND_STRICT_TOOL_STREAM=1", () => {
    expect(resolveStrictUpstreamToolStreaming(true, { LAWMIND_STRICT_TOOL_STREAM: "1" })).toBe(
      true,
    );
    expect(resolveStrictUpstreamToolStreaming(true, { LAWMIND_STRICT_TOOL_STREAM: "true" })).toBe(
      true,
    );
  });

  it("stays relaxed for 0/false/off", () => {
    expect(resolveStrictUpstreamToolStreaming(true, { LAWMIND_STRICT_TOOL_STREAM: "0" })).toBe(
      false,
    );
    expect(resolveStrictUpstreamToolStreaming(true, { LAWMIND_STRICT_TOOL_STREAM: "false" })).toBe(
      false,
    );
    expect(resolveStrictUpstreamToolStreaming(true, { LAWMIND_STRICT_TOOL_STREAM: "off" })).toBe(
      false,
    );
  });
});
