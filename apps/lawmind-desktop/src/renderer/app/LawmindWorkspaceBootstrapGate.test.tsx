/**
 * @vitest-environment jsdom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LawmindWorkspaceBootstrapGate } from "./LawmindWorkspaceBootstrapGate";

describe("LawmindWorkspaceBootstrapGate", () => {
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

  it("shows loading state when config is not ready", async () => {
    await act(async () => {
      root.render(<LawmindWorkspaceBootstrapGate error={null} onOpenApiWizard={() => {}} />);
    });
    expect(host.textContent).toContain("正在连接本地服务");
  });

  it("shows preload guidance when bridge is missing", async () => {
    await act(async () => {
      root.render(
        <LawmindWorkspaceBootstrapGate
          error="Preload bridge missing: run pnpm lawmind:desktop"
          onOpenApiWizard={() => {}}
        />,
      );
    });
    expect(host.textContent).toContain("Electron 桌面窗口");
  });
});
