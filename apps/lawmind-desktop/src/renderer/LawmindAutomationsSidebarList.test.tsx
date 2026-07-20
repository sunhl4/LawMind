/**
 * @vitest-environment jsdom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LawmindAutomationsSidebarList } from "./LawmindAutomationsSidebarList";
import { LawmindShellProviders } from "./app/LawmindShellContexts";

vi.mock("./api-client", () => ({
  apiGetJson: vi.fn(),
  errorMessage: (e: unknown, fallback: string) =>
    e instanceof Error ? e.message : fallback,
}));

import { apiGetJson } from "./api-client";

const apiGetJsonMock = vi.mocked(apiGetJson);

describe("LawmindAutomationsSidebarList", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    apiGetJsonMock.mockReset();
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    host.remove();
  });

  it("renders empty state when there are no automations", async () => {
    apiGetJsonMock.mockResolvedValue({ automations: [], inbox: [] });

    await act(async () => {
      root.render(
        <LawmindShellProviders
          navigation={{ mainView: "automations", matterCockpitOpen: false, settingsOpen: false }}
          chatSession={{ selectedAssistantId: "", activeChatSessionId: undefined }}
        >
          <LawmindAutomationsSidebarList apiBase="http://127.0.0.1:9" />
        </LawmindShellProviders>,
      );
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(host.textContent).toContain("还没有交办任务");
    expect(host.querySelector('[data-testid="lm-automations-sidebar-list"]')).not.toBeNull();
  });

  it("lists configured automations with schedule and matter title", async () => {
    apiGetJsonMock.mockResolvedValue({
      automations: [
        {
          id: "auto-1",
          title: "合同续签盯梢",
          enabled: true,
          matterId: "m1",
          schedule: { kind: "weekly", weekday: 1, hour: 9, minute: 0 },
          nextRunAt: "2026-07-20T09:00:00.000Z",
        },
      ],
      inbox: [{ id: "in-1", automationId: "auto-1", status: "open" }],
    });

    await act(async () => {
      root.render(
        <LawmindShellProviders
          navigation={{ mainView: "automations", matterCockpitOpen: false, settingsOpen: false }}
          chatSession={{ selectedAssistantId: "", activeChatSessionId: undefined }}
        >
          <LawmindAutomationsSidebarList
            apiBase="http://127.0.0.1:9"
            matterTitles={[{ matterId: "m1", title: "测试案件" }]}
          />
        </LawmindShellProviders>,
      );
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(host.textContent).toContain("合同续签盯梢");
    expect(host.textContent).toContain("每周一 09:00");
    expect(host.textContent).toContain("测试案件");
    expect(host.textContent).toContain("1 待拍板");
    expect(host.querySelector('[data-testid="lm-automations-sidebar-row-auto-1"]')).not.toBeNull();
  });
});
