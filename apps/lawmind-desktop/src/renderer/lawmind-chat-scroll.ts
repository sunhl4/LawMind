/**
 * Scroll the workspace chat transcript to the latest execution position.
 * Prefer setting scrollTop on the real overflow containers — scrollIntoView
 * often lands on the top of a long turn when jumping in from elsewhere.
 */
export function scrollChatMessagesToLatest(opts?: { behavior?: ScrollBehavior }): void {
  const behavior = opts?.behavior ?? "smooth";
  const panel = document.getElementById("lawmind-chat-messages-panel");
  if (!panel) {
    return;
  }
  const nested = panel.querySelector<HTMLElement>(".lm-messages-virtual-scroll");
  const targets = nested ? [nested, panel] : [panel];
  for (const el of targets) {
    if (behavior === "smooth" && typeof el.scrollTo === "function") {
      el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    } else {
      el.scrollTop = el.scrollHeight;
    }
  }
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
