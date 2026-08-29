/**
 * @vitest-environment jsdom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LawmindChatComposeToolbar } from "./lawmind-chat-compose-toolbar";

describe("LawmindChatComposeToolbar slim bar", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    host.remove();
  });

  it("keeps permission off the default bar until + opens", async () => {
    await act(async () => {
      root.render(
        <LawmindChatComposeToolbar
          loading={false}
          input=""
          onSend={vi.fn()}
          permissionMode="standard"
          onPermissionModeChange={vi.fn()}
          allowWebSearch
          onAllowWebSearchChange={vi.fn()}
          modelCatalog={[]}
          selectedModelId=""
          onOpenWriteMaterials={vi.fn()}
        />,
      );
    });
    const panel = host.querySelector('[role="dialog"][aria-label="输入选项"]');
    expect(panel?.hasAttribute("hidden")).toBe(true);
    expect(host.querySelector(".lm-compose-permission-inline")).toBeNull();
    const plus = host.querySelector('button[aria-label="输入选项"]') as HTMLButtonElement;
    expect(plus).toBeTruthy();
    await act(async () => {
      plus.click();
    });
    expect(panel?.hasAttribute("hidden")).toBe(false);
    expect(host.querySelector('[data-testid="lm-compose-permission-mode"]')).toBeTruthy();
    expect(host.querySelector('[data-testid="lm-compose-desk-work"]')).toBeTruthy();
    const deskPop = host.querySelector(".lm-compose-desk-work-pop");
    expect(deskPop?.hasAttribute("hidden")).toBe(true);
    await act(async () => {
      (host.querySelector('[data-testid="lm-compose-desk-work"]') as HTMLButtonElement).click();
    });
    expect(deskPop?.hasAttribute("hidden")).toBe(false);
    expect(host.querySelector('[data-testid="lm-desk-work-panel"]')).toBeTruthy();
    expect(host.querySelector('[data-testid="lm-compose-open-meeting"]')).toBeTruthy();
    expect(host.querySelector('[data-testid="lm-compose-options-advanced"]')).toBeNull();
    expect(host.querySelector('[data-testid="lm-compose-show-tool-trace"]')).toBeNull();
  });

  it("hides context usage until budget is warn or compact", async () => {
    await act(async () => {
      root.render(
        <LawmindChatComposeToolbar
          loading={false}
          input=""
          onSend={vi.fn()}
          permissionMode="standard"
          onPermissionModeChange={vi.fn()}
          allowWebSearch
          onAllowWebSearchChange={vi.fn()}
          modelCatalog={[]}
          selectedModelId=""
          onOpenWriteMaterials={vi.fn()}
          contextBudget={{ used: 1000, effectiveLimit: 95000, level: "ok" }}
          onCompactContext={vi.fn()}
          onDistillLearning={vi.fn()}
        />,
      );
    });
    expect(host.querySelector('[data-testid="lm-compose-ctx-usage"]')).toBeNull();

    await act(async () => {
      root.render(
        <LawmindChatComposeToolbar
          loading={false}
          input=""
          onSend={vi.fn()}
          permissionMode="standard"
          onPermissionModeChange={vi.fn()}
          allowWebSearch
          onAllowWebSearchChange={vi.fn()}
          modelCatalog={[]}
          selectedModelId=""
          onOpenWriteMaterials={vi.fn()}
          contextBudget={{ used: 80000, effectiveLimit: 95000, level: "warn" }}
          onCompactContext={vi.fn()}
          onDistillLearning={vi.fn()}
        />,
      );
    });
    expect(host.querySelector('[data-testid="lm-compose-ctx-usage"]')).toBeTruthy();
  });
});
