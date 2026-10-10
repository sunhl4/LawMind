/**
 * Word-like click-and-drag text selection for pdf.js text layers.
 *
 * We fully own the Selection (caretRangeFromPoint + nearest-span fallback).
 * pdf.js `.endOfContent` is left inert (`pointer-events: none`) so its
 * selectionchange workaround cannot fight this path.
 */

export type TextCaret = { node: Node; offset: number };

const CJK_CHAR = /[\u3400-\u9FFF\uF900-\uFAFF\u3040-\u30FF\uAC00-\uD7AF]/;
const LATIN_WORD = /[A-Za-z0-9_]/;

function pageHostOf(layer: HTMLElement): HTMLElement | null {
  return layer.closest("[data-pdf-page]");
}

function pageNumberOf(layer: HTMLElement): number | null {
  const host = pageHostOf(layer);
  if (!host) {
    return null;
  }
  const n = Number(host.dataset.pdfPage);
  return Number.isFinite(n) ? n : null;
}

function layersNear(root: HTMLElement, around: HTMLElement | null): HTMLElement[] {
  const all = [...root.querySelectorAll<HTMLElement>(".lm-pdf-preview-page-slot .textLayer")];
  if (!around) {
    return all;
  }
  const n = pageNumberOf(around);
  if (n == null) {
    return all;
  }
  const nearby = all.filter((layer) => {
    const pn = pageNumberOf(layer);
    return pn != null && Math.abs(pn - n) <= 1;
  });
  return nearby.length > 0 ? nearby : all;
}

function textLayerFromPoint(
  root: HTMLElement,
  x: number,
  y: number,
  hint: HTMLElement | null,
): HTMLElement | null {
  const stack = document.elementsFromPoint(x, y);
  for (const el of stack) {
    if (!(el instanceof HTMLElement)) {
      continue;
    }
    const layer = el.classList.contains("textLayer") ? el : el.closest(".textLayer");
    if (layer instanceof HTMLElement && root.contains(layer)) {
      return layer;
    }
  }
  const candidates = layersNear(root, hint);
  let best: { layer: HTMLElement; dist: number } | null = null;
  for (const layer of candidates) {
    const rect = layer.getBoundingClientRect();
    const cx = Math.min(Math.max(x, rect.left), rect.right);
    const cy = Math.min(Math.max(y, rect.top), rect.bottom);
    const dist = (x - cx) * (x - cx) + (y - cy) * (y - cy);
    if (!best || dist < best.dist) {
      best = { layer, dist };
    }
  }
  return best?.layer ?? null;
}

function caretFromNative(layer: HTMLElement, x: number, y: number): TextCaret | null {
  const range = document.caretRangeFromPoint?.(x, y);
  if (!range || !layer.contains(range.startContainer)) {
    return null;
  }
  // Ignore hits that landed on the inert endOfContent div.
  if (
    range.startContainer instanceof Element &&
    range.startContainer.classList.contains("endOfContent")
  ) {
    return null;
  }
  if (
    range.startContainer.parentElement?.classList.contains("endOfContent")
  ) {
    return null;
  }
  return { node: range.startContainer, offset: range.startOffset };
}

/** Binary-search the character offset in a text node closest to clientX. */
export function offsetInTextNode(node: Text, clientX: number, clientY: number): number {
  const text = node.textContent ?? "";
  if (text.length <= 1) {
    return 0;
  }
  const range = document.createRange();
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    range.setStart(node, mid);
    range.setEnd(node, Math.min(mid + 1, text.length));
    const rect = range.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) {
      hi = mid;
      continue;
    }
    const midX = rect.left + rect.width / 2;
    if (clientX > midX) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  if (lo > 0 && lo < text.length) {
    range.setStart(node, lo - 1);
    range.setEnd(node, lo);
    const prev = range.getBoundingClientRect();
    range.setStart(node, lo);
    range.setEnd(node, lo + 1);
    const next = range.getBoundingClientRect();
    if (Math.abs(clientX - (prev.left + prev.width)) < Math.abs(clientX - next.left)) {
      return lo;
    }
  }
  void clientY;
  return lo;
}

export function nearestTextCaret(layer: HTMLElement, x: number, y: number): TextCaret | null {
  const spans = layer.querySelectorAll("span");
  let best: { dist: number; node: Text; offset: number } | null = null;
  for (const span of spans) {
    if (span.classList.contains("markedContent") || span.getAttribute("role") === "img") {
      continue;
    }
    const textNode = span.firstChild;
    if (!textNode || textNode.nodeType !== Node.TEXT_NODE) {
      continue;
    }
    const rects = span.getClientRects();
    for (const rect of rects) {
      if (rect.width <= 0 && rect.height <= 0) {
        continue;
      }
      const cx = Math.min(Math.max(x, rect.left), rect.right);
      const cy = Math.min(Math.max(y, rect.top), rect.bottom);
      const dist = (x - cx) * (x - cx) + (y - cy) * (y - cy);
      if (best && dist > best.dist) {
        continue;
      }
      const probeX = x <= rect.left ? rect.left + 1 : x >= rect.right ? rect.right - 1 : x;
      const offset = offsetInTextNode(textNode as Text, probeX, y);
      best = { dist, node: textNode as Text, offset };
    }
  }
  return best ? { node: best.node, offset: best.offset } : null;
}

export function resolveTextCaret(
  root: HTMLElement,
  x: number,
  y: number,
  hint: HTMLElement | null = null,
): TextCaret | null {
  const layer = textLayerFromPoint(root, x, y, hint);
  if (!layer) {
    return null;
  }
  const native = caretFromNative(layer, x, y);
  if (native) {
    return native;
  }
  return nearestTextCaret(layer, x, y);
}

export function expandWordRange(text: string, offset: number): { start: number; end: number } {
  if (text.length === 0) {
    return { start: 0, end: 0 };
  }
  let i = Math.min(Math.max(offset, 0), text.length);
  if (i === text.length) {
    i -= 1;
  }
  const ch = text[i] ?? "";
  if (/\s/.test(ch)) {
    return { start: i, end: i + 1 };
  }
  let start = i;
  let end = i + 1;
  if (CJK_CHAR.test(ch)) {
    while (start > 0 && CJK_CHAR.test(text[start - 1] ?? "")) {
      start -= 1;
    }
    while (end < text.length && CJK_CHAR.test(text[end] ?? "")) {
      end += 1;
    }
  } else if (LATIN_WORD.test(ch)) {
    while (start > 0 && LATIN_WORD.test(text[start - 1] ?? "")) {
      start -= 1;
    }
    while (end < text.length && LATIN_WORD.test(text[end] ?? "")) {
      end += 1;
    }
  }
  return { start, end };
}

function applySelection(anchor: TextCaret, focus: TextCaret): void {
  const selection = document.getSelection();
  if (!selection) {
    return;
  }
  try {
    selection.setBaseAndExtent(anchor.node, anchor.offset, focus.node, focus.offset);
  } catch {
    /* DOM may churn during page redraw */
  }
}

function expandToWord(caret: TextCaret): void {
  if (caret.node.nodeType !== Node.TEXT_NODE) {
    return;
  }
  const text = caret.node.textContent ?? "";
  const { start, end } = expandWordRange(text, caret.offset);
  document.getSelection()?.setBaseAndExtent(caret.node, start, caret.node, end);
}

function layerOfCaret(caret: TextCaret): HTMLElement | null {
  const el = caret.node instanceof Element ? caret.node : caret.node.parentElement;
  return el?.closest(".textLayer") ?? null;
}

/** Strip PDF nulls and NFC-normalize (same intent as pdf.js copy path). */
export function sanitizePdfCopyText(text: string): string {
  return text.replaceAll("\0", "").normalize("NFC");
}

/** Expand mounted-page set with ±buffer neighbors (clamped). */
export function expandMountedPages(
  visible: Iterable<number>,
  pageCount: number,
  buffer = 2,
): Set<number> {
  const next = new Set<number>();
  for (const n of visible) {
    for (let i = n - buffer; i <= n + buffer; i += 1) {
      if (i >= 1 && i <= pageCount) {
        next.add(i);
      }
    }
  }
  if (next.size === 0 && pageCount > 0) {
    for (let i = 1; i <= Math.min(pageCount, buffer + 1); i += 1) {
      next.add(i);
    }
  }
  return next;
}

/**
 * Install Word-like drag selection on a PDF pages scroller.
 * Returns a disposer.
 */
export function installPdfTextDragSelect(root: HTMLElement): () => void {
  let anchor: TextCaret | null = null;
  let hintLayer: HTMLElement | null = null;
  let dragging = false;
  let pointerId: number | null = null;
  let pendingX = 0;
  let pendingY = 0;
  let raf = 0;

  const flushMove = () => {
    raf = 0;
    if (!dragging || !anchor) {
      return;
    }
    const focus = resolveTextCaret(root, pendingX, pendingY, hintLayer);
    if (!focus) {
      return;
    }
    hintLayer = layerOfCaret(focus);
    applySelection(anchor, focus);
  };

  const onPointerDown = (event: PointerEvent) => {
    if (event.button !== 0 || event.detail > 1) {
      return;
    }
    const target = event.target;
    if (!(target instanceof Element) || !target.closest("[data-pdf-page]")) {
      return;
    }
    const caret = resolveTextCaret(root, event.clientX, event.clientY, hintLayer);
    if (!caret) {
      return;
    }

    // Shift+click: extend from the current selection anchor (Word-like).
    if (event.shiftKey) {
      const selection = document.getSelection();
      if (selection && selection.anchorNode) {
        event.preventDefault();
        applySelection({ node: selection.anchorNode, offset: selection.anchorOffset }, caret);
        hintLayer = layerOfCaret(caret);
        return;
      }
    }

    event.preventDefault();
    dragging = true;
    pointerId = event.pointerId;
    anchor = caret;
    hintLayer = layerOfCaret(caret);
    applySelection(caret, caret);
    try {
      root.setPointerCapture(event.pointerId);
    } catch {
      /* capture optional */
    }
  };

  const onPointerMove = (event: PointerEvent) => {
    if (!dragging || !anchor) {
      return;
    }
    event.preventDefault();
    pendingX = event.clientX;
    pendingY = event.clientY;
    if (raf === 0) {
      raf = requestAnimationFrame(flushMove);
    }
  };

  const endDrag = (event?: PointerEvent) => {
    if (!dragging) {
      return;
    }
    dragging = false;
    anchor = null;
    if (raf) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
    if (event && pointerId !== null) {
      try {
        root.releasePointerCapture(pointerId);
      } catch {
        /* already released */
      }
    }
    pointerId = null;
  };

  const onDblClick = (event: MouseEvent) => {
    if (event.button !== 0) {
      return;
    }
    const target = event.target;
    if (!(target instanceof Element) || !target.closest("[data-pdf-page]")) {
      return;
    }
    const caret = resolveTextCaret(root, event.clientX, event.clientY, hintLayer);
    if (!caret) {
      return;
    }
    event.preventDefault();
    expandToWord(caret);
    hintLayer = layerOfCaret(caret);
  };

  const onCopy = (event: ClipboardEvent) => {
    const selection = document.getSelection();
    if (!selection || selection.isCollapsed || !root.contains(selection.anchorNode)) {
      return;
    }
    const text = sanitizePdfCopyText(selection.toString());
    if (!text || !event.clipboardData) {
      return;
    }
    event.clipboardData.setData("text/plain", text);
    event.preventDefault();
  };

  root.addEventListener("pointerdown", onPointerDown);
  root.addEventListener("pointermove", onPointerMove);
  root.addEventListener("pointerup", endDrag);
  root.addEventListener("pointercancel", endDrag);
  root.addEventListener("dblclick", onDblClick);
  root.addEventListener("copy", onCopy);

  return () => {
    endDrag();
    root.removeEventListener("pointerdown", onPointerDown);
    root.removeEventListener("pointermove", onPointerMove);
    root.removeEventListener("pointerup", endDrag);
    root.removeEventListener("pointercancel", endDrag);
    root.removeEventListener("dblclick", onDblClick);
    root.removeEventListener("copy", onCopy);
  };
}
