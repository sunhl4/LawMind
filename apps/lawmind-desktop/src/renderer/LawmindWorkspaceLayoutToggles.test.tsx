/**
 * @vitest-environment jsdom
 */
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LawmindWorkspaceLayoutToggles } from "./LawmindWorkspaceLayoutToggles";

describe("LawmindWorkspaceLayoutToggles", () => {
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

  it("renders panel toggles when filesystem bridge is available", async () => {
    await act(async () => {
      root.render(
        <LawmindWorkspaceLayoutToggles
          sidebarCollapsed={false}
          wsShowEditor
          wsShowChat
          canUseFilesystemBridge
          matterCockpitOpen={false}
          onToggleSidebar={vi.fn()}
          onToggleEditor={vi.fn()}
          onToggleChat={vi.fn()}
        />,
      );
    });
    expect(host.querySelector('[aria-label*="编辑区"]')).not.toBeNull();
    expect(host.querySelector('[aria-label*="对话区"]')).not.toBeNull();
  });
});
