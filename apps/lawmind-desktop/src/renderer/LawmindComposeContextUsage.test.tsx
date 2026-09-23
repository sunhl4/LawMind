/**
 * @vitest-environment jsdom
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { LawmindComposeContextUsage } from "./LawmindComposeContextUsage";

describe("LawmindComposeContextUsage", () => {
  it("renders ring on model row and opens panel with actions", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    const onCompact = vi.fn();
    const onDistill = vi.fn();
    const onOpenMemory = vi.fn();
    await act(async () => {
      root.render(
        <LawmindComposeContextUsage
          budget={{ used: 3817, effectiveLimit: 95000, level: "ok" }}
          onCompact={onCompact}
          onDistill={onDistill}
          onOpenMemory={onOpenMemory}
        />,
      );
    });
    const trigger = host.querySelector('[data-testid="lm-compose-token-bar"]') as HTMLButtonElement;
    expect(trigger).toBeTruthy();
    expect(trigger.textContent).toMatch(/3\.8k\/95k/);
    await act(async () => {
      trigger.click();
    });
    expect(host.querySelector('[data-testid="lm-compose-ctx-usage-panel"]')).toBeTruthy();
    expect(host.textContent).toContain("整理上下文");
    expect(host.textContent).toContain("整理并沉淀");
    await act(async () => {
      host.querySelector<HTMLButtonElement>('[data-testid="lm-compose-open-memory"]')?.click();
    });
    expect(onOpenMemory).toHaveBeenCalled();
    root.unmount();
    host.remove();
  });

  it("shows dry-run confirm before compact and does not call onCompact until confirmed", async () => {    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    const onCompact = vi.fn();
    const onDistill = vi.fn();
    const onPreviewCompact = vi.fn().mockResolvedValue({
      compacted: true,
      droppedMessageCount: 12,
      estimatedDroppedTokens: 4800,
      useLlmDigestAvailable: true,
      useLlmDigest: true,
    });
    await act(async () => {
      root.render(
        <LawmindComposeContextUsage
          budget={{ used: 80_000, effectiveLimit: 95_000, level: "warn" }}
          onCompact={onCompact}
          onDistill={onDistill}
          onPreviewCompact={onPreviewCompact}
        />,
      );
    });
    await act(async () => {
      host.querySelector<HTMLButtonElement>('[data-testid="lm-compose-token-bar"]')?.click();
    });
    await act(async () => {
      host.querySelector<HTMLButtonElement>('[data-testid="lm-compose-compact"]')?.click();
    });
    expect(onPreviewCompact).toHaveBeenCalled();
    expect(onCompact).not.toHaveBeenCalled();
    expect(host.querySelector('[data-testid="lm-compose-compact-confirm"]')).toBeTruthy();
    expect(host.textContent).toContain("预计移除约 12 条");
    await act(async () => {
      host.querySelector<HTMLButtonElement>('[data-testid="lm-compose-compact-confirm-ok"]')?.click();
    });
    expect(onCompact).toHaveBeenCalled();
    root.unmount();
    host.remove();
  });

  it("panel shows the window triple, layered breakdown, last compact and the honesty line", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(
        <LawmindComposeContextUsage
          budget={{
            used: 80_000,
            effectiveLimit: 95_000,
            level: "warn",
            modelId: "builtin:qwen-plus",
            window: {
              contextTokens: 128_000,
              maxOutputTokens: 44_800,
              summaryOutputTokenReserve: 20_000,
              autoCompactBufferTokens: 13_000,
              usableLimit: 95_000,
              autoCompactLimit: 95_000,
              midTurnCompactLimit: 85_500,
            },
            breakdown: [
              { id: "lawyer", tokens: 12_000 },
              { id: "assistant", tokens: 20_000 },
              { id: "toolResults", tokens: 30_000 },
              { id: "digest", tokens: 4_000 },
              { id: "pins", tokens: 2_000 },
              { id: "rules", tokens: 12_000 },
              { id: "plan", tokens: 0 },
            ],
            compactCount: 2,
            lastCompact: { at: "2026-09-23T02:10:00.000Z", droppedMessageCount: 18, midTurn: true },
          }}
          onCompact={vi.fn()}
          onDistill={vi.fn()}
        />,
      );
    });
    await act(async () => {
      host.querySelector<HTMLButtonElement>('[data-testid="lm-compose-token-bar"]')?.click();
    });

    // A4：律师能把界面数字和模型窗口对上（Codex /status 的对应物）。
    const win = host.querySelector('[data-testid="lm-compose-ctx-window"]')?.textContent ?? "";
    expect(win).toContain("模型窗口 128k");
    expect(win).toContain("可用 95k");
    expect(win).toContain("自动整理线 86k");
    expect(win).toContain("builtin:qwen-plus");

    // A2：可操作信号出现在 warn（自动整理线附近），不再是到 100% 才说「建议压缩」。
    expect(host.textContent).toContain("接近自动整理线，可整理");

    // A3：分层用量，而不是一个笼统的「额度」。
    const breakdown = host.querySelector('[data-testid="lm-compose-ctx-breakdown"]');
    expect(breakdown?.textContent).toContain("工具回包");
    expect(breakdown?.textContent).toContain("钉选材料");
    expect(breakdown?.textContent).toContain("压缩摘要");
    // 0 用量的桶不占行。
    expect(breakdown?.textContent).not.toContain("本轮清单");

    // A7：上次整理的事实。
    expect(host.querySelector('[data-testid="lm-compose-ctx-last-compact"]')?.textContent).toContain(
      "本对话已整理 2 次",
    );
    expect(host.querySelector('[data-testid="lm-compose-ctx-last-compact"]')?.textContent).toContain(
      "回合内自动整理，未中断",
    );

    // A8：诚实提示（Codex 同款口径），也是「另起新对话」功能的入口论据。
    expect(host.textContent).toContain("另起新对话");

    root.unmount();
    host.remove();
  });

  it("offers fork-with-carryover from the panel when the handler is wired", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    const onForkWithCarryover = vi.fn();
    await act(async () => {
      root.render(
        <LawmindComposeContextUsage
          budget={{ used: 80_000, effectiveLimit: 95_000, level: "warn", compactCount: 2 }}
          onCompact={vi.fn()}
          onDistill={vi.fn()}
          onForkWithCarryover={onForkWithCarryover}
        />,
      );
    });
    await act(async () => {
      host.querySelector<HTMLButtonElement>('[data-testid="lm-compose-token-bar"]')?.click();
    });
    const fork = host.querySelector<HTMLButtonElement>(
      '[data-testid="lm-compose-fork-carryover"]',
    );
    expect(fork?.textContent).toContain("另起新对话（带上文）");
    await act(async () => {
      fork?.click();
    });
    expect(onForkWithCarryover).toHaveBeenCalled();
    // 点完关面板，律师立刻看到对话已切换。
    expect(host.querySelector('[data-testid="lm-compose-ctx-usage-panel"]')).toBeNull();
    root.unmount();
    host.remove();
  });

  it("offers no fork action when the handler is absent", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(
        <LawmindComposeContextUsage
          budget={{ used: 1_000, effectiveLimit: 95_000, level: "ok" }}
          onCompact={vi.fn()}
          onDistill={vi.fn()}
        />,
      );
    });
    await act(async () => {
      host.querySelector<HTMLButtonElement>('[data-testid="lm-compose-token-bar"]')?.click();
    });
    expect(host.querySelector('[data-testid="lm-compose-fork-carryover"]')).toBeNull();
    root.unmount();
    host.remove();
  });

  it("omits breakdown and honesty line for a fresh conversation", async () => {    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(
        <LawmindComposeContextUsage
          budget={{
            used: 3_817,
            effectiveLimit: 95_000,
            level: "ok",
            window: { contextTokens: 128_000, usableLimit: 95_000 },
            breakdown: [{ id: "rules", tokens: 3_817 }],
          }}
          onCompact={vi.fn()}
          onDistill={vi.fn()}
        />,
      );
    });
    await act(async () => {
      host.querySelector<HTMLButtonElement>('[data-testid="lm-compose-token-bar"]')?.click();
    });
    expect(host.querySelector('[data-testid="lm-compose-ctx-breakdown"]')).toBeTruthy();
    expect(host.querySelector('[data-testid="lm-compose-ctx-last-compact"]')).toBeNull();
    expect(host.textContent).not.toContain("另起新对话");
    expect(host.textContent).not.toContain("接近自动整理线");
    root.unmount();
    host.remove();
  });
});
