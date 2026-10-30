/**
 * @vitest-environment jsdom
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LawmindWorkspacePaneRoute } from "../lawmind-popout-route";
import { useLawmindPaneWindowController } from "./useLawmindPaneWindowController";
import { requestOpenWorkspaceFile } from "../lawmind-workspace-file-open";
import { rememberDetachedFileTab } from "../lawmind-detached-file-tabs";

vi.mock("../lawmind-workspace-file-open", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lawmind-workspace-file-open")>();
  return { ...actual, requestOpenWorkspaceFile: vi.fn() };
});

type HarnessProps = {
  route?: LawmindWorkspacePaneRoute;
  selectChatSession?: (sessionId: string, assistantId?: string) => void;
  resumeLiveChat?: () => void;
};

function Harness({
  route,
  selectChatSession = () => {},
  resumeLiveChat,
}: HarnessProps) {
  const controller = useLawmindPaneWindowController({
    paneWindow: route,
    configApiBase: "http://127.0.0.1:9",
    mainView: "workspace",
    matterCockpitOpen: false,
    canUseFilesystemBridge: true,
    loading: false,
    setContextMatterId: () => {},
    setSelectedMatterKey: () => {},
    setMatterCockpitOpen: () => {},
    selectChatSession,
    reloadActiveChatSession: () => {},
    resumeLiveChat,
  });
  return (
    <div>
      <span data-testid="state">
        {JSON.stringify({
          sidebarCollapsed: controller.sidebarCollapsed,
          editor: controller.wsShowEditor,
          chat: controller.wsShowChat,
          chatDetached: controller.paneDetach?.chatDetached ?? null,
          middleDetached: controller.paneDetach?.middleDetached ?? null,
        })}
      </span>
      <button
        type="button"
        data-testid="detach-chat"
        onClick={() =>
          controller.paneDetach?.onChatPaneDetached("workspace-pane:chat:current")
        }
      >
        detach
      </button>
      <button
        type="button"
        data-testid="show-chat"
        onClick={() => controller.setWsShowChatRespectingDetach(true)}
      >
        show chat
      </button>
    </div>
  );
}

function readState(host: HTMLElement): {
  sidebarCollapsed: boolean;
  editor: boolean;
  chat: boolean;
  chatDetached: boolean | null;
  middleDetached: boolean | null;
} {
  return JSON.parse(host.querySelector('[data-testid="state"]')?.textContent ?? "{}") as {
    sidebarCollapsed: boolean;
    editor: boolean;
    chat: boolean;
    chatDetached: boolean | null;
    middleDetached: boolean | null;
  };
}

describe("useLawmindPaneWindowController", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    vi.mocked(requestOpenWorkspaceFile).mockClear();
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    host.remove();
    delete window.lawmindDesktop;
  });

  it("forces a chat-only aux window and leaves the main window's stored layout alone", async () => {
    const selectChatSession = vi.fn();
    await act(async () => {
      root.render(
        <Harness
          route={{
            kind: "workspace-pane",
            pane: "chat",
            sessionId: "s-1",
            assistantId: "a-1",
          }}
          selectChatSession={selectChatSession}
        />,
      );
    });
    const state = readState(host);
    expect(state.sidebarCollapsed).toBe(true);
    expect(state.chat).toBe(true);
    expect(state.editor).toBe(false);
    expect(state.chatDetached).toBeNull();
    expect(selectChatSession).toHaveBeenCalledWith("s-1", "a-1");
  });

  it("tracks a detached chat pane and restores it when the aux window closes", async () => {
    let onClosed: ((payload: { key?: string }) => void) | undefined;
    window.lawmindDesktop = {
      onAuxWindowClosed: (handler: (payload: { key?: string }) => void) => {
        onClosed = handler;
        return () => {};
      },
    } as unknown as typeof window.lawmindDesktop;
    const resumeLiveChat = vi.fn();

    await act(async () => {
      root.render(<Harness resumeLiveChat={resumeLiveChat} />);
    });
    expect(readState(host).chatDetached).toBe(false);

    await act(async () => {
      host.querySelector<HTMLButtonElement>('[data-testid="detach-chat"]')?.click();
    });
    expect(readState(host).chatDetached).toBe(true);

    await act(async () => {
      onClosed?.({ key: "workspace-pane:chat:current" });
    });
    expect(readState(host).chatDetached).toBe(false);
    // 回合可能还在跑：收回后主窗口要接上 live trace，而不是只留一次快照。
    expect(resumeLiveChat).toHaveBeenCalledTimes(1);
  });

  it("reopens a tab that was moved out when its aux window closes", async () => {
    let onClosed: ((payload: { key?: string }) => void) | undefined;
    window.lawmindDesktop = {
      onAuxWindowClosed: (handler: (payload: { key?: string }) => void) => {
        onClosed = handler;
        return () => {};
      },
    } as unknown as typeof window.lawmindDesktop;

    rememberDetachedFileTab("workspace-pane:middle:workspace:notes/a.md", {
      root: "workspace",
      relPath: "notes/a.md",
    });

    await act(async () => {
      root.render(<Harness />);
    });
    await act(async () => {
      onClosed?.({ key: "workspace-pane:middle:workspace:notes/a.md" });
    });

    expect(requestOpenWorkspaceFile).toHaveBeenCalledWith("notes/a.md", "workspace");
  });

  it("seeds detached panes from the aux windows still open", async () => {
    window.lawmindDesktop = {
      listAuxWindows: async () => ({
        ok: true,
        keys: ["workspace-pane:chat:s-1", "review-preview:t-1"],
      }),
    } as unknown as typeof window.lawmindDesktop;

    await act(async () => {
      root.render(<Harness />);
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(readState(host).chatDetached).toBe(true);
    expect(readState(host).middleDetached).toBe(false);
  });

  it("reconciles the detached pane away once the window is gone", async () => {
    let keys: string[] = ["workspace-pane:middle:m-1"];
    window.lawmindDesktop = {
      listAuxWindows: async () => ({ ok: true, keys }),
    } as unknown as typeof window.lawmindDesktop;

    await act(async () => {
      root.render(<Harness />);
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(readState(host).middleDetached).toBe(true);

    keys = [];
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      await Promise.resolve();
    });
    expect(readState(host).middleDetached).toBe(false);
  });

  it("keeps a pane the user reopened while its aux window is still open", async () => {
    const keys = ["workspace-pane:chat:s-1"];
    window.lawmindDesktop = {
      listAuxWindows: async () => ({ ok: true, keys }),
    } as unknown as typeof window.lawmindDesktop;

    await act(async () => {
      root.render(<Harness />);
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(readState(host).chatDetached).toBe(true);

    await act(async () => {
      host.querySelector<HTMLButtonElement>('[data-testid="show-chat"]')?.click();
    });
    expect(readState(host).chatDetached).toBe(false);
    expect(readState(host).chat).toBe(true);

    // 主窗口重新获得焦点时只做「收窄」，不能把刚开回来的面板又判成拆出。
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      await Promise.resolve();
    });
    expect(readState(host).chatDetached).toBe(false);
    expect(readState(host).chat).toBe(true);
  });
});
