/**
 * @vitest-environment jsdom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./api-client", () => ({
  apiGetJson: vi.fn(async () => ({ doctor: { license: { status: "trial", trialDaysLeft: 3 } } })),
}));

import { apiGetJson } from "./api-client";
import { LawmindSettingsAccount } from "./LawmindSettingsAccount";

describe("LawmindSettingsAccount", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    vi.mocked(apiGetJson).mockReset();
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("shows a signed-out local plan and the model source without claiming a license", () => {
    const onOpenModels = vi.fn();
    act(() => {
      root.render(
        <LawmindSettingsAccount
          modelConfigured
          modelName="deepseek-v4-flash"
          onOpenModels={onOpenModels}
        />,
      );
    });

    expect(host.querySelector("[data-testid='lm-account-name']")?.textContent).toBe("尚未登录");
    expect(host.querySelector("[data-testid='lm-account-plan']")?.textContent).toBe("本机使用");
    expect(host.querySelector("[data-testid='lm-account-subscription']")?.textContent).toBe("尚未开放");
    expect(host.querySelector("[data-testid='lm-account-license']")?.textContent).toBe("本地服务未就绪");
    expect(host.querySelector("[data-testid='lm-account-model-source']")?.textContent).toBe("自备密钥");
    expect(host.querySelector("[data-testid='lm-account-model-name']")?.textContent).toBe("deepseek-v4-flash");
    expect(host.querySelector("[data-testid='lm-account-included-models']")?.textContent).toBe("未包含");
    expect(host.querySelector("[data-testid='lm-account-usage']")?.textContent).toBe("尚无记录");
    expect(apiGetJson).not.toHaveBeenCalled();

    (host.querySelector("[data-testid='lm-account-open-models']") as HTMLButtonElement).click();
    expect(onOpenModels).toHaveBeenCalledOnce();
    expect(host.querySelector("[data-testid='lm-settings-license']")).toBeNull();
  });

  it("keeps the license holder off the login line and on the license row", () => {
    act(() => {
      root.render(
        <LawmindSettingsAccount
          license={{ status: "licensed", licensee: "甲所" }}
          onOpenModels={() => {}}
        />,
      );
    });
    expect(host.querySelector("[data-testid='lm-account-name']")?.textContent).toBe("尚未登录");
    expect(host.querySelector("[data-testid='lm-account-license']")?.textContent).toBe("已激活 · 甲所");
  });

  it("reads the live license and treats an org platform as the model source", async () => {
    vi.mocked(apiGetJson).mockResolvedValue({
      doctor: { license: { status: "licensed", licensee: "乙所" } },
    });
    await act(async () => {
      root.render(
        <LawmindSettingsAccount
          apiBase="http://127.0.0.1:9"
          license={{ status: "missing" }}
          platformMode="platform_key"
          modelConfigured
          modelName="org-model"
          onOpenModels={() => {}}
        />,
      );
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(apiGetJson).toHaveBeenCalledWith("http://127.0.0.1:9", "/api/health");
    expect(host.querySelector("[data-testid='lm-account-license']")?.textContent).toBe("已激活 · 乙所");
    expect(host.querySelector("[data-testid='lm-account-model-source']")?.textContent).toBe("组织提供");
    expect(host.textContent).toContain("当前模型由组织提供");
  });
});
