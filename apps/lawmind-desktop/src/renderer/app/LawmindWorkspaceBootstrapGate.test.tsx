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

  it("renders nothing while connecting (no splash strip)", async () => {
    await act(async () => {
      root.render(<LawmindWorkspaceBootstrapGate error={null} onOpenApiWizard={() => {}} />);
    });
    expect(host.innerHTML).toBe("");
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
    expect(host.textContent).toContain("已安装的 LawMind 桌面应用");
  });
});
