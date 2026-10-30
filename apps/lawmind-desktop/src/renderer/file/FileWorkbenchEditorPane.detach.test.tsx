/**
 * @vitest-environment jsdom
 */
import React, { act, type Dispatch, type SetStateAction } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FileWorkbenchEditorPane } from "./FileWorkbenchEditorPane";
import type { OpenFileTab } from "./file-workbench-types";

vi.mock("./XlsxFileView", async () => {
  const React = await import("react");
  return {
    XlsxFileView: (props: { onDirtyChange?: (dirty: boolean) => void }) => {
      React.useEffect(() => {
        props.onDirtyChange?.(true);
      }, [props.onDirtyChange]);
      return React.createElement("div", { "data-testid": "xlsx-mock" });
    },
  };
});

const TEXT_TAB: OpenFileTab = {
  id: "workspace:notes/a.txt",
  root: "workspace",
  path: "notes/a.txt",
  name: "a.txt",
  kind: "text",
  content: "hello",
  savedContent: "hello",
  mtimeMs: 1,
};

function renderPane(opts: {
  tabs?: OpenFileTab[];
  closeTab?: (id: string) => void;
  setError?: Dispatch<SetStateAction<string | null>>;
} = {}): { host: HTMLDivElement; root: Root } {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  const noop = () => {};
  const tabs = opts.tabs ?? [TEXT_TAB];
  act(() => {
    root.render(
      <FileWorkbenchEditorPane
        tabs={tabs}
        activeTabId={tabs[0]?.id ?? null}
        setActiveTabId={noop}
        activeTab={tabs[0] ?? null}
        activeDirty={false}
        busy={false}
        setError={opts.setError ?? noop}
        closeTab={opts.closeTab ?? noop}
        updateActiveContent={noop}
        saveActive={noop}
        saveActiveAs={noop}
        doShowInFolder={noop}
        apiBase="http://127.0.0.1:9"
        workspaceDir="/ws"
        projectDir={null}
      />,
    );
  });
  return { host, root };
}

describe("FileWorkbenchEditorPane tab drag-out", () => {
  let roots: Array<{ host: HTMLDivElement; root: Root }> = [];

  beforeEach(() => {
    window.lawmindDesktop = {
      openAuxWindow: vi.fn(async () => ({
        ok: true,
        key: "workspace-pane:middle:workspace:notes/a.txt",
      })),
    } as unknown as typeof window.lawmindDesktop;
  });

  afterEach(() => {
    for (const { host, root } of roots) {
      act(() => root.unmount());
      host.remove();
    }
    roots = [];
    window.location.hash = "";
    delete window.lawmindDesktop;
  });

  it("opens the dragged file in a middle pane window and moves the tab out", async () => {
    const closeTab = vi.fn();
    const rendered = renderPane({ closeTab });
    roots.push(rendered);
    const tab = rendered.host.querySelector<HTMLElement>(".lm-file-tab");
    expect(tab).not.toBeNull();

    await act(async () => {
      tab?.dispatchEvent(
        new MouseEvent("pointerdown", { bubbles: true, button: 0, clientX: 10, clientY: 10 }),
      );
      tab?.dispatchEvent(
        new MouseEvent("pointermove", { bubbles: true, clientX: 120, clientY: 10 }),
      );
      tab?.dispatchEvent(
        new MouseEvent("pointerup", { bubbles: true, clientX: 120, clientY: 10 }),
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(window.lawmindDesktop?.openAuxWindow).toHaveBeenCalledWith({
      kind: "workspace-pane",
      pane: "middle",
      title: "a.txt",
      middleView: "file",
      relPath: "notes/a.txt",
      root: "workspace",
    });
    expect(closeTab).toHaveBeenCalledWith(TEXT_TAB.id);
  });

  it("does not move a dirty text tab (unsaved buffer would be lost)", async () => {
    const closeTab = vi.fn();
    const setError = vi.fn();
    const dirty: OpenFileTab = { ...TEXT_TAB, content: "hello edited" };
    const rendered = renderPane({ tabs: [dirty], closeTab, setError });
    roots.push(rendered);
    const tab = rendered.host.querySelector<HTMLElement>(".lm-file-tab");

    await act(async () => {
      tab?.dispatchEvent(
        new MouseEvent("pointerdown", { bubbles: true, button: 0, clientX: 10, clientY: 10 }),
      );
      tab?.dispatchEvent(
        new MouseEvent("pointermove", { bubbles: true, clientX: 120, clientY: 10 }),
      );
      tab?.dispatchEvent(
        new MouseEvent("pointerup", { bubbles: true, clientX: 120, clientY: 10 }),
      );
      await Promise.resolve();
    });

    expect(window.lawmindDesktop?.openAuxWindow).not.toHaveBeenCalled();
    expect(closeTab).not.toHaveBeenCalled();
    expect(setError).not.toHaveBeenCalled();
  });

  it("does not move an xlsx tab while cells have unsaved edits", async () => {
    const xlsxTab: OpenFileTab = {
      id: "workspace:book.xlsx",
      root: "workspace",
      path: "book.xlsx",
      name: "book.xlsx",
      kind: "xlsx",
      content: "",
      savedContent: "",
      mtimeMs: 1,
    };
    const closeTab = vi.fn();
    const rendered = renderPane({ tabs: [xlsxTab], closeTab });
    roots.push(rendered);
    // 让 XlsxFileView（mock）把自己的未保存状态报给父级。
    await act(async () => {
      await Promise.resolve();
    });
    const tab = rendered.host.querySelector<HTMLElement>(".lm-file-tab");

    await act(async () => {
      tab?.dispatchEvent(
        new MouseEvent("pointerdown", { bubbles: true, button: 0, clientX: 10, clientY: 10 }),
      );
      tab?.dispatchEvent(
        new MouseEvent("pointermove", { bubbles: true, clientX: 120, clientY: 10 }),
      );
      tab?.dispatchEvent(
        new MouseEvent("pointerup", { bubbles: true, clientX: 120, clientY: 10 }),
      );
      await Promise.resolve();
    });

    expect(window.lawmindDesktop?.openAuxWindow).not.toHaveBeenCalled();
    expect(closeTab).not.toHaveBeenCalled();
  });

  it("does not drag a tab out from an aux pane window (its key is that window itself)", async () => {
    window.location.hash =
      "#lm-popout=workspace-pane&pane=middle&middleView=file&relPath=notes%2Fa.txt&root=workspace";
    const closeTab = vi.fn();
    const rendered = renderPane({ closeTab });
    roots.push(rendered);
    const tab = rendered.host.querySelector<HTMLElement>(".lm-file-tab");

    await act(async () => {
      tab?.dispatchEvent(
        new MouseEvent("pointerdown", { bubbles: true, button: 0, clientX: 10, clientY: 10 }),
      );
      tab?.dispatchEvent(
        new MouseEvent("pointermove", { bubbles: true, clientX: 120, clientY: 10 }),
      );
      tab?.dispatchEvent(
        new MouseEvent("pointerup", { bubbles: true, clientX: 120, clientY: 10 }),
      );
      await Promise.resolve();
    });

    expect(window.lawmindDesktop?.openAuxWindow).not.toHaveBeenCalled();
    expect(closeTab).not.toHaveBeenCalled();
  });
});
