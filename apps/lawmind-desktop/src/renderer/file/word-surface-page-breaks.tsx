/**
 * Visual page breaks for the Word surface. Pure render overlay — does not
 * change engine offsets or the docx model.
 */
import { useLayoutEffect, useState, type RefObject } from "react";
import type { WordPageBox } from "../../../../../src/lawmind/drafts/word-surface.ts";

type PageBreak = { page: number; top: number };

const DEFAULT_PAGE_HEIGHT_PX = 1122.52; // A4 at 96dpi

/** Pure helper — exported for tests. */
export function computePageBreaks(
  paras: Array<{ offsetTop: number; offsetHeight: number }>,
  usableHeight: number,
): PageBreak[] {
  if (paras.length === 0 || usableHeight <= 0) {
    return [];
  }
  const origin = paras[0].offsetTop;
  const next: PageBreak[] = [];
  let pageIndex = 1;
  let pageStart = origin;
  for (const para of paras) {
    const top = para.offsetTop;
    const bottom = top + para.offsetHeight;
    while (bottom - pageStart > usableHeight + 0.5 && top - pageStart > 1) {
      pageIndex += 1;
      pageStart += usableHeight;
      next.push({ page: pageIndex, top: pageStart - origin });
    }
  }
  return next;
}

export function usablePageContentHeight(page: WordPageBox | undefined): number {
  return Math.max(
    120,
    DEFAULT_PAGE_HEIGHT_PX - (page?.marginTopPx ?? 96) - (page?.marginBottomPx ?? 96),
  );
}

export function useWordSurfacePageBreaks(
  pageRef: RefObject<HTMLElement | null>,
  page: WordPageBox | undefined,
  deps: unknown[],
): PageBreak[] {
  const [breaks, setBreaks] = useState<PageBreak[]>([]);
  useLayoutEffect(() => {
    const root = pageRef.current;
    if (!root) {
      setBreaks([]);
      return;
    }
    const paras = [...root.querySelectorAll<HTMLElement>(".lm-word-surface-p")].map((el) => ({
      offsetTop: el.offsetTop,
      offsetHeight: el.offsetHeight,
    }));
    setBreaks(computePageBreaks(paras, usablePageContentHeight(page)));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- caller passes render deps
  }, [pageRef, page?.marginTopPx, page?.marginBottomPx, page?.widthPx, ...deps]);
  return breaks;
}

export function WordSurfacePageBreakMarkers(props: { breaks: PageBreak[] }) {
  if (props.breaks.length === 0) {
    return null;
  }
  return (
    <div className="lm-word-page-breaks" aria-hidden="true" data-testid="lm-word-page-breaks">
      {props.breaks.map((row) => (
        <div
          key={`page-break-${row.page}`}
          className="lm-word-page-break"
          style={{ top: row.top }}
          data-testid={`lm-word-page-break-${row.page}`}
        >
          <span className="lm-word-page-break-label">第 {row.page} 页</span>
        </div>
      ))}
    </div>
  );
}
