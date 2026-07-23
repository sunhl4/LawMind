import { describe, expect, it } from "vitest";
import {
  applyRoundStart,
  applyToolEnd,
  applyToolProgress,
  applyToolStart,
  createEmptyLiveTrace,
  finalizeLiveTrace,
  finalizeLiveTraceFailed,
  humanToolLabel,
  liveTraceFromServerProgress,
  mergeDelegationLiveTraces,
  summarizeLiveTrace,
} from "./lawmind-chat-trace.js";

describe("lawmind-chat-trace", () => {
  it("maps known tool names to human labels", () => {
    expect(humanToolLabel("execute_workflow")).toBe("启动办案流程");
    expect(humanToolLabel("unknown_tool")).toBe("办理中");
  });

  it("accumulates round, tool, and workflow steps", () => {
    let trace = createEmptyLiveTrace();
    trace = applyRoundStart(trace, 1);
    trace = applyToolStart(trace, { toolCallId: "tc-1", toolName: "execute_workflow" });
    trace = applyToolProgress(trace, "规划任务结构");
    trace = applyToolProgress(trace, "生成草稿正文");
    trace = applyToolEnd(trace, {
      toolCallId: "tc-1",
      toolName: "execute_workflow",
      ok: true,
    });
    trace = finalizeLiveTrace(trace);

    expect(trace.active).toBe(false);
    expect(trace.steps.filter((s) => s.kind === "round")).toHaveLength(1);
    expect(trace.steps.filter((s) => s.kind === "tool")).toHaveLength(1);
    expect(trace.steps.filter((s) => s.kind === "workflow")).toHaveLength(2);
    expect(trace.steps.every((s) => s.status === "done")).toBe(true);
  });

  it("applyToolEnd matches running tool by toolCallId when multiple tools exist", () => {
    let trace = createEmptyLiveTrace();
    trace = applyToolStart(trace, { toolCallId: "tc-a", toolName: "execute_workflow" });
    trace = applyToolEnd(trace, {
      toolCallId: "tc-a",
      toolName: "execute_workflow",
      ok: true,
    });
    trace = applyToolStart(trace, { toolCallId: "tc-b", toolName: "write_document" });
    trace = applyToolEnd(trace, {
      toolCallId: "tc-b",
      toolName: "write_document",
      ok: false,
      error: "disk full",
    });
    const first = trace.steps.find((s) => s.id === "tc-a");
    const second = trace.steps.find((s) => s.id === "tc-b");
    expect(first?.status).toBe("done");
    expect(second?.status).toBe("failed");
    expect(second?.detail).toBe("disk full");
  });

  it("finalizeLiveTraceFailed marks running steps as failed", () => {
    let trace = createEmptyLiveTrace();
    trace = applyToolStart(trace, { toolCallId: "tc-1", toolName: "execute_workflow" });
    trace = applyToolProgress(trace, "生成草稿正文");
    const failed = finalizeLiveTraceFailed(trace);
    expect(failed.active).toBe(false);
    expect(failed.steps.every((s) => s.status === "failed")).toBe(true);
  });

  it("marks failed tool steps", () => {
    let trace = createEmptyLiveTrace();
    trace = applyToolStart(trace, { toolCallId: "tc-2", toolName: "write_document" });
    trace = applyToolEnd(trace, {
      toolCallId: "tc-2",
      toolName: "write_document",
      ok: false,
      error: "permission denied",
    });
    const toolStep = trace.steps.find((s) => s.kind === "tool");
    expect(toolStep?.status).toBe("failed");
    expect(toolStep?.detail).toBe("permission denied");
  });

  it("hydrates server progress snapshots", () => {
    const trace = liveTraceFromServerProgress({
      status: "running",
      currentRound: 2,
      steps: [
        { id: "r2", kind: "round", label: "第 2 轮推理", status: "done" },
        { id: "t1", kind: "tool", label: "写回草稿", status: "running" },
      ],
    });
    expect(trace.active).toBe(true);
    expect(trace.currentRound).toBe(2);
    expect(trace.steps).toHaveLength(2);
    expect(trace.steps[1]?.status).toBe("running");
  });

  it("finalize preserves completed server snapshot for reload re-attach", () => {
    const running = liveTraceFromServerProgress({
      status: "running",
      currentRound: 1,
      steps: [{ id: "t1", kind: "tool", label: "写回草稿", status: "running" }],
    });
    const finalized = finalizeLiveTrace({
      ...running,
      active: false,
      steps: running.steps.map((s) => ({ ...s, status: "done" as const })),
    });
    expect(finalized.active).toBe(false);
    expect(finalized.steps[0]?.status).toBe("done");
  });

  it("mergeDelegationLiveTraces prefixes assistant labels", () => {
    const merged = mergeDelegationLiveTraces(
      [
        {
          toAssistant: "researcher",
          progress: {
            status: "running",
            currentRound: 1,
            steps: [{ id: "s1", kind: "tool", label: "检索", status: "running" }],
          },
        },
      ],
      { researcher: "合同研究员" },
    );
    expect(merged?.active).toBe(true);
    expect(merged?.steps[0]?.label).toContain("合同研究员");
  });

  it("liveTracesEqual ignores object identity when content matches", async () => {
    const { liveTracesEqual } = await import("./lawmind-chat-trace-types.js");
    const a = {
      active: true,
      currentRound: 1,
      steps: [{ id: "t1", kind: "tool" as const, label: "写回草稿", status: "running" as const }],
    };
    const b = {
      active: true,
      currentRound: 1,
      steps: [{ id: "t1", kind: "tool" as const, label: "写回草稿", status: "running" as const }],
    };
    expect(liveTracesEqual(a, b)).toBe(true);
    expect(liveTracesEqual(a, { ...a, active: false })).toBe(false);
  });

  it("summarizeLiveTrace uses neutral copy when a step failed", () => {
    const trace = finalizeLiveTraceFailed({
      active: false,
      currentRound: 1,
      steps: [
        { id: "r1", kind: "round", label: "第 1 轮推理", status: "failed" },
        { id: "t1", kind: "tool", label: "写回草稿", status: "failed" },
      ],
    });
    expect(summarizeLiveTrace(trace)).toBe("未能完成本轮处理");
  });

  it("summarizeLiveTrace produces one-line summary", () => {
    const trace = finalizeLiveTrace({
      active: false,
      currentRound: 1,
      steps: [
        { id: "1", kind: "tool", label: "写回草稿", status: "done" },
        { id: "2", kind: "workflow", label: "渲染 Word", status: "done" },
      ],
    });
    expect(summarizeLiveTrace(trace)).toContain("已完成");
    expect(summarizeLiveTrace(trace)).toContain("渲染");
  });
});
