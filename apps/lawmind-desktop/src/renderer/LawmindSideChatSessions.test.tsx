/**
 * @vitest-environment jsdom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  filterSideChatSessions,
  LawmindSideChatSessions,
  mergeSideChatSearchRows,
  pinLiveSideChatSessions,
} from "./LawmindSideChatSessions";
import { setRunningChatSessionIds } from "./lawmind-live-turns";

describe("filterSideChatSessions", () => {
  it("matches title or preview with AND tokens and strips 上周", () => {
    const rows = [
      { sessionId: "a", title: "采购合同审查", lastPreview: "违约金上限" },
      { sessionId: "b", title: "劳动仲裁", lastPreview: "时效" },
    ];
    expect(filterSideChatSessions(rows, "合同").map((r) => r.sessionId)).toEqual(["a"]);
    expect(filterSideChatSessions(rows, "时效").map((r) => r.sessionId)).toEqual(["b"]);
    expect(filterSideChatSessions(rows, "合同 审查").map((r) => r.sessionId)).toEqual(["a"]);
    expect(filterSideChatSessions(rows, "合同 时效").map((r) => r.sessionId)).toEqual([]);
    expect(filterSideChatSessions(rows, "上周合同审查").map((r) => r.sessionId)).toEqual(["a"]);
    expect(filterSideChatSessions(rows, "  ").map((r) => r.sessionId)).toEqual(["a", "b"]);
  });
});

describe("mergeSideChatSearchRows", () => {
  it("keeps remote body hits first and adds local title matches", () => {
    const remote = [{ sessionId: "body", title: "旧审查", lastPreview: "违约金上限" }];
    const local = [
      { sessionId: "body", title: "旧审查" },
      { sessionId: "title", title: "采购合同审查" },
    ];
    expect(mergeSideChatSearchRows(remote, local).map((r) => r.sessionId)).toEqual(["body", "title"]);
    expect(mergeSideChatSearchRows(null, local).map((r) => r.sessionId)).toEqual(["body", "title"]);
  });
});

describe("pinLiveSideChatSessions", () => {
  it("keeps the open chat and a running chat that the matter filter hid", () => {
    const sessions = [
      { sessionId: "old", title: "旧对话", matterId: "m-other" },
      { sessionId: "fresh", title: "新对话", matterId: "m-this" },
    ];
    const scoped = sessions.filter((row) => row.matterId === "m-other");
    const shown = pinLiveSideChatSessions(sessions, scoped, {
      activeSessionId: "fresh",
      runningSessionIds: new Set(["live"]),
    });
    expect(shown.map((row) => row.sessionId)).toEqual(["fresh", "live", "old"]);
    expect(shown.find((row) => row.sessionId === "live")?.title).toBe("新对话");
  });
});

describe("LawmindSideChatSessions", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    setRunningChatSessionIds(new Set());
    act(() => {
      root.unmount();
    });
    host.remove();
  });

  it("keeps search collapsed by default and reveals it from the toggle", async () => {
    await act(async () => {
      root.render(
        <LawmindSideChatSessions
          sessions={[
            { sessionId: "a", title: "采购合同审查", lastPreview: "违约金" },
            { sessionId: "b", title: "劳动仲裁" },
          ]}
          onSelect={() => undefined}
          onNewChat={() => undefined}
          onRename={async () => undefined}
          onDelete={async () => undefined}
        />,
      );
    });
    expect(host.querySelector('[aria-label="新建对话"]')).toBeTruthy();
    expect(host.querySelector('[data-testid="lm-side-chat-search"]')).toBeNull();
    const toggle = host.querySelector('[data-testid="lm-side-chat-search-toggle"]') as HTMLButtonElement;
    expect(toggle).toBeTruthy();
    await act(async () => {
      toggle.click();
    });
    const search = host.querySelector('[data-testid="lm-side-chat-search"]');
    const label = host.querySelector(".lm-section-label");
    expect(search).toBeTruthy();
    expect(host.querySelector(".lm-side-chat-sessions-header [data-testid='lm-side-chat-search']")).toBe(
      search,
    );
    expect(host.querySelector(".lm-side-chat-sessions-body [data-testid='lm-side-chat-search']")).toBeNull();
    expect(label && search && (label.compareDocumentPosition(search) & Node.DOCUMENT_POSITION_FOLLOWING)).toBeTruthy();
    expect(host.querySelector('[data-testid="lm-side-chat-session-a"]')).toBeTruthy();
    expect(host.querySelector('[data-testid="lm-side-chat-session-b"]')).toBeTruthy();
  });

  it("marks a superseded session with 续接", async () => {
    await act(async () => {
      root.render(
        <LawmindSideChatSessions
          sessions={[
            { sessionId: "old", title: "竞业限制解除", forkedToSessionId: "new" },
            { sessionId: "new", title: "竞业限制解除（承前）" },
            { sessionId: "other", title: "劳动仲裁" },
          ]}
          onSelect={() => undefined}
          onNewChat={() => undefined}
          onRename={async () => undefined}
          onDelete={async () => undefined}
        />,
      );
    });
    const chip = host.querySelector('[data-testid="lm-side-chat-session-forked-old"]');
    expect(chip?.textContent).toContain("续接");
    expect(chip?.tagName).toBe("BUTTON");
    // 承前的那条新对话、以及无关对话都不带这个标记。
    expect(host.querySelector('[data-testid="lm-side-chat-session-forked-new"]')).toBeNull();
    expect(host.querySelector('[data-testid="lm-side-chat-session-forked-other"]')).toBeNull();
  });

  it("reveals a compact filter from the jump-chats event", async () => {
    await act(async () => {
      root.render(
        <LawmindSideChatSessions
          sessions={[{ sessionId: "a", title: "采购合同审查", lastPreview: "违约金" }]}
          onSelect={() => undefined}
          onNewChat={() => undefined}
          onRename={async () => undefined}
          onDelete={async () => undefined}
        />,
      );
    });
    expect(host.querySelector('[data-testid="lm-side-chat-search"]')).toBeNull();
    await act(async () => {
      window.dispatchEvent(new Event("lawmind:focus-chat-search"));
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });
    const input = host.querySelector('[data-testid="lm-side-chat-search"]') as HTMLInputElement;
    expect(input).toBeTruthy();
    const focus = vi.spyOn(input, "focus");
    await act(async () => {
      window.dispatchEvent(new Event("lawmind:focus-chat-search"));
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });
    expect(focus).toHaveBeenCalled();
  });

  it("closes the search field on Escape when the query is empty", async () => {
    await act(async () => {
      root.render(
        <LawmindSideChatSessions
          sessions={[{ sessionId: "a", title: "采购合同审查" }]}
          onSelect={() => undefined}
          onNewChat={() => undefined}
          onRename={async () => undefined}
          onDelete={async () => undefined}
        />,
      );
    });
    await act(async () => {
      (host.querySelector('[data-testid="lm-side-chat-search-toggle"]') as HTMLButtonElement).click();
    });
    const input = host.querySelector('[data-testid="lm-side-chat-search"]') as HTMLInputElement;
    expect(input).toBeTruthy();
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(host.querySelector('[data-testid="lm-side-chat-search"]')).toBeNull();
  });

  it("shows the open chat in the list as soon as it exists, before the catalog includes it", async () => {
    await act(async () => {
      root.render(
        <LawmindSideChatSessions
          sessions={[{ sessionId: "old", title: "旧对话", matterId: "m-other" }]}
          activeSessionId="fresh"
          scopeMatterId="m-other"
          knownMatterIds={new Set(["m-other", "m-this"])}
          onSelect={() => undefined}
          onNewChat={() => undefined}
          onRename={async () => undefined}
          onDelete={async () => undefined}
        />,
      );
    });
    expect(host.querySelector('[data-testid="lm-side-chat-session-fresh"]')?.textContent).toContain(
      "新对话",
    );
    expect(host.textContent).not.toContain("这个案件还没有对话");
  });

  it("shows a running chat that is not in the loaded list", async () => {
    setRunningChatSessionIds(new Set(["live"]));
    await act(async () => {
      root.render(
        <LawmindSideChatSessions
          sessions={[{ sessionId: "old", title: "旧对话" }]}
          onSelect={() => undefined}
          onNewChat={() => undefined}
          onRename={async () => undefined}
          onDelete={async () => undefined}
        />,
      );
    });
    expect(host.querySelector('[data-testid="lm-side-chat-session-live"]')?.textContent).toContain(
      "新对话",
    );
    expect(host.textContent).toContain("1 在办");
  });

  it("says the current matter has no chats instead of a blank list", async () => {
    await act(async () => {
      root.render(
        <LawmindSideChatSessions
          sessions={[{ sessionId: "a", title: "别的案件", matterId: "m-other" }]}
          scopeMatterId="m-this"
          knownMatterIds={new Set(["m-this", "m-other"])}
          onSelect={() => undefined}
          onNewChat={() => undefined}
          onRename={async () => undefined}
          onDelete={async () => undefined}
        />,
      );
    });
    expect(host.textContent).toContain("这个案件还没有对话");
    expect(host.querySelector('[data-testid="lm-side-chat-session-a"]')).toBeNull();
  });

  it("opens the continued chat from 续接 without selecting the old one", async () => {
    const onSelect = vi.fn();
    await act(async () => {
      root.render(
        <LawmindSideChatSessions
          sessions={[
            { sessionId: "old", title: "竞业限制解除", forkedToSessionId: "new" },
            { sessionId: "new", title: "竞业限制解除（承前）" },
          ]}
          onSelect={onSelect}
          onNewChat={() => undefined}
          onRename={async () => undefined}
          onDelete={async () => undefined}
        />,
      );
    });
    const chip = host.querySelector('[data-testid="lm-side-chat-session-forked-old"]');
    await act(async () => {
      if (chip instanceof HTMLButtonElement) {
        chip.click();
      }
    });
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith("new");
  });

  it("supports Ctrl multi-select and batch delete without opening each row", async () => {
    const onSelect = vi.fn();
    const onDelete = vi.fn();
    await act(async () => {
      root.render(
        <LawmindSideChatSessions
          sessions={[
            { sessionId: "a", title: "采购合同审查" },
            { sessionId: "b", title: "劳动仲裁" },
            { sessionId: "c", title: "竞业限制" },
          ]}
          activeSessionId="a"
          onSelect={onSelect}
          onNewChat={() => undefined}
          onRename={async () => undefined}
          onDelete={onDelete}
        />,
      );
    });
    const rowA = host.querySelector('[data-testid="lm-side-chat-session-a"]') as HTMLElement;
    const rowC = host.querySelector('[data-testid="lm-side-chat-session-c"]') as HTMLElement;
    await act(async () => {
      rowC.dispatchEvent(
        new MouseEvent("click", { bubbles: true, ctrlKey: true, metaKey: false }),
      );
    });
    expect(onSelect).not.toHaveBeenCalled();
    expect(host.querySelector('[data-testid="lm-side-chat-session-batch"]')?.textContent).toContain(
      "已选 2",
    );
    await act(async () => {
      rowA.dispatchEvent(
        new MouseEvent("click", { bubbles: true, shiftKey: true, ctrlKey: false, metaKey: false }),
      );
    });
    // Shift from the Ctrl-click anchor (c) back to a covers the full list.
    expect(host.querySelector('[data-testid="lm-side-chat-session-batch"]')?.textContent).toContain(
      "已选 3",
    );
    const deleteBtn = host.querySelector(
      '[data-testid="lm-side-chat-session-batch"] button',
    ) as HTMLButtonElement;
    await act(async () => {
      deleteBtn.click();
    });
    expect(onDelete).toHaveBeenCalledWith(["a", "b", "c"]);
  });
});
