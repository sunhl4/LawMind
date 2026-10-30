/**
 * @vitest-environment jsdom
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PANE_CHAT_MIRROR_POLL_MS,
  chatSessionMessageFingerprint,
  useLawmindPaneWindowChatMirror,
} from "./useLawmindPaneWindowChatMirror";

const liveState = vi.hoisted(() => ({
  status: null as "running" | null,
}));

vi.mock("../lawmind-chat-trace", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lawmind-chat-trace")>();
  return {
    ...actual,
    fetchChatLiveTurnProgress: async () =>
      liveState.status === "running"
        ? { progress: { status: "running" }, idle: false }
        : { progress: null, idle: true },
  };
});

type ChatRow = { role: "user" | "assistant"; text: string };

const server = vi.hoisted(() => ({
  messages: [] as Array<{ role: "user" | "assistant"; text: string }>,
  sessionReads: 0,
}));

const onReload = vi.hoisted(() => vi.fn());
const onWatch = vi.hoisted(() => vi.fn());

type HarnessProps = {
  loading?: boolean;
  enabled?: boolean;
  sessionId?: string;
};

function Harness({ loading = false, enabled = true, sessionId = "s-1" }: HarnessProps) {
  useLawmindPaneWindowChatMirror({
    enabled,
    apiBase: "http://127.0.0.1:9",
    assistantId: "a-1",
    sessionId,
    loading,
    reloadActiveChatSession: onReload,
    watchSessionLive: onWatch,
  });
  return <div />;
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

async function mount(props: HarnessProps = {}): Promise<{ host: HTMLDivElement; root: Root }> {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(<Harness {...props} />);
  });
  await act(async () => {
    await Promise.resolve();
  });
  return { host, root };
}

describe("useLawmindPaneWindowChatMirror", () => {
  let root: Root | null = null;
  let host: HTMLDivElement | null = null;

  beforeEach(() => {
    vi.useFakeTimers();
    liveState.status = null;
    server.messages = [{ role: "user", text: "开始" }];
    server.sessionReads = 0;
    onReload.mockClear();
    onWatch.mockClear();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url =
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        if (url.includes("/live-turn")) {
          return jsonResponse({ ok: true, status: "idle" });
        }
        server.sessionReads += 1;
        return jsonResponse({ ok: true, messages: server.messages });
      }),
    );
  });

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    root = null;
    host?.remove();
    host = null;
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("records the first snapshot without reloading", async () => {
    ({ host, root } = await mount());
    expect(server.sessionReads).toBeGreaterThan(0);
    expect(onReload).not.toHaveBeenCalled();
  });

  it("reloads when the server session gains messages", async () => {
    ({ host, root } = await mount());
    server.messages = [...server.messages, { role: "assistant", text: "好的" }];

    await act(async () => {
      await vi.advanceTimersByTimeAsync(PANE_CHAT_MIRROR_POLL_MS);
    });

    expect(onReload).toHaveBeenCalledTimes(1);
  });

  it("stays quiet when the conversation did not change", async () => {
    ({ host, root } = await mount());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PANE_CHAT_MIRROR_POLL_MS);
      await vi.advanceTimersByTimeAsync(PANE_CHAT_MIRROR_POLL_MS);
    });
    expect(onReload).not.toHaveBeenCalled();
  });

  it("does not fight a turn streaming in this window", async () => {
    ({ host, root } = await mount({ loading: true }));
    server.messages = [...server.messages, { role: "assistant", text: "流式中" }];

    await act(async () => {
      await vi.advanceTimersByTimeAsync(PANE_CHAT_MIRROR_POLL_MS * 2);
    });

    expect(onReload).not.toHaveBeenCalled();
    expect(onWatch).not.toHaveBeenCalled();
  });

  it("follows a turn started elsewhere through the background watcher once", async () => {
    liveState.status = "running";
    ({ host, root } = await mount());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(PANE_CHAT_MIRROR_POLL_MS * 3);
    });

    expect(onWatch).toHaveBeenCalledTimes(1);
    expect(onWatch).toHaveBeenCalledWith({ sessionId: "s-1", assistantId: "a-1" });
    expect(onReload).not.toHaveBeenCalled();
  });

  it("does nothing when disabled", async () => {
    ({ host, root } = await mount({ enabled: false }));
    server.messages = [...server.messages, { role: "assistant", text: "不该看到" }];
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PANE_CHAT_MIRROR_POLL_MS * 2);
    });
    expect(server.sessionReads).toBe(0);
    expect(onReload).not.toHaveBeenCalled();
  });
});

describe("chatSessionMessageFingerprint", () => {
  it("changes when a message is appended or the last reply grows", () => {
    const one: ChatRow[] = [{ role: "user", text: "开始" }];
    const two: ChatRow[] = [...one, { role: "assistant", text: "" }];
    const growing: ChatRow[] = [{ role: "user", text: "开始" }, { role: "assistant", text: "第一段" }];
    expect(chatSessionMessageFingerprint(one)).not.toBe(chatSessionMessageFingerprint(two));
    expect(chatSessionMessageFingerprint(two)).not.toBe(chatSessionMessageFingerprint(growing));
  });

  it("ignores non-chat rows and malformed payloads", () => {
    expect(chatSessionMessageFingerprint(null)).toBe("");
    expect(chatSessionMessageFingerprint({})).toBe("");
    expect(
      chatSessionMessageFingerprint([
        { role: "system", text: "x" },
        { role: "user", text: "问题" },
      ]),
    ).toBe(chatSessionMessageFingerprint([{ role: "user", text: "问题" }]));
  });
});
