/**
 * @vitest-environment jsdom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FileWorkbenchContextMenu } from "./FileWorkbenchContextMenu";

describe("FileWorkbenchContextMenu", () => {
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

  it("exposes role=menu and menuitem actions for a file path", async () => {
    const onAdd = vi.fn();
    const setContextMenu = vi.fn();
    await act(async () => {
      root.render(
        <FileWorkbenchContextMenu
          menuRef={{ current: null }}
          contextMenu={{
            x: 10,
            y: 20,
            root: "workspace",
            path: "notes/a.md",
            kind: "file",
            isRoot: false,
          }}
          setContextMenu={setContextMenu}
          fsClip={null}
          canUseFilesystemBridge
          busy={false}
          onAddToChatContext={onAdd}
          setAddToMatterManualDraft={() => {}}
          setAddToMatterLastError={() => {}}
          setAddToMatterPick={() => {}}
          startCreate={() => {}}
          pasteInto={() => {}}
          copyPath={() => {}}
          cutPath={() => {}}
          startRename={() => {}}
          requestDelete={() => {}}
          doShowInFolder={() => {}}
          refreshDir={() => {}}
        />,
      );
    });
    const menu = host.querySelector('[role="menu"]');
    expect(menu).not.toBeNull();
    const items = host.querySelectorAll('[role="menuitem"]');
    expect(items.length).toBeGreaterThan(3);
    const cite = Array.from(items).find((el) => el.textContent?.includes("在对话中引用"));
    expect(cite).toBeTruthy();
    await act(async () => {
      (cite as HTMLButtonElement).click();
    });
    expect(onAdd).toHaveBeenCalledWith({
      root: "workspace",
      relPath: "notes/a.md",
      kind: "file",
    });
    expect(setContextMenu).toHaveBeenCalledWith(null);
  });
});
