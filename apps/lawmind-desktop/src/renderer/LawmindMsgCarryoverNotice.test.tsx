/**
 * @vitest-environment jsdom
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { LawmindMsgCarryoverNotice } from "./LawmindMsgCarryoverNotice";
import {
  dismissForkSuggestion,
  isForkSuggestionDismissed,
  readForkSuggestDismissedAt,
} from "./lawmind-context-fork-pref";

describe("LawmindMsgCarryoverNotice", () => {
  it("给出源对话、整理量、摘要来源，并可展开摘要预览", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(
        <LawmindMsgCarryoverNotice
          origin={{
            sessionId: "s-1",
            title: "竞业限制解除",
            at: "2026-09-23T02:10:00.000Z",
            digestSource: "llm",
            digestChars: 1_240,
            droppedMessageCount: 18,
            digestPreview: "【压缩前对话蒸馏】摘要：律师要解除条款，已定位《劳动合同法》第23条。",
          }}
        />,
      );
    });
    expect(host.textContent).toContain("本对话续接自「竞业限制解除」");
    expect(host.textContent).toContain("整理 18 条");
    expect(host.textContent).toContain("1,240 字");
    expect(host.textContent).toContain("模型摘要");
    // 律师可核对带过来了什么。
    expect(host.textContent).toContain("查看带过来的整理稿");
    expect(host.textContent).toContain("《劳动合同法》第23条");
    expect(host.textContent).toContain("草稿、案件档案与待办都在原处");
    root.unmount();
    host.remove();
  });

  it("没有预览时不渲染展开区，也不假装有摘要", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(
        <LawmindMsgCarryoverNotice
          origin={{ sessionId: "s-2", digestSource: "none", droppedMessageCount: 0 }}
        />,
      );
    });
    expect(host.textContent).toContain("上一段对话");
    expect(host.textContent).toContain("无可提取要点");
    expect(host.textContent).not.toContain("查看带过来的整理稿");
    root.unmount();
    host.remove();
  });
});

describe("fork suggestion dismissal pref", () => {
  it("按会话记住「继续本对话」，换会话不受影响", () => {
    // 测试进程的 localStorage 可能不可用（node --localstorage-file 无有效路径）：
    // 用内存实现替换，断言的仍是本模块的键约定与按会话隔离行为。
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    });
    dismissForkSuggestion("s-a", "2026-09-23T00:00:00.000Z");
    expect(isForkSuggestionDismissed("s-a")).toBe(true);
    expect(readForkSuggestDismissedAt("s-a")).toBe("2026-09-23T00:00:00.000Z");
    expect(isForkSuggestionDismissed("s-b")).toBe(false);
    expect(isForkSuggestionDismissed(undefined)).toBe(false);
  });
});
