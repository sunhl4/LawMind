/**
 * Middle-column PDF preview.
 *
 * Pages use pdf.js PDFPageView for glyph-aligned text layers. Selection is
 * owned by `installPdfTextDragSelect` (Word-like drag). Only pages near the
 * viewport mount a live PDFPageView to keep memory in check.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AnnotationMode, getDocument, GlobalWorkerOptions, type PDFDocumentProxy } from "pdfjs-dist";
import { EventBus, PDFPageView, RenderingStates } from "pdfjs-dist/web/pdf_viewer.mjs";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { errorMessage, fetchApi, fetchWithLoopbackAuthRetry } from "../api-client";
import type { OpenFileTab, RootKey } from "./file-workbench-types";
import { fitViewerScale, PDF_TO_CSS_UNITS } from "./pdf-preview-scale";
import { expandMountedPages, installPdfTextDragSelect } from "./pdf-text-drag-select";
import { PreviewCommonActions, type PreviewHeaderActions } from "./preview-registry";

/** Re-export for callers that historically imported from this module. */
export { fitViewerScale };

export type PdfFileViewProps = {
  apiBase: string;
  tab: OpenFileTab;
  actions: PreviewHeaderActions;
};

const MAX_PREVIEW_PAGES = 80;
const PAGE_BUFFER = 2;

const stubL10n = {
  getLanguage: () => "zh-CN",
  getDirection: () => "ltr" as const,
  get: async (_ids: string | string[], _args?: object | null, fallback?: string) => fallback ?? "",
  translate: async (_element: HTMLElement) => {},
  pause: () => {},
  resume: () => {},
};

function rawUrl(apiBase: string, root: RootKey, relPath: string): string {
  const q = new URLSearchParams({ root, path: relPath });
  return `${apiBase.replace(/\/$/, "")}/api/fs/raw?${q.toString()}`;
}

function assetDir(name: string): string {
  return new URL(`pdfjs/${name}/`, window.location.href).href;
}

function slotSize(pageWidth: number, pageHeight: number, viewerScale: number): { width: number; height: number } {
  return {
    width: Math.max(1, Math.floor(pageWidth * PDF_TO_CSS_UNITS * viewerScale)),
    height: Math.max(1, Math.floor(pageHeight * PDF_TO_CSS_UNITS * viewerScale)),
  };
}

async function drawAtScale(pageView: PDFPageView, scale: number): Promise<void> {
  if (Math.abs(pageView.scale - scale) > 0.001) {
    pageView.update({ scale });
  }
  if (pageView.renderingState === RenderingStates.INITIAL) {
    await pageView.draw();
  }
}

function PdfPage(props: {
  pdf: PDFDocumentProxy;
  pageNumber: number;
  viewerScale: number;
  eventBus: EventBus;
}): ReactNode {
  const { pdf, pageNumber, viewerScale, eventBus } = props;
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<PDFPageView | null>(null);
  const readyRef = useRef(false);
  const scaleRef = useRef(viewerScale);
  scaleRef.current = viewerScale;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) {
      return undefined;
    }
    let cancelled = false;
    readyRef.current = false;

    void (async () => {
      const page = await pdf.getPage(pageNumber);
      if (cancelled) {
        return;
      }
      const pageView = new PDFPageView({
        container: host,
        eventBus,
        id: pageNumber,
        scale: scaleRef.current,
        defaultViewport: page.getViewport({ scale: 1 }),
        textLayerMode: 1,
        annotationMode: AnnotationMode.DISABLE,
        enableAutoLinking: false,
        l10n: stubL10n,
      });
      viewRef.current = pageView;
      pageView.setPdfPage(page);
      await drawAtScale(pageView, scaleRef.current);
      if (cancelled) {
        pageView.destroy();
        viewRef.current = null;
        return;
      }
      readyRef.current = true;
      if (Math.abs(pageView.scale - scaleRef.current) > 0.001) {
        await drawAtScale(pageView, scaleRef.current);
      }
    })().catch(() => {
      if (!cancelled && host) {
        host.textContent = `第 ${pageNumber} 页没能画出来。`;
      }
    });

    return () => {
      cancelled = true;
      readyRef.current = false;
      viewRef.current?.destroy();
      viewRef.current = null;
      host.replaceChildren();
    };
  }, [pdf, pageNumber, eventBus]);

  useEffect(() => {
    const pageView = viewRef.current;
    if (!pageView || !readyRef.current) {
      return;
    }
    void drawAtScale(pageView, viewerScale).catch(() => {});
  }, [viewerScale]);

  return <div ref={hostRef} className="lm-pdf-preview-page" data-testid="lm-pdf-preview-page" />;
}

export function PdfFileView(props: PdfFileViewProps): ReactNode {
  const { apiBase, tab, actions } = props;
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [pageWidth, setPageWidth] = useState(0);
  const [pageHeight, setPageHeight] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const [zoomPercent, setZoomPercent] = useState(100);
  const [containerWidth, setContainerWidth] = useState(0);
  const [mountedPages, setMountedPages] = useState<Set<number>>(() => new Set([1, 2, 3]));
  const scrollerRef = useRef<HTMLDivElement>(null);
  const eventBusRef = useRef<EventBus>(new EventBus());
  const requestKey = useMemo(
    () => `${apiBase}|${tab.root}|${tab.path}|${tab.mtimeMs}`,
    [apiBase, tab.root, tab.path, tab.mtimeMs],
  );

  const shown = Math.min(pageCount, MAX_PREVIEW_PAGES);
  const baseScale = fitViewerScale(containerWidth, pageWidth);
  const viewerScale = baseScale * (zoomPercent / 100);
  const { width: slotWidth, height: slotHeight } = slotSize(
    pageWidth || 612,
    pageHeight || 792,
    viewerScale,
  );

  useEffect(() => {
    const node = scrollerRef.current;
    if (!node) {
      return undefined;
    }
    const measure = () => {
      const next = Math.round(node.clientWidth);
      setContainerWidth((current) => (Math.abs(current - next) < 24 ? current : next));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [pdf]);

  // Virtualize: only mount PDFPageView for pages near the viewport.
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller || !pdf || shown <= 0) {
      return undefined;
    }
    const visible = new Set<number>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const n = Number((entry.target as HTMLElement).dataset.pdfPage);
          if (!Number.isFinite(n)) {
            continue;
          }
          if (entry.isIntersecting) {
            visible.add(n);
          } else {
            visible.delete(n);
          }
        }
        const next = expandMountedPages(visible, shown, PAGE_BUFFER);
        setMountedPages((prev) => {
          if (prev.size === next.size && [...next].every((p) => prev.has(p))) {
            return prev;
          }
          return next;
        });
      },
      { root: scroller, rootMargin: "240px 0px", threshold: 0 },
    );
    for (const slot of scroller.querySelectorAll<HTMLElement>("[data-pdf-page]")) {
      io.observe(slot);
    }
    // Seed first pages before the first intersection callback.
    setMountedPages((prev) => {
      const seed = expandMountedPages(prev.size ? prev : [1], shown, PAGE_BUFFER);
      return seed;
    });
    return () => io.disconnect();
  }, [pdf, shown, slotHeight]);

  // Word-like drag-select + edge autoscroll.
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller || !pdf) {
      return undefined;
    }
    const disposeSelect = installPdfTextDragSelect(scroller);
    let edge: -1 | 0 | 1 = 0;
    let raf = 0;
    const step = () => {
      if (edge !== 0) {
        scroller.scrollTop += edge * 14;
        raf = requestAnimationFrame(step);
      } else {
        raf = 0;
      }
    };
    const onMove = (event: PointerEvent) => {
      if (event.buttons !== 1) {
        edge = 0;
        return;
      }
      const rect = scroller.getBoundingClientRect();
      const zone = 48;
      if (event.clientY < rect.top + zone) {
        edge = -1;
      } else if (event.clientY > rect.bottom - zone) {
        edge = 1;
      } else {
        edge = 0;
      }
      if (edge !== 0 && raf === 0) {
        raf = requestAnimationFrame(step);
      }
    };
    const stop = () => {
      edge = 0;
      if (raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
    };
    scroller.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", stop);
    window.addEventListener("blur", stop);
    return () => {
      stop();
      disposeSelect();
      scroller.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("blur", stop);
    };
  }, [pdf]);

  // Drop selection when scale changes so caret nodes are not left dangling.
  useEffect(() => {
    document.getSelection()?.removeAllRanges();
  }, [viewerScale]);

  useEffect(() => {
    let cancelled = false;
    let loaded: PDFDocumentProxy | null = null;
    setBusy(true);
    setLoadError(null);
    setPdf(null);
    setPageCount(0);
    setPageWidth(0);
    setPageHeight(0);
    setMountedPages(new Set([1, 2, 3]));
    if (!apiBase.trim()) {
      setLoadError("本机服务未连接，打不开这份 PDF。");
      setBusy(false);
      return undefined;
    }
    void (async () => {
      try {
        const { response } = await fetchWithLoopbackAuthRetry(apiBase, (base) =>
          fetchApi(rawUrl(base, tab.root, tab.path), {}, { tag: "pdfRaw", timeoutMs: 120_000 }),
        );
        if (!response.ok) {
          throw new Error(`读不到这份 PDF（${response.status}）。`);
        }
        const data = new Uint8Array(await response.arrayBuffer());
        if (cancelled) {
          return;
        }
        GlobalWorkerOptions.workerSrc = new URL(workerUrl, window.location.href).href;
        loaded = await getDocument({
          data,
          cMapUrl: assetDir("cmaps"),
          cMapPacked: true,
          standardFontDataUrl: assetDir("standard_fonts"),
          isEvalSupported: false,
          useWorkerFetch: false,
        }).promise;
        if (cancelled) {
          await loaded.destroy();
          return;
        }
        const first = await loaded.getPage(1);
        const box = first.getViewport({ scale: 1 });
        setPageWidth(box.width);
        setPageHeight(box.height);
        setPageCount(loaded.numPages);
        setPdf(loaded);
      } catch (err) {
        if (!cancelled) {
          setLoadError(errorMessage(err, "读不到这份 PDF。"));
        }
      } finally {
        if (!cancelled) {
          setBusy(false);
        }
      }
    })();
    return () => {
      cancelled = true;
      void loaded?.destroy();
    };
  }, [requestKey, apiBase, tab.root, tab.path]);

  return (
    <div className="lm-editor-pane lm-pdf-preview-pane" data-testid="lm-preview-pdf">
      <div className="lm-editor-header">
        {pdf ? (
          <div className="lm-pdf-preview-tools" role="group" aria-label="PDF 缩放">
            <button
              type="button"
              className="lm-btn lm-btn-ghost lm-btn-sm"
              disabled={zoomPercent <= 50}
              onClick={() => setZoomPercent((value) => Math.max(50, value - 25))}
            >
              −
            </button>
            <span className="lm-word-zoom-label">{zoomPercent}%</span>
            <button
              type="button"
              className="lm-btn lm-btn-ghost lm-btn-sm"
              disabled={zoomPercent >= 200}
              onClick={() => setZoomPercent((value) => Math.min(200, value + 25))}
            >
              +
            </button>
            <button type="button" className="lm-btn lm-btn-ghost lm-btn-sm" onClick={() => setZoomPercent(100)}>
              页宽
            </button>
            <span className="lm-meta">
              {shown} / {pageCount} 页
            </span>
          </div>
        ) : null}
        <div className="lm-editor-actions">
          <PreviewCommonActions root={tab.root} relPath={tab.path} actions={actions} />
        </div>
      </div>
      {loadError && !pdf ? (
        <div className="lm-office-doc-body">
          <p className="lm-office-doc-title">{tab.name}</p>
          <p className="lm-office-doc-copy" role="alert">
            {loadError}
          </p>
        </div>
      ) : (
        <div ref={scrollerRef} className="lm-pdf-preview-pages lm-scroll" data-testid="lm-pdf-preview-pages">
          {busy && !pdf ? <p className="lm-meta">正在打开 PDF…</p> : null}
          {pdf
            ? Array.from({ length: shown }, (_, index) => {
                const pageNumber = index + 1;
                const live = mountedPages.has(pageNumber);
                return (
                  <div
                    key={pageNumber}
                    className={`lm-pdf-preview-page-slot${live ? "" : " is-placeholder"}`}
                    data-pdf-page={pageNumber}
                    data-testid="lm-pdf-preview-page-slot"
                    style={{ width: slotWidth, height: slotHeight }}
                  >
                    {live ? (
                      <PdfPage
                        pdf={pdf}
                        pageNumber={pageNumber}
                        viewerScale={viewerScale}
                        eventBus={eventBusRef.current}
                      />
                    ) : null}
                  </div>
                );
              })
            : null}
          {pageCount > MAX_PREVIEW_PAGES ? (
            <p className="lm-meta">只预览前 {MAX_PREVIEW_PAGES} 页。全文请用本机应用打开。</p>
          ) : null}
        </div>
      )}
    </div>
  );
}
