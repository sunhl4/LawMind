/**
 * @vitest-environment jsdom
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useChatSessionScrollMemory } from "./useChatSessionScrollMemory";
import {
  clearChatScrollPositions,
  readChatScrollPosition,
} from "./lawmind-chat-scroll-memory";

let heights = { scroll: 1000, client: 400 };
let now = 0;
const rafQueue: FrameRequestCallback[] = [];

function flushRaf(rounds = 4): void {
  for (let round = 0; round < rounds; round += 1) {
    const pending = rafQueue.splice(0, rafQueue.length);
    if (pending.length === 0) {
      return;
    }
    for (const cb of pending) {
      cb(0);
    }
  }
}

function Harness(props: { sessionId: string; transcriptKey: string }) {
  useChatSessionScrollMemory(props);
  return (
    <div
      id="lawmind-chat-messages-panel"
      ref={(el) => {
        if (!el) {
          return;
        }
        Object.defineProperty(el, "scrollHeight", {
          configurable: true,
          get: () => heights.scroll,
        });
        Object.defineProperty(el, "clientHeight", {
          configurable: true,
          get: () => heights.client,
        });
      }}
    />
  );
}

describe("useChatSessionScrollMemory", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    heights = { scroll: 1000, client: 400 };
    now = 0;
    rafQueue.length = 0;
    clearChatScrollPositions();
    vi.spyOn(Date, "now").mockImplementation(() => now);
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      rafQueue.push(cb);
      return rafQueue.length;
    });
    vi.stubGlobal("cancelAnimationFrame", () => {});
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    host.remove();
    clearChatScrollPositions();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  async function render(sessionId: string, transcriptKey: string): Promise<HTMLElement> {
    await act(async () => {
      root.render(<Harness sessionId={sessionId} transcriptKey={transcriptKey} />);
    });
    return host.querySelector<HTMLElement>("#lawmind-chat-messages-panel")!;
  }

  it("starts at the bottom and restores each session's own position", async () => {
    const panel = await render("A", "1");
    // 首次进入：没有记录 → 最新一条。
    expect(panel.scrollTop).toBe(600);

    // 上翻读前文：先用手势取消“贴底跟随”，再记录距底部 350。
    panel.dispatchEvent(new Event("wheel"));
    panel.scrollTop = 250;
    panel.dispatchEvent(new Event("scroll"));
    flushRaf();
    expect(readChatScrollPosition("A")).toEqual({ fromBottom: 350 });

    // 切到 B：B 没记录 → 底部；A 的位置留着。
    const panelB = await render("B", "1");
    expect(panelB.scrollTop).toBe(600);

    // B 长高且仍在恢复窗口内：继续贴底，不用平滑动画。
    heights = { scroll: 1400, client: 400 };
    await render("B", "2");
    expect(panelB.scrollTop).toBe(1000);

    // 超过恢复窗口后切回 A：停在离开时的 250（1400 高度下距底 350）。
    now = 5000;
    const panelBack = await render("A", "2");
    expect(panelBack.scrollTop).toBe(650);
  });

  it("keeps reading position when new messages arrive while scrolled up", async () => {
    const panel = await render("A", "1");
    panel.dispatchEvent(new Event("wheel"));
    panel.scrollTop = 250;
    panel.dispatchEvent(new Event("scroll"));
    flushRaf();

    // 离开恢复窗口，进入「只有贴底才跟随」的正常状态。
    now = 5000;
    heights = { scroll: 1400, client: 400 };
    await render("A", "2");
    expect(panel.scrollTop).toBe(250);

    // 回到底部后，再增长才继续跟随。
    panel.scrollTop = 1000;
    panel.dispatchEvent(new Event("scroll"));
    flushRaf();
    heights = { scroll: 1800, client: 400 };
    await render("A", "3");
    expect(panel.scrollTop).toBe(1400);
  });
});
