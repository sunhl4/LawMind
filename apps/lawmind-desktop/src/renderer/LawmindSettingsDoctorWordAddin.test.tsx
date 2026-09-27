/**
 * @vitest-environment jsdom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WordAddinDoctorGroup } from "./LawmindSettingsDoctorWordAddin";

describe("WordAddinDoctorGroup", () => {
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
    vi.unstubAllGlobals();
  });

  async function render() {
    await act(async () => {
      root.render(<WordAddinDoctorGroup />);
      await Promise.resolve();
    });
  }

  it("清单刚写过时请律师重开，并且不展示端口", async () => {
    Object.defineProperty(window, "lawmindDesktop", {
      configurable: true,
      value: {
        getConfig: async () => ({
          addinHosts: { word: "reopen", wps: "reopen" },
        }),
      },
    });
    await render();
    const text = host.textContent ?? "";
    expect(text).toContain("请完全退出 Word");
    expect(text).toContain("请完全退出 WPS");
    expect(text).toContain("重新连接");
    expect(host.querySelector("[data-testid=lm-doctor-addin-port-contract]")?.textContent).not.toContain(
      "已连接",
    );
    expect(text).not.toContain("54881");
    expect(text).not.toContain("55102");
    expect(text).not.toContain("侧载");
  });

  it("清单只存到下载时，不把状态改成已连接", async () => {
    Object.defineProperty(window, "lawmindDesktop", {
      configurable: true,
      value: {
        getConfig: async () => ({
          addinHosts: { word: "reopen", wps: "missing" },
        }),
        syncWordAddinManifest: async () => ({
          ok: true,
          location: "downloads",
          instructions: "已保存到「下载」。请把它放进 Word 的加载项文件夹，然后完全退出 Word 再打开。",
        }),
      },
    });
    await render();
    const button = host.querySelector("[data-testid=lm-doctor-addin-resync]");
    await act(async () => {
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });
    expect(host.textContent).toContain("请完全退出 Word");
    expect(host.textContent).toContain("下载");
    expect(host.querySelector("[data-testid=lm-doctor-addin-port-contract]")?.textContent).not.toContain(
      "已连接",
    );
  });

  it("另一个 LawMind 占用时不提供改写按钮", async () => {
    Object.defineProperty(window, "lawmindDesktop", {
      configurable: true,
      value: {
        getConfig: async () => ({
          addinHosts: { word: "another-copy", wps: "another-copy" },
        }),
      },
    });
    await render();
    expect(host.textContent).toContain("请改用已经打开的 LawMind");
    expect(host.querySelector("[data-testid=lm-doctor-addin-resync]")).toBeNull();
  });

  it("两边都指着当前 LawMind 时仍留在设置页，方便再次登记", async () => {
    Object.defineProperty(window, "lawmindDesktop", {
      configurable: true,
      value: {
        getConfig: async () => ({
          addinHosts: { word: "connected", wps: "connected" },
        }),
      },
    });
    await render();
    expect(host.querySelector("[data-testid=lm-doctor-word-addin]")).not.toBeNull();
    expect(host.textContent).toContain("Word 已连接");
    expect(host.textContent).toContain("WPS 已连接");
    expect(host.querySelector("[data-testid=lm-doctor-addin-resync]")?.textContent).toContain("重新连接");
  });
});
