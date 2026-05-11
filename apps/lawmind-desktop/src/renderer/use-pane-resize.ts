import { useCallback, useEffect, useMemo, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import {
  clampComposeHeightPx,
  clampInnerSplitWidthPx,
  clampSidebarWidthPx,
} from "./lawmind-panel-layout.js";

export type PaneWidthRole = "shellSidebar" | "innerSplit";

export function readStoredPaneWidth(
  key: string,
  fallback: number,
  min: number,
  max: number,
  options?: { widthRole?: PaneWidthRole },
): number {
  const widthRole: PaneWidthRole = options?.widthRole ?? "innerSplit";
  const clamp =
    widthRole === "shellSidebar"
      ? (w: number) => clampSidebarWidthPx(w, min, max)
      : (w: number) => clampInnerSplitWidthPx(w, min, max);
  try {
    const raw = localStorage.getItem(key);
    if (!raw) {
      return clamp(fallback);
    }
    const n = Number(raw);
    if (!Number.isFinite(n)) {
      return clamp(fallback);
    }
    return clamp(n);
  } catch {
    return clamp(fallback);
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
  /** `shellSidebar`：应用左栏总宽；默认 `innerSplit`：主区内分栏（对话、案件/审核列表、材料轨等） */
  widthRole?: PaneWidthRole;
};

/**
 * Horizontal pane width (px) with drag-to-resize and localStorage persistence on pointer up.
 */
export function usePaneResizePx(opts: UsePaneResizePxOpts): {
  width: number;
  onResizePointerDown: (e: ReactPointerEvent) => void;
} {
  const { storageKey, defaultWidth, min, max, widthRole = "innerSplit" } = opts;
  const clampW = useMemo(
    () =>
      widthRole === "shellSidebar"
        ? (w: number) => clampSidebarWidthPx(w, min, max)
        : (w: number) => clampInnerSplitWidthPx(w, min, max),
    [widthRole, min, max],
  );
  const [width, setWidth] = useState(() =>
    readStoredPaneWidth(storageKey, defaultWidth, min, max, { widthRole }),
  );

  useEffect(() => {
    const onResize = () => {
      setWidth((prev) => clampW(prev));
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [clampW]);

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
        const next = clampW(startW + (ev.clientX - startX));
        last = next;
        setWidth(next);
      };

      const onUp = (ev: PointerEvent) => {
        target.releasePointerCapture(ev.pointerId);
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);
        const next = clampW(startW + (ev.clientX - startX));
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
    [clampW, storageKey, width],
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
  const clampH = useMemo(() => (h: number) => clampComposeHeightPx(h, min, max), [min, max]);
  const [height, setHeight] = useState(() =>
    readStoredPaneHeight(storageKey, defaultHeight, min, max),
  );

  useEffect(() => {
    const onResize = () => {
      setHeight((prev) => clampH(prev));
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [clampH]);

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
        const next = clampH(startH + (ev.clientY - startY));
        last = next;
        setHeight(next);
      };

      const onUp = (ev: PointerEvent) => {
        target.releasePointerCapture(ev.pointerId);
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);
        const next = clampH(startH + (ev.clientY - startY));
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
    [clampH, storageKey, height],
  );

  return { height, onResizePointerDown };
}
