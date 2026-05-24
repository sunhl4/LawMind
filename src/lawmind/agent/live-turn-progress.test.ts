import { describe, expect, it, afterEach } from "vitest";
import {
  applyLiveTurnEvent,
  beginLiveTurnProgress,
  finishLiveTurnProgress,
  getLiveTurnProgress,
  liveProgressToPersistedTrace,
  resetLiveTurnProgressStore,
} from "./live-turn-progress.js";

describe("live-turn-progress", () => {
  afterEach(() => {
    resetLiveTurnProgressStore();
  });

  it("records round, tool, and workflow steps", () => {
    beginLiveTurnProgress("s1");
    applyLiveTurnEvent("s1", { type: "round_start", roundIndex: 1 });
    applyLiveTurnEvent("s1", {
      type: "tool_call_start",
      roundIndex: 1,
      toolCallId: "tc1",
      toolName: "execute_workflow",
      args: {},
    });
    applyLiveTurnEvent("s1", {
      type: "tool_progress",
      roundIndex: 1,
      toolCallId: "tc1",
      toolName: "execute_workflow",
      label: "正在检索法规和案例...",
    });
    applyLiveTurnEvent("s1", {
      type: "tool_call_end",
      roundIndex: 1,
      toolCallId: "tc1",
      toolName: "execute_workflow",
      ok: true,
    });
    applyLiveTurnEvent("s1", { type: "final", status: "completed", reply: "ok" });
    const p = getLiveTurnProgress("s1");
    expect(p?.status).toBe("completed");
    expect(p?.steps.some((s) => s.label.includes("检索"))).toBe(true);
    expect(p?.steps.some((s) => s.kind === "tool" && s.status === "done")).toBe(true);
  });

  it("maps final error status to failed", () => {
    beginLiveTurnProgress("s-err");
    applyLiveTurnEvent("s-err", { type: "final", status: "error", reply: "boom" });
    expect(getLiveTurnProgress("s-err")?.status).toBe("failed");
  });

  it("finishLiveTurnProgress marks running steps done or failed", () => {
    beginLiveTurnProgress("s-fail");
    applyLiveTurnEvent("s-fail", {
      type: "tool_call_start",
      roundIndex: 1,
      toolCallId: "tc1",
      toolName: "write_document",
      args: {},
    });
    finishLiveTurnProgress("s-fail", "failed");
    const p = getLiveTurnProgress("s-fail");
    expect(p?.status).toBe("failed");
    expect(p?.steps.every((s) => s.status === "failed")).toBe(true);
  });

  it("liveProgressToPersistedTrace snapshots store", () => {
    beginLiveTurnProgress("persist-1");
    applyLiveTurnEvent("persist-1", {
      type: "tool_call_start",
      roundIndex: 1,
      toolCallId: "tc1",
      toolName: "execute_workflow",
      args: {},
    });
    const snap = liveProgressToPersistedTrace("persist-1");
    expect(snap?.steps[0]?.label).toContain("工作流");
  });
});
