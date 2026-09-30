/**
 * @vitest-environment jsdom
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDaemonIncidentNotify } from "./lawmind-daemon-incident-notify";
import { useSettingsPanelStore } from "./stores/settings-panel-store";

vi.mock("./api-client", () => ({
  apiGetJson: vi.fn(),
}));

import { apiGetJson } from "./api-client";

function Probe(props: { apiBase: string; enabled: boolean }) {
  useDaemonIncidentNotify(props);
  return null;
}

describe("useDaemonIncidentNotify", () => {
  beforeEach(() => {
    sessionStorage.clear();
    useSettingsPanelStore.getState().resetForTest();
    vi.mocked(apiGetJson).mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("notifies once per signature and opens settings workspace on first incident", async () => {
    const showNotification = vi.fn(async () => ({ ok: true }));
    Object.defineProperty(window, "lawmindDesktop", {
      configurable: true,
      value: { showNotification },
    });
    vi.mocked(apiGetJson).mockResolvedValue({
      daemon: {
        supervisionGaveUp: true,
        recap: { headline: "后台办件已停止重试", details: ["已放弃自动重启"] },
      },
    });

    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(<Probe apiBase="http://127.0.0.1:9" enabled />);
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(showNotification).toHaveBeenCalledTimes(1);
    const firstArg = (showNotification.mock.calls as unknown as Array<[Record<string, unknown>]>)[0]?.[0];
    expect(firstArg).toMatchObject({
      title: "后台办件已停止重试",
      openSettingsOnClick: true,
      settingsSection: "workspace",
    });
    expect(useSettingsPanelStore.getState().open).toBe(true);
    expect(useSettingsPanelStore.getState().sectionId).toBe("workspace");

    await act(async () => {
      root.render(<Probe apiBase="http://127.0.0.1:9" enabled />);
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(showNotification).toHaveBeenCalledTimes(1);

    act(() => {
      root.unmount();
    });
    host.remove();
  });

  it("stays quiet when daemon has only auto-recovered", async () => {
    const showNotification = vi.fn(async () => ({ ok: true }));
    Object.defineProperty(window, "lawmindDesktop", {
      configurable: true,
      value: { showNotification },
    });
    vi.mocked(apiGetJson).mockResolvedValue({
      daemon: {
        restartCount: 2,
        supervisionGaveUp: false,
        heartbeatStale: false,
        recap: { headline: "后台办件中断过，已自动恢复", details: ["期间后台办件中断过 2 次"] },
      },
    });

    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(<Probe apiBase="http://127.0.0.1:9" enabled />);
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(showNotification).not.toHaveBeenCalled();
    expect(useSettingsPanelStore.getState().open).toBe(false);
    act(() => {
      root.unmount();
    });
    host.remove();
  });
});
