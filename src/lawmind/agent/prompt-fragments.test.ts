import { describe, expect, it } from "vitest";
import {
  capFragmentBody,
  createPromptFragment,
  formatOverflowPointer,
  formatRemainingTokensNote,
  formatTurnContextUserMessage,
  packPromptFragments,
  partitionPackedFragments,
  renderPackedFragments,
  withEphemeralBudgetNote,
  withEphemeralTurnContext,
} from "./prompt-fragments.js";

describe("prompt-fragments", () => {
  it("caps over-budget CJK with a tool+path overflow pointer", () => {
    const body = "甲".repeat(2_000);
    const out = capFragmentBody(body, 200, { tool: "read_case_file", path: "cases/m1/CASE.md" });
    expect(out.length).toBeLessThan(body.length);
    expect(out).toContain("read_case_file");
    expect(out).toContain("cases/m1/CASE.md");
    expect(formatOverflowPointer({ tool: "read_case_file", path: "cases/m1/CASE.md" })).toContain(
      "read_case_file",
    );
  });

  it("does not truncate a short fragment", () => {
    expect(capFragmentBody("案件：m1", 200, null)).toBe("案件：m1");
  });

  it("drops low-priority memory hits when the tail budget is tight", () => {
    const craft = createPromptFragment({
      kind: "craft",
      body: "Craft body",
      worldStateId: "craft",
    });
    const memory = createPromptFragment({
      kind: "memory_hit",
      body: "x".repeat(8_000),
      overflow: { tool: "read_workspace_file", path: "memory/topics/a.md" },
      capTokens: 8_000,
    });
    expect(craft).toBeTruthy();
    expect(memory).toBeTruthy();
    const packed = packPromptFragments([craft!, memory!], 400);
    expect(packed.some((f) => f.kind === "craft")).toBe(true);
    expect(packed.some((f) => f.kind === "memory_hit")).toBe(false);
  });

  it("never drops world-state environment even over budget", () => {
    const env = createPromptFragment({
      kind: "environment",
      body: "<environment><permission_mode>readonly</permission_mode></environment>",
      worldStateId: "permission",
    });
    const hit = createPromptFragment({
      kind: "memory_hit",
      body: "gist",
    });
    const packed = packPromptFragments([env!, hit!], 10);
    expect(packed.some((f) => f.kind === "environment")).toBe(true);
  });

  it("never drops a turn_plan world-state fragment", () => {
    const plan = createPromptFragment({
      kind: "turn_plan",
      body: '<turn_plan><step status="in_progress">读合同</step></turn_plan>',
      worldStateId: "plan",
    });
    const hit = createPromptFragment({
      kind: "memory_hit",
      body: "gist",
    });
    const packed = packPromptFragments([plan!, hit!], 10);
    expect(packed.some((f) => f.kind === "turn_plan")).toBe(true);
  });

  it("renders world-state wrappers for named sections", () => {
    const pins = createPromptFragment({
      kind: "pins",
      body: "- pin-a",
      worldStateId: "pins",
    });
    const rendered = renderPackedFragments([pins!]).join("");
    expect(rendered).toContain("<!--lm-ws:pins-->");
    expect(rendered).toContain("- pin-a");
  });

  it("appends remaining-token notes only at sample time", () => {
    const note = formatRemainingTokensNote(1_000, 8_000);
    expect(note).toContain("还剩 7000 token");
    const messages = withEphemeralBudgetNote([{ role: "user" as const, content: "审合同" }], note);
    expect(messages).toHaveLength(2);
    expect(messages[1]?.content).toContain("还剩 7000");
  });

  it("keeps only the first session-tail craft", () => {
    const first = createPromptFragment({ kind: "craft", body: "WORD_REVISION" });
    const second = createPromptFragment({ kind: "craft", body: "REDLINE_CRAFT" });
    const world = createPromptFragment({
      kind: "craft",
      body: "compact reminder",
      worldStateId: "craft",
    });
    const packed = packPromptFragments([first!, second!, world!], 12_000);
    expect(packed.filter((f) => f.kind === "craft" && f.placement !== "world_state")).toHaveLength(
      1,
    );
    expect(packed.some((f) => f.body.includes("WORD_REVISION"))).toBe(true);
    expect(packed.some((f) => f.body.includes("REDLINE_CRAFT"))).toBe(false);
    expect(packed.some((f) => f.placement === "world_state")).toBe(true);
  });

  it("splits world-state from session tail and wraps turn_context for sampling", () => {
    const env = createPromptFragment({
      kind: "environment",
      body: "<permission_mode>readonly</permission_mode>",
      worldStateId: "permission",
    });
    const caseIndex = createPromptFragment({
      kind: "matter_index",
      body: "## 当前案件 [m1]\n\n索引",
    });
    const packed = packPromptFragments([env!, caseIndex!]);
    const parts = partitionPackedFragments(packed);
    expect(parts.worldState).toHaveLength(1);
    expect(parts.sessionTail).toHaveLength(1);
    const wrapped = formatTurnContextUserMessage(renderPackedFragments(parts.sessionTail).join(""));
    expect(wrapped).toContain("<turn_context>");
    expect(wrapped).toContain("当前案件");
    const sampled = withEphemeralTurnContext(
      [{ role: "system" as const, content: "sys" }],
      wrapped,
    );
    expect(sampled).toHaveLength(2);
    expect(sampled[1]?.role).toBe("user");
  });
});
