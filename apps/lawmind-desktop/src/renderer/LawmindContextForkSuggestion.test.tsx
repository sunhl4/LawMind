/**
 * @vitest-environment jsdom
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import {
  CONTEXT_FORK_SUGGEST_MIN_COMPACTS,
  LawmindContextForkSuggestion,
  shouldSuggestContextFork,
} from "./LawmindContextForkSuggestion";

describe("shouldSuggestContextFork", () => {
  it("回合内被迫整理过就建议（这不是百分比能表达的信号）", () => {
    expect(shouldSuggestContextFork({ compactCount: 0, lastCompact: { midTurn: true } })).toBe(true);
  });

  it("同一会话压过 2 次才建议", () => {
    expect(shouldSuggestContextFork({ compactCount: 1 })).toBe(false);
    expect(
      shouldSuggestContextFork({ compactCount: CONTEXT_FORK_SUGGEST_MIN_COMPACTS }),
    ).toBe(true);
  });

  it("新会话 / 没数据时不打扰", () => {
    expect(shouldSuggestContextFork({ compactCount: 0, lastCompact: null })).toBe(false);
    expect(shouldSuggestContextFork(null)).toBe(false);
    expect(shouldSuggestContextFork(undefined)).toBe(false);
  });

  it("门槛由服务端下发（policy context.carryover.suggestMinCompacts）", () => {
    // 部署把门槛调到 1：压过一次就建议。
    expect(shouldSuggestContextFork({ compactCount: 1, suggestMinCompacts: 1 })).toBe(true);
    // 部署把门槛调到 5：压 2 次（默认门槛）时不该打扰。
    expect(shouldSuggestContextFork({ compactCount: 2, suggestMinCompacts: 5 })).toBe(false);
    // 非法值回落默认，不炸。
    expect(shouldSuggestContextFork({ compactCount: 2, suggestMinCompacts: Number.NaN })).toBe(true);
  });
});

describe("LawmindContextForkSuggestion", () => {
  it("给出去处与代价，并把「继续本对话」作为并列选项", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    const onFork = vi.fn();
    const onDismiss = vi.fn();
    await act(async () => {
      root.render(
        <LawmindContextForkSuggestion onFork={onFork} onDismiss={onDismiss} />,
      );
    });
    expect(host.textContent).toContain("已经整理过多次上下文");
    expect(host.textContent).toContain("草稿、案件档案与待办都在原处");
    await act(async () => {
      host.querySelector<HTMLButtonElement>('[data-testid="lm-ctx-fork-suggest-go"]')?.click();
    });
    expect(onFork).toHaveBeenCalled();
    await act(async () => {
      host
        .querySelector<HTMLButtonElement>('[data-testid="lm-ctx-fork-suggest-dismiss"]')
        ?.click();
    });
    expect(onDismiss).toHaveBeenCalled();
    root.unmount();
    host.remove();
  });

  it("忙碌时禁用两个按钮（不产生第二次 fork）", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(<LawmindContextForkSuggestion busy onFork={vi.fn()} onDismiss={vi.fn()} />);
    });
    expect(
      host.querySelector<HTMLButtonElement>('[data-testid="lm-ctx-fork-suggest-go"]')?.disabled,
    ).toBe(true);
    expect(host.textContent).toContain("正在带过去");
    root.unmount();
    host.remove();
  });
});
