import { useEffect, type RefObject } from "react";

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Trap Tab focus inside a modal container while `active`, and restore the
 * previously focused element when the modal closes.
 */
export function useModalFocusTrap(
  active: boolean,
  containerRef: RefObject<HTMLElement | null>,
  options?: { initialFocusRef?: RefObject<HTMLElement | null> },
): void {
  useEffect(() => {
    if (!active) {
      return;
    }
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const container = containerRef.current;
    const initial = options?.initialFocusRef?.current;
    const focusTarget =
      initial ??
      container?.querySelector<HTMLElement>(FOCUSABLE) ??
      container ??
      null;
    focusTarget?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Tab" || !containerRef.current) {
        return;
      }
      const nodes = Array.from(containerRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => !el.hasAttribute("disabled") && el.offsetParent !== null,
      );
      if (nodes.length === 0) {
        event.preventDefault();
        return;
      }
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      const current = document.activeElement;
      if (event.shiftKey) {
        if (current === first || !containerRef.current.contains(current)) {
          event.preventDefault();
          last.focus();
        }
      } else if (current === last || !containerRef.current.contains(current)) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      if (previous && document.contains(previous)) {
        previous.focus();
      }
    };
  }, [active, containerRef, options?.initialFocusRef]);
}
