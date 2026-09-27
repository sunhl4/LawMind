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
    expect(host.querySelector('[data-testid="lm-compose-desk-work"]')).toBeNull();
    expect(host.querySelector('[data-testid="lm-desk-work-panel"]')).toBeNull();
    expect(host.querySelector('[data-testid="lm-compose-open-meeting"]')).toBeNull();
    expect(host.querySelector('[data-testid="lm-compose-options-advanced"]')).toBeNull();
    expect(host.querySelector('[data-testid="lm-compose-show-tool-trace"]')).toBeNull();
  });

  it("shows the context usage entry only when the conversation gets long or was compacted", async () => {
    const renderWith = async (contextBudget: Parameters<typeof LawmindChatComposeToolbar>[0]["contextBudget"]) => {
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
            contextBudget={contextBudget}
            onCompactContext={vi.fn()}
            onDistillLearning={vi.fn()}
          />,
        );
      });
    };

    // 对话还短、也没整理过：入口不出现（助手会在回合里自己整理并继续办）。
    await renderWith({ used: 1000, effectiveLimit: 95000, level: "ok" });
    expect(host.querySelector('[data-testid="lm-compose-ctx-usage"]')).toBeNull();

    // 对话变长（warn / compact）：出现。
    await renderWith({ used: 80000, effectiveLimit: 95000, level: "warn" });
    expect(host.querySelector('[data-testid="lm-compose-ctx-usage"]')).toBeTruthy();
    await renderWith({ used: 94000, effectiveLimit: 95000, level: "compact" });
    expect(host.querySelector('[data-testid="lm-compose-ctx-usage"]')).toBeTruthy();

    // 已经整理过（compactCount / lastCompact）：即使当前用量不高也出现。
    await renderWith({ used: 1000, effectiveLimit: 95000, level: "ok", compactCount: 1 });
    expect(host.querySelector('[data-testid="lm-compose-ctx-usage"]')).toBeTruthy();
    await renderWith({
      used: 1000,
      effectiveLimit: 95000,
      level: "ok",
      lastCompact: { at: new Date().toISOString() },
    });
    expect(host.querySelector('[data-testid="lm-compose-ctx-usage"]')).toBeTruthy();

    // 没有预算数据时不出空圆环。
    await renderWith(null);
    expect(host.querySelector('[data-testid="lm-compose-ctx-usage"]')).toBeNull();
  });

  it("plan mode shows 开始执行 and labels the permission as 计划模式", async () => {
    await act(async () => {
      root.render(
        <LawmindChatComposeToolbar
          loading={false}
          input=""
          onSend={vi.fn()}
          permissionMode="readonly"
          onPermissionModeChange={vi.fn()}
          allowWebSearch
          onAllowWebSearchChange={vi.fn()}
          modelCatalog={[]}
          selectedModelId=""
        />,
      );
    });
    expect(host.querySelector('[data-testid="lm-compose-start-execute"]')?.textContent).toContain(
      "开始执行",
    );
    const plus = host.querySelector('button[aria-label="输入选项"]') as HTMLButtonElement;
    await act(async () => {
      plus.click();
    });
    const select = host.querySelector(
      '[data-testid="lm-compose-permission-mode"]',
    ) as HTMLSelectElement;
    expect(select.querySelector('option[value="readonly"]')?.textContent).toBe("计划模式");
  });

  it("keeps the model picker clickable while a reply is generating", async () => {
    await act(async () => {
      root.render(
        <LawmindChatComposeToolbar
          loading
          input=""
          onSend={vi.fn()}
          permissionMode="standard"
          onPermissionModeChange={vi.fn()}
          allowWebSearch
          onAllowWebSearchChange={vi.fn()}
          modelCatalog={[
            {
              id: "custom:demo",
              kind: "custom",
              label: "Demo",
              group: "自定义模型",
              provider: "custom",
              model: "demo-model",
              baseUrl: "https://example.com/v1",
              configured: true,
            },
          ]}
          selectedModelId="custom:demo"
          onModelSelect={vi.fn()}
        />,
      );
    });
    const trigger = host.querySelector(".lm-model-picker-trigger") as HTMLButtonElement;
    expect(trigger.disabled).toBe(false);
    expect(trigger.title).toContain("下一句");
    await act(async () => {
      trigger.click();
    });
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
  });
});
