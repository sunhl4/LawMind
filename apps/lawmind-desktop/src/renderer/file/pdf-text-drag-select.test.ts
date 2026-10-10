/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from "vitest";
import {
  expandMountedPages,
  expandWordRange,
  installPdfTextDragSelect,
  nearestTextCaret,
  offsetInTextNode,
  sanitizePdfCopyText,
} from "./pdf-text-drag-select";

describe("pdf-text-drag-select", () => {
  it("binary-searches an offset using glyph boxes", () => {
    const span = document.createElement("span");
    span.textContent = "ABCD";
    document.body.append(span);
    const text = span.firstChild as Text;

    const rangeProto = Range.prototype as Range & {
      getBoundingClientRect: () => DOMRect;
    };
    const original = rangeProto.getBoundingClientRect;
    rangeProto.getBoundingClientRect = function mockRect(this: Range) {
      const start = this.startOffset;
      return new DOMRect(start * 10, 0, 10, 12);
    };

    try {
      expect(offsetInTextNode(text, 5, 4)).toBe(0);
      expect(offsetInTextNode(text, 25, 4)).toBe(2);
      expect(offsetInTextNode(text, 35, 4)).toBe(3);
    } finally {
      rangeProto.getBoundingClientRect = original;
      span.remove();
    }
  });

  it("finds the nearest span when the pointer is in a gap", () => {
    const layer = document.createElement("div");
    layer.className = "textLayer";
    const a = document.createElement("span");
    a.textContent = "第一行";
    const b = document.createElement("span");
    b.textContent = "第二行";
    layer.append(a, b);
    document.body.append(layer);

    vi.spyOn(a, "getClientRects").mockReturnValue([new DOMRect(0, 0, 80, 14)] as unknown as DOMRectList);
    vi.spyOn(b, "getClientRects").mockReturnValue([new DOMRect(0, 40, 80, 14)] as unknown as DOMRectList);

    const rangeProto = Range.prototype as Range & {
      getBoundingClientRect: () => DOMRect;
    };
    const original = rangeProto.getBoundingClientRect;
    rangeProto.getBoundingClientRect = function mockRect(this: Range) {
      const start = this.startOffset;
      const top = this.startContainer.parentElement === b ? 40 : 0;
      return new DOMRect(start * 12, top, 12, 14);
    };

    try {
      const caret = nearestTextCaret(layer, 8, 22);
      expect(caret?.node.textContent).toBe("第一行");
    } finally {
      rangeProto.getBoundingClientRect = original;
      layer.remove();
    }
  });

  it("expands CJK and Latin word ranges separately", () => {
    expect(expandWordRange("你好世界", 2)).toEqual({ start: 0, end: 4 });
    expect(expandWordRange("hello world", 1)).toEqual({ start: 0, end: 5 });
    // Mixed: Latin run "ABC" at offset 3
    expect(expandWordRange("合同ABC条款", 3)).toEqual({ start: 2, end: 5 });
    // Mixed: CJK after Latin
    expect(expandWordRange("合同ABC条款", 6)).toEqual({ start: 5, end: 7 });
  });

  it("expands mounted pages with a neighbor buffer", () => {
    expect([...expandMountedPages([5], 10, 2)].toSorted((a, b) => a - b)).toEqual([3, 4, 5, 6, 7]);
    expect([...expandMountedPages([], 3, 2)].toSorted((a, b) => a - b)).toEqual([1, 2, 3]);
  });

  it("sanitizes copy text", () => {
    expect(sanitizePdfCopyText("a\u0000b")).toBe("ab");
  });

  it("drives selection on pointer down/move/up", async () => {
    const root = document.createElement("div");
    const slot = document.createElement("div");
    slot.dataset.pdfPage = "1";
    slot.className = "lm-pdf-preview-page-slot";
    const layer = document.createElement("div");
    layer.className = "textLayer";
    const span = document.createElement("span");
    span.textContent = "合同条款";
    layer.append(span);
    slot.append(layer);
    root.append(slot);
    document.body.append(root);

    vi.spyOn(span, "getClientRects").mockReturnValue([new DOMRect(10, 10, 80, 16)] as unknown as DOMRectList);
    vi.spyOn(layer, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 100, 40));
    document.elementsFromPoint = () => [span, layer, slot, root];
    document.caretRangeFromPoint = () => {
      const range = document.createRange();
      range.setStart(span.firstChild as Text, 1);
      range.collapse(true);
      return range;
    };
    const rangeProto = Range.prototype as Range & {
      getBoundingClientRect: () => DOMRect;
    };
    const original = rangeProto.getBoundingClientRect;
    rangeProto.getBoundingClientRect = function mockRect(this: Range) {
      return new DOMRect(this.startOffset * 10, 10, 10, 16);
    };

    const dispose = installPdfTextDragSelect(root);
    try {
      span.dispatchEvent(
        new PointerEvent("pointerdown", { button: 0, clientX: 20, clientY: 14, bubbles: true }),
      );
      document.caretRangeFromPoint = () => {
        const range = document.createRange();
        range.setStart(span.firstChild as Text, 3);
        range.collapse(true);
        return range;
      };
      span.dispatchEvent(
        new PointerEvent("pointermove", { button: 0, buttons: 1, clientX: 60, clientY: 14, bubbles: true }),
      );
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => resolve());
      });
      const sel = document.getSelection();
      expect(sel?.isCollapsed).toBe(false);
      expect(sel?.toString().length).toBeGreaterThan(0);
      span.dispatchEvent(new PointerEvent("pointerup", { button: 0, bubbles: true }));
    } finally {
      dispose();
      rangeProto.getBoundingClientRect = original;
      root.remove();
    }
  });
});
