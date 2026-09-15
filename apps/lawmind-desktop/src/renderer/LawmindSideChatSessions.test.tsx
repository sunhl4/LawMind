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

  it("shows a search field when there are conversations", async () => {
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
    expect(host.querySelector('[data-testid="lm-side-chat-search"]')).toBeTruthy();
    expect(host.querySelector('[data-testid="lm-side-chat-session-a"]')).toBeTruthy();
    expect(host.querySelector('[data-testid="lm-side-chat-session-b"]')).toBeTruthy();
  });

  it("focuses the search field from the jump-chats event", async () => {
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
    const focus = vi.spyOn(input, "focus");
    await act(async () => {
      window.dispatchEvent(new Event("lawmind:focus-chat-search"));
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });
    expect(focus).toHaveBeenCalled();
  });
});
