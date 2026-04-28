import { useCallback, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { clampComposeHeightPx, clampPaneWidthPx } from "./lawmind-panel-layout.js";

export function readStoredPaneWidth(
  key: string,
  fallback: number,
  min: number,
  max: number,
): number {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) {
      return clampPaneWidthPx(fallback, min, max);
    }
    const n = Number(raw);
    if (!Number.isFinite(n)) {
      return clampPaneWidthPx(fallback, min, max);
    }
    return clampPaneWidthPx(n, min, max);
  } catch {
    return clampPaneWidthPx(fallback, min, max);
  }
}

export function readStoredPaneHeight(
  key: string,
  fallback: number,
  min: number,
  max: number,
): number {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) {
      return clampComposeHeightPx(fallback, min, max);
    }
    const n = Number(raw);
    if (!Number.isFinite(n)) {
      return clampComposeHeightPx(fallback, min, max);
    }
    return clampComposeHeightPx(n, min, max);
  } catch {
    return clampComposeHeightPx(fallback, min, max);
  }
}

type UsePaneResizePxOpts = {
  storageKey: string;
  defaultWidth: number;
  min: number;
  max: number;
};

/**
 * Horizontal pane width (px) with drag-to-resize and localStorage persistence on pointer up.
 */
export function usePaneResizePx(opts: UsePaneResizePxOpts): {
  width: number;
  onResizePointerDown: (e: ReactPointerEvent) => void;
} {
  const { storageKey, defaultWidth, min, max } = opts;
  const [width, setWidth] = useState(() =>
    readStoredPaneWidth(storageKey, defaultWidth, min, max),
  );

  const onResizePointerDown = useCallback(
    (e: ReactPointerEvent) => {
      if (e.button !== 0) {
        return;
      }
      e.preventDefault();
      const startX = e.clientX;
      const startW = width;
      const target = e.currentTarget;
      target.setPointerCapture(e.pointerId);
      let last = startW;

      const onMove = (ev: PointerEvent) => {
        const next = clampPaneWidthPx(startW + (ev.clientX - startX), min, max);
        last = next;
        setWidth(next);
      };

      const onUp = (ev: PointerEvent) => {
        target.releasePointerCapture(ev.pointerId);
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);
        const next = clampPaneWidthPx(startW + (ev.clientX - startX), min, max);
        last = next;
        setWidth(next);
        try {
          localStorage.setItem(storageKey, String(last));
        } catch {
          /* ignore quota */
        }
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
    },
    [max, min, storageKey, width],
  );

  return { width, onResizePointerDown };
}

type UsePaneResizeVerticalPxOpts = {
  storageKey: string;
  defaultHeight: number;
  min: number;
  max: number;
};

/** Vertical drag: adjusts height of the bottom pane (drag handle sits above it). */
export function usePaneResizeVerticalPx(opts: UsePaneResizeVerticalPxOpts): {
  height: number;
  onResizePointerDown: (e: ReactPointerEvent) => void;
} {
  const { storageKey, defaultHeight, min, max } = opts;
  const [height, setHeight] = useState(() =>
    readStoredPaneHeight(storageKey, defaultHeight, min, max),
  );

  const onResizePointerDown = useCallback(
    (e: ReactPointerEvent) => {
      if (e.button !== 0) {
        return;
      }
      e.preventDefault();
      const startY = e.clientY;
      const startH = height;
      const target = e.currentTarget;
      target.setPointerCapture(e.pointerId);
      let last = startH;

      const onMove = (ev: PointerEvent) => {
        const next = clampComposeHeightPx(startH + (ev.clientY - startY), min, max);
        last = next;
        setHeight(next);
      };

      const onUp = (ev: PointerEvent) => {
        target.releasePointerCapture(ev.pointerId);
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);
        const next = clampComposeHeightPx(startH + (ev.clientY - startY), min, max);
        last = next;
        setHeight(next);
        try {
          localStorage.setItem(storageKey, String(last));
        } catch {
          /* ignore quota */
        }
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
    },
    [max, min, storageKey, height],
  );

  return { height, onResizePointerDown };
}
