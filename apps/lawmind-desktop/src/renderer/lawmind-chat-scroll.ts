/**
 * Chat transcript scroll helpers.
 *
 * The transcript lives in `#lawmind-chat-messages-panel`; when the row count is
 * high enough the messages render inside a nested `.lm-messages-virtual-scroll`
 * overflow host, which then becomes the real scroller.
 *
 * The chat pane is unmounted whenever another main view (在办 / 文书台 / 会议室),
 * the settings panel, or the editor-only workspace layout is shown. On remount
 * `scrollTop` resets to 0, so the transcript used to open on the very first
 * message and the lawyer had to scroll down by hand. `pinChatMessagesToLatest`
 * lands on the latest turn and keeps following the bottom for a few frames while
 * the virtualizer re-measures row heights.
 */

const MESSAGES_PANEL_ID = "lawmind-chat-messages-panel";
const VIRTUAL_SCROLL_SELECTOR = ".lm-messages-virtual-scroll";

/** Overflow hosts to scroll, innermost (virtual list) first. */
export function chatMessagesScrollContainers(): HTMLElement[] {
  const panel = document.getElementById(MESSAGES_PANEL_ID);
  if (!panel) {
    return [];
  }
  const nested = panel.querySelector<HTMLElement>(VIRTUAL_SCROLL_SELECTOR);
  return nested ? [nested, panel] : [panel];
}

/**
 * Jump an overflow host to its bottom without animation.
 *
 * `.lm-messages` sets `scroll-behavior: smooth`, which would otherwise animate
 * (and delay) a programmatic scroll; on remount the transcript must already be
 * at the latest turn on the first painted frame.
 *
 * `fromBottom` 用于恢复「上次离开时距底部多远」：0 = 最新一条，非 0 = 律师当时
 * 正在上翻阅读。用距底部的距离而不是绝对 scrollTop，虚拟列表重新量高时位置仍对。
 */
function scrollElementToBottomInstant(el: HTMLElement, fromBottom = 0): void {
  const previousBehavior = el.style.scrollBehavior;
  el.style.scrollBehavior = "auto";
  try {
    const target = el.scrollHeight - el.clientHeight - Math.max(0, fromBottom);
    el.scrollTop = Math.max(0, target);
  } finally {
    el.style.scrollBehavior = previousBehavior;
  }
}

/**
 * Scroll the workspace chat transcript to the latest execution position.
 * Prefer setting scrollTop on the real overflow containers — scrollIntoView
 * often lands on the top of a long turn when jumping in from elsewhere.
 *
 * 默认瞬时：切会话/深链都不希望出现长距离平滑滑动。需要动画的调用方显式传
 * `behavior: "smooth"`。
 */
export function scrollChatMessagesToLatest(opts?: { behavior?: ScrollBehavior }): void {
  const behavior = opts?.behavior ?? "auto";
  for (const el of chatMessagesScrollContainers()) {
    if (behavior === "smooth" && typeof el.scrollTo === "function") {
      el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    } else {
      // 不能用裸 scrollTop：`.lm-messages` 的 CSS smooth 会把赋值也做成动画。
      scrollElementToBottomInstant(el);
    }
  }
}

/**
 * Land on the latest turn and stay pinned while the transcript settles.
 *
 * A single scroll is not enough with the virtual list: jumping to the bottom
 * renders the last rows, `measureElement` corrects their estimated heights, and
 * the total height grows — leaving the viewport short of the newest output. This
 * follows the bottom frame by frame until `scrollTop`/`scrollHeight` are stable,
 * then stops. It is instant rather than smooth so a remounted pane never flashes
 * the top of the conversation, and it aborts as soon as the user scrolls.
 *
 * @returns cancel function (also called automatically once settled).
 */
export function pinChatMessagesToLatest(opts?: {
  /** 距底部的偏移；0 = 最新一条。恢复会话位置时用保存的「距底部」值。 */
  fromBottom?: number;
  maxFrames?: number;
  minFrames?: number;
}): () => void {
  const maxFrames = opts?.maxFrames ?? 30;
  const fromBottom = Math.max(0, opts?.fromBottom ?? 0);
  // Never settle during the first frames: the virtualizer delivers its measured
  // row heights a couple of frames after the jump, and bailing out before then
  // would leave the viewport short of the newest output.
  const minFrames = opts?.minFrames ?? 6;
  const stableFramesToSettle = 3;
  let cancelled = false;
  let frame = 0;
  let stableFrames = 0;
  let lastMetrics = "";
  const detachListeners: Array<() => void> = [];

  const cancel = () => {
    if (cancelled) {
      return;
    }
    cancelled = true;
    for (const detach of detachListeners) {
      detach();
    }
    detachListeners.length = 0;
  };

  const watchUserIntent = (containers: HTMLElement[]) => {
    if (detachListeners.length > 0) {
      return;
    }
    for (const el of containers) {
      const stop = () => cancel();
      // 律师一动手就停：不跟他抢滚动条。
      //
      // 覆盖口径（此前只有 wheel / touchstart，键盘与拖滚动条这两类**不**取消，
      // 于是「上翻看 §3」的律师在重挂载后最多 30 帧内会被拽回底部）：
      //  - 滚轮 / 触摸拖动；
      //  - 拖滚动条（mousedown 落在滚动容器上）；
      //  - 键盘翻页（PageUp/PageDown/Home/End/↑/↓ 与带修饰键的同类）。
      const onKeydown = (e: KeyboardEvent) => {
        if (
          e.key === "PageUp" ||
          e.key === "PageDown" ||
          e.key === "Home" ||
          e.key === "End" ||
          e.key === "ArrowUp" ||
          e.key === "ArrowDown" ||
          e.key === " " ||
          e.key === "Spacebar"
        ) {
          cancel();
        }
      };
      el.addEventListener("wheel", stop, { passive: true });
      el.addEventListener("touchstart", stop, { passive: true });
      el.addEventListener("mousedown", stop, { passive: true });
      el.addEventListener("keydown", onKeydown);
      detachListeners.push(() => {
        el.removeEventListener("wheel", stop);
        el.removeEventListener("touchstart", stop);
        el.removeEventListener("mousedown", stop);
        el.removeEventListener("keydown", onKeydown);
      });
    }
  };

  const tick = () => {
    if (cancelled) {
      return;
    }
    const containers = chatMessagesScrollContainers();
    if (containers.length === 0) {
      cancel();
      return;
    }
    watchUserIntent(containers);
    for (const el of containers) {
      scrollElementToBottomInstant(el, fromBottom);
    }
    const metrics = containers.map((el) => `${el.scrollTop}:${el.scrollHeight}`).join("|");
    stableFrames = metrics === lastMetrics ? stableFrames + 1 : 0;
    lastMetrics = metrics;
    frame += 1;
    const settled = frame >= minFrames && stableFrames >= stableFramesToSettle;
    if (settled || frame >= maxFrames) {
      cancel();
      return;
    }
    requestAnimationFrame(tick);
  };

  // First tick runs synchronously so a caller inside a layout effect is already
  // at the latest turn for the very first paint; later ticks follow the
  // virtualizer re-measuring tall rows.
  tick();
  return cancel;
}

/** Double-rAF so layout/message paint finishes after session switch. */
export function scheduleScrollChatMessagesToLatest(opts?: { behavior?: ScrollBehavior }): () => void {
  let cancelled = false;
  const outer = requestAnimationFrame(() => {
    const inner = requestAnimationFrame(() => {
      if (!cancelled) {
        scrollChatMessagesToLatest(opts);
      }
    });
    if (cancelled) {
      cancelAnimationFrame(inner);
    }
  });
  return () => {
    cancelled = true;
    cancelAnimationFrame(outer);
  };
}
