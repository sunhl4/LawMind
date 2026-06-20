/**
 * @vitest-environment jsdom
 */
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LawmindFileWorkbenchHost } from "./LawmindFileWorkbenchHost";

vi.mock("../FileWorkbench", () => ({
  FileWorkbench: () => <div className="lm-files-explorer-mock">tree</div>,
}));

describe("LawmindFileWorkbenchHost", () => {
  let host: HTMLDivElement;
  let root: Root;
  let explorerHost: HTMLDivElement;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    explorerHost = document.createElement("div");
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    host.remove();
  });

  it("returns null when explorer host is missing", async () => {
    const onExplorerPortaled = vi.fn();
    await act(async () => {
      root.render(
        <LawmindFileWorkbenchHost
          showSidebarWorkbenchFiles
          workspaceDir="/tmp/ws"
          projectDir={null}
          fileExplorerHost={null}
          fileEditorHost={null}
          onExplorerPortaled={onExplorerPortaled}
          onAddToChatContext={() => {}}
          mattersPickList={[]}
          workspaceTreeRefreshKey={0}
          apiBase="http://127.0.0.1:1"
          onOpenUnlinkedMatters={() => {}}
          matterCockpitOpen={false}
          onToggleMatterCockpit={() => {}}
          casesNodeActions={null}
        />,
      );
    });
    expect(host.innerHTML).toBe("");
    expect(onExplorerPortaled).toHaveBeenCalledWith(false);
  });

  it("portals file workbench when explorer host is ready", async () => {
    const onExplorerPortaled = vi.fn();
    await act(async () => {
      root.render(
        <LawmindFileWorkbenchHost
          showSidebarWorkbenchFiles
          workspaceDir="/tmp/ws"
          projectDir={null}
          fileExplorerHost={explorerHost}
          fileEditorHost={null}
          onExplorerPortaled={onExplorerPortaled}
          onAddToChatContext={() => {}}
          mattersPickList={[]}
          workspaceTreeRefreshKey={0}
          apiBase="http://127.0.0.1:1"
          onOpenUnlinkedMatters={() => {}}
          matterCockpitOpen={false}
          onToggleMatterCockpit={() => {}}
          casesNodeActions={null}
        />,
      );
    });
    expect(onExplorerPortaled).toHaveBeenCalledWith(true);
  });
});
