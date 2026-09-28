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
} from "./LawmindSideChatSessions";

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

describe("LawmindSideChatSessions", () => {
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

  it("shows the conversation search and a new-chat button", async () => {
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
    expect(host.querySelector('[data-testid="lm-side-chat-search"]')).toBeTruthy();
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
    const input = host.querySelector('[data-testid="lm-side-chat-search"]') as HTMLInputElement;
    expect(input).toBeTruthy();
    const focus = vi.spyOn(input, "focus");
    await act(async () => {
      window.dispatchEvent(new Event("lawmind:focus-chat-search"));
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });
    expect(focus).toHaveBeenCalled();
  });

  it("keeps the search field after Escape", async () => {
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
    const input = host.querySelector('[data-testid="lm-side-chat-search"]') as HTMLInputElement;
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(host.querySelector('[data-testid="lm-side-chat-search"]')).toBeTruthy();
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
