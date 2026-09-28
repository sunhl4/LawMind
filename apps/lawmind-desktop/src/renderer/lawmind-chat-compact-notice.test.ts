import { describe, expect, it } from "vitest";
import { isAssistantMemoryStatusLabel } from "./lawmind-chat-compact-notice";

describe("isAssistantMemoryStatusLabel", () => {
  it("把整理和检索收短挡在对话框外", () => {
    expect(isAssistantMemoryStatusLabel("较早的来回已收成要点，继续办")).toBe(true);
    expect(isAssistantMemoryStatusLabel("较早的检索结果已收短，继续办")).toBe(true);
    expect(isAssistantMemoryStatusLabel("这场对话已整理，继续办")).toBe(true);
    expect(
      isAssistantMemoryStatusLabel(
        "较早的来回已收成要点，继续办（开发者：cases/m1/compact-digest.md）",
      ),
    ).toBe(true);
  });

  it("律师主动操作的结果仍然可以出现", () => {
    expect(isAssistantMemoryStatusLabel("已另起新对话（已带上整理稿）")).toBe(false);
    expect(isAssistantMemoryStatusLabel("本轮已办理 12 步，继续办理中")).toBe(false);
    expect(isAssistantMemoryStatusLabel("当前没有可续接的对话。")).toBe(false);
  });
});
