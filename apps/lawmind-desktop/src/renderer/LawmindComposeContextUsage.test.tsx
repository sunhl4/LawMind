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
    expect(host.textContent).toContain("沉淀到知识库");
    await act(async () => {
      host.querySelector<HTMLButtonElement>('[data-testid="lm-compose-open-memory"]')?.click();
    });
    expect(onOpenMemory).toHaveBeenCalled();
    root.unmount();
    host.remove();
  });
});
