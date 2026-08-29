/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  buildExecuteConfirmPrompt,
  clearPlanHandoff,
  extractPlanHandoffText,
  isExecuteConfirmPrompt,
  planHandoffSummary,
  readPlanHandoff,
  resetPlanHandoffStoreForTests,
  shouldInjectExecuteHandoff,
  syncPlanHandoffFromMessages,
  writePlanHandoff,
} from "./lawmind-plan-handoff";

describe("lawmind-plan-handoff", () => {
  beforeEach(() => {
    resetPlanHandoffStoreForTests();
  });

  it("extracts latest plan-like assistant message", () => {
    const text = extractPlanHandoffText([
      { role: "user", text: "审这份 NDA" },
      { role: "assistant", text: "好的，我先了解一下。" },
      {
        role: "assistant",
        text: "执行计划：\n1. 核对当事人\n2. 审责任限制\n验收要点：引用齐全",
      },
    ]);
    expect(text).toContain("执行计划");
    expect(text).toContain("责任限制");
  });

  it("falls back to last assistant when no plan hint", () => {
    const text = extractPlanHandoffText([
      { role: "assistant", text: "已收到材料。" },
      { role: "assistant", text: "建议下周前交初稿。" },
    ]);
    expect(text).toBe("建议下周前交初稿。");
  });

  it("builds execute confirm prompt", () => {
    const p = buildExecuteConfirmPrompt("1. 检索\n2. 起草");
    expect(p).toContain("【确认执行】");
    expect(p).toContain("1. 检索");
    expect(isExecuteConfirmPrompt(p)).toBe(true);
  });

  it("only injects when input empty", () => {
    expect(shouldInjectExecuteHandoff("")).toBe(true);
    expect(shouldInjectExecuteHandoff("  ")).toBe(true);
    expect(shouldInjectExecuteHandoff("已有草稿")).toBe(false);
  });

  it("persists and clears per session", () => {
    writePlanHandoff("s1", "执行计划：先检索");
    expect(readPlanHandoff("s1")?.planText).toContain("先检索");
    expect(readPlanHandoff("s2")).toBeNull();
    clearPlanHandoff("s1");
    expect(readPlanHandoff("s1")).toBeNull();
  });

  it("syncPlanHandoffFromMessages upserts plan-like replies", () => {
    const stored = syncPlanHandoffFromMessages("sess-a", [
      { role: "assistant", text: "执行计划：\n1. 读合同\n2. 出意见" },
    ]);
    expect(stored?.planText).toContain("读合同");
    expect(readPlanHandoff("sess-a")?.planText).toContain("出意见");
  });

  it("summarizes for banner", () => {
    expect(planHandoffSummary("短")).toBe("短");
    expect(planHandoffSummary("x".repeat(100)).endsWith("…")).toBe(true);
  });

  it("preferNewerPlanHandoff picks later updatedAt", async () => {
    const { preferNewerPlanHandoff } = await import("./lawmind-plan-handoff");
    const a = { planText: "old", updatedAt: "2026-01-01T00:00:00.000Z" };
    const b = { planText: "new", updatedAt: "2026-07-23T00:00:00.000Z" };
    expect(preferNewerPlanHandoff(a, b)?.planText).toBe("new");
    expect(preferNewerPlanHandoff(b, a)?.planText).toBe("new");
  });
});
