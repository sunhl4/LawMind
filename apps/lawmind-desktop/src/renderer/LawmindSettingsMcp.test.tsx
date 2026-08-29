/**
 * @vitest-environment jsdom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const apiGetJson = vi.fn();
const apiSendJson = vi.fn();

vi.mock("./api-client", () => ({
  apiGetJson: (...args: unknown[]) => apiGetJson(...args),
  apiSendJson: (...args: unknown[]) => apiSendJson(...args),
  errorMessage: (e: unknown, f: string) => (e instanceof Error ? e.message : f),
}));

import { LawmindSettingsMcp } from "./LawmindSettingsMcp";

describe("LawmindSettingsMcp", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    apiGetJson.mockResolvedValue({
      ok: true,
      highSecurityMode: false,
      servers: [
        {
          id: "mock",
          label: "Mock",
          transport: "stdio",
          command: "node",
          enabled: true,
          allowWrites: false,
        },
      ],
    });
    apiSendJson.mockResolvedValue({ ok: true, tools: [{ name: "echo_note", exposed: true }] });
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    host.remove();
    vi.clearAllMocks();
  });

  it("lists servers and can test connectivity", async () => {
    await act(async () => {
      root.render(<LawmindSettingsMcp apiBase="http://127.0.0.1:9" />);
    });
    expect(host.querySelector("[data-testid='lm-mcp-row-mock']")?.textContent).toContain("Mock");
    expect(host.querySelector("[data-testid='lm-mcp-add']")?.textContent).toContain("本地程序");
    expect(host.querySelector("[data-testid='lm-mcp-add']")?.textContent).toContain("网络地址");
    await act(async () => {
      (host.querySelector("[data-testid='lm-mcp-row-mock'] button"))?.click();
    });
  });
});
