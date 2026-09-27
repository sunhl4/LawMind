/**
 * @vitest-environment jsdom
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { LawmindComposeContextUsage } from "./LawmindComposeContextUsage";

describe("LawmindComposeContextUsage", () => {
  it("hides the length control on a short conversation", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(
        <LawmindComposeContextUsage
          budget={{ used: 3817, effectiveLimit: 95000, level: "ok" }}
          onCompact={vi.fn()}
          onDistill={vi.fn()}
        />,
      );
    });
    expect(host.querySelector('[data-testid="lm-compose-token-bar"]')).toBeNull();
    root.unmount();
    host.remove();
  });

  it("shows the length control once the conversation has been tidied", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    const onCompact = vi.fn();
    const onDistill = vi.fn();
    const onOpenMemory = vi.fn();
    await act(async () => {
      root.render(
        <LawmindComposeContextUsage
          budget={{ used: 3817, effectiveLimit: 95000, level: "ok", compactCount: 1 }}
          onCompact={onCompact}
          onDistill={onDistill}
          onOpenMemory={onOpenMemory}
        />,
      );
    });
    const trigger = host.querySelector('[data-testid="lm-compose-token-bar"]') as HTMLButtonElement;
    expect(trigger.textContent).toContain("已整理过");
    expect(trigger.textContent).not.toMatch(/k\//);
    await act(async () => {
      trigger.click();
    });
    expect(host.querySelector('[data-testid="lm-compose-ctx-usage-panel"]')).toBeTruthy();
    expect(host.textContent).toContain("整理这场对话");
    expect(host.textContent).toContain("整理并记住要点");
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
    expect(host.textContent).toContain("较早的约 12 条来回");
    expect(host.textContent).not.toContain("额度");
    await act(async () => {
      host.querySelector<HTMLButtonElement>('[data-testid="lm-compose-compact-confirm-ok"]')?.click();
    });
    expect(onCompact).toHaveBeenCalled();
    root.unmount();
    host.remove();
  });

  it("long conversation speaks in lawyer language and hides the model window", async () => {
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

    expect(host.querySelector('[data-testid="lm-compose-ctx-window"]')).toBeNull();
    expect(host.querySelector('[data-testid="lm-compose-ctx-breakdown"]')).toBeNull();
    expect(host.textContent).not.toContain("builtin:qwen-plus");
    expect(host.textContent).not.toContain("工具回包");
    expect(host.textContent).toContain("这场对话开始变长");

    expect(host.querySelector('[data-testid="lm-compose-ctx-last-compact"]')?.textContent).toContain(
      "已经整理过 2 次",
    );
    expect(host.querySelector('[data-testid="lm-compose-ctx-last-compact"]')?.textContent).toContain(
      "当时没有打断你",
    );

    expect(host.textContent).toContain("另开一段");

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
          budget={{ used: 80_000, effectiveLimit: 95_000, level: "warn" }}
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
    expect(host.querySelector('[data-testid="lm-compose-token-bar"]')).toBeNull();
    expect(host.textContent).not.toContain("模型窗口");
    root.unmount();
    host.remove();
  });
});
