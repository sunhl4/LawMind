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

  it("不展示端口，只请律师重开 Word", async () => {
    vi.stubGlobal("lawmindDesktop", {
      getConfig: async () => ({
        loopbackPortDrift: { requestedPort: 54881, actualPort: 55102, occupant: "foreign" },
      }),
    });
    Object.defineProperty(window, "lawmindDesktop", {
      configurable: true,
      value: {
        getConfig: async () => ({
          loopbackPortDrift: { requestedPort: 54881, actualPort: 55102, occupant: "foreign" },
        }),
      },
    });
    await render();
    const text = host.textContent ?? "";
    expect(text).toContain("请完全退出 Word");
    expect(text).toContain("重新连接 Word");
    expect(host.querySelector("[data-testid=lm-doctor-addin-port-contract]")?.textContent).not.toContain("已连接");
    expect(text).not.toContain("54881");
    expect(text).not.toContain("55102");
    expect(text).not.toContain("侧载");
  });

  it("清单只存到下载时，不把状态改成已连接", async () => {
    Object.defineProperty(window, "lawmindDesktop", {
      configurable: true,
      value: {
        getConfig: async () => ({
          loopbackPortDrift: { requestedPort: 1, actualPort: 2, occupant: "unknown" },
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
    expect(host.querySelector("[data-testid=lm-doctor-addin-port-contract]")?.textContent).not.toContain("已连接");
  });

  it("另一个 LawMind 占用时不提供改写按钮", async () => {
    Object.defineProperty(window, "lawmindDesktop", {
      configurable: true,
      value: {
        getConfig: async () => ({
          loopbackPortDrift: { requestedPort: 1, actualPort: 2, occupant: "another-lawmind" },
        }),
      },
    });
    await render();
    expect(host.textContent).toContain("请改用已经打开的 LawMind");
    expect(host.querySelector("[data-testid=lm-doctor-addin-resync]")).toBeNull();
  });

  it("端口没有被占用时不占设置页", async () => {
    Object.defineProperty(window, "lawmindDesktop", {
      configurable: true,
      value: {
        getConfig: async () => ({}),
      },
    });
    await render();
    expect(host.querySelector("[data-testid=lm-doctor-word-addin]")).toBeNull();
    expect(host.textContent ?? "").not.toContain("已连接");
    expect(host.textContent ?? "").not.toContain("重新连接");
  });
});
