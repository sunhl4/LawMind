/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { pinChatMessagesToLatest, scrollChatMessagesToLatest } from "./lawmind-chat-scroll";

/** Deterministic rAF queue so pin frames can be advanced without timers. */
function installManualRaf() {
  const queue: FrameRequestCallback[] = [];
  const raf = vi.fn((cb: FrameRequestCallback) => {
    queue.push(cb);
    return queue.length;
  });
  vi.stubGlobal("requestAnimationFrame", raf);
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  return {
    pending: () => queue.length,
    flush() {
      const pending = queue.splice(0, queue.length);
      for (const cb of pending) {
        cb(0);
      }
    },
  };
}

function makePanel(scrollHeight: number) {
  const panel = document.createElement("div");
  panel.id = "lawmind-chat-messages-panel";
  Object.defineProperty(panel, "scrollHeight", { value: scrollHeight, configurable: true });
  panel.scrollTop = 0;
  panel.scrollTo = vi.fn(({ top }: ScrollToOptions) => {
    panel.scrollTop = top ?? 0;
  }) as unknown as typeof panel.scrollTo;
  document.body.appendChild(panel);
  return panel;
}

describe("scrollChatMessagesToLatest", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
  });

  it("sets scrollTop to scrollHeight on the messages panel", () => {
    const panel = makePanel(2400);

    scrollChatMessagesToLatest({ behavior: "auto" });
    expect(panel.scrollTop).toBe(2400);
  });

  it("also scrolls a nested virtual list container", () => {
    const panel = makePanel(100);

    const nested = document.createElement("div");
    nested.className = "lm-messages-virtual-scroll";
    Object.defineProperty(nested, "scrollHeight", { value: 3000, configurable: true });
    nested.scrollTop = 12;
    nested.scrollTo = vi.fn(({ top }: ScrollToOptions) => {
      nested.scrollTop = top ?? 0;
    }) as unknown as typeof nested.scrollTo;
    panel.appendChild(nested);

    scrollChatMessagesToLatest({ behavior: "auto" });
    expect(nested.scrollTop).toBe(3000);
    expect(panel.scrollTop).toBe(100);
  });
});

describe("pinChatMessagesToLatest", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
  });

  it("lands on the latest turn synchronously (no flash on remount)", () => {
    const raf = installManualRaf();
    const panel = makePanel(2400);

    const cancel = pinChatMessagesToLatest();
    expect(panel.scrollTop).toBe(2400);
    cancel();
    expect(raf.pending()).toBe(1);
  });

  it("keeps following the bottom while the virtual list re-measures rows", () => {
    const raf = installManualRaf();
    const panel = makePanel(1000);
    const nested = document.createElement("div");
    nested.className = "lm-messages-virtual-scroll";
    let height = 2000;
    Object.defineProperty(nested, "scrollHeight", {
      get: () => height,
      configurable: true,
    });
    nested.scrollTop = 0;
    panel.appendChild(nested);

    pinChatMessagesToLatest();
    expect(nested.scrollTop).toBe(2000);

    // Virtualizer measures the tall last turn → total height grows.
    height = 2600;
    raf.flush();
    expect(nested.scrollTop).toBe(2600);

    height = 2750;
    raf.flush();
    expect(nested.scrollTop).toBe(2750);
  });

  it("stops once the transcript is stable", () => {
    const raf = installManualRaf();
    const panel = makePanel(1800);

    pinChatMessagesToLatest({ maxFrames: 30 });
    let flushes = 0;
    while (raf.pending() > 0 && flushes < 40) {
      raf.flush();
      flushes += 1;
    }
    expect(raf.pending()).toBe(0);
    // Settles well before the frame cap, not by exhausting it.
    expect(flushes).toBeLessThan(30);
    expect(panel.scrollTop).toBe(1800);
  });

  it("stops following when the user scrolls the transcript", () => {
    const raf = installManualRaf();
    const panel = makePanel(1000);

    pinChatMessagesToLatest();
    panel.dispatchEvent(new Event("wheel"));
    raf.flush();

    // Listener detached with the pin; further growth is not chased.
    Object.defineProperty(panel, "scrollHeight", { value: 5000, configurable: true });
    raf.flush();
    expect(panel.scrollTop).toBe(1000);
  });

  it("does nothing when the transcript panel is not mounted", () => {
    const raf = installManualRaf();
    const cancel = pinChatMessagesToLatest();
    expect(raf.pending()).toBe(0);
    cancel();
  });
});
