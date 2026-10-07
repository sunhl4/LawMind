/**
 * Paper view for the chat-middle Word review. Paints runs; it does not load files.
 */
import { memo, type CSSProperties, type ReactNode } from "react";
import {
  revisionPieces,
} from "../../../../../src/lawmind/drafts/word-surface-pieces.ts";
import type {
  WordLineSpacing,
  WordMeasure,
  WordPageBox,
  WordSurfaceBlock,
  WordSurfaceHunkView,
  WordSurfaceParagraph,
  WordSurfaceSegment,
  WordSurfaceSnapshot,
} from "../../../../../src/lawmind/drafts/word-surface.ts";

type MarkupMode = "all" | "simple" | "none" | "original";

function revisionColor(hunks: WordSurfaceHunkView[], hunkId: string): number {
  return hunks.find((hunk) => hunk.hunkId === hunkId)?.color ?? 0;
}

function liveAfter(drafts: Record<string, string>, hunkId: string, after: string): string {
  return drafts[hunkId] ?? after;
}


function markStyle(segment: WordSurfaceSegment, revision: boolean): CSSProperties {
  return {
    fontWeight: segment.bold ? 700 : undefined,
    fontStyle: segment.italic ? "italic" : undefined,
    textDecoration: !revision && segment.underline ? "underline" : undefined,
    fontSize: segment.fontSizePx ? `${segment.fontSizePx}px` : undefined,
    fontFamily: segment.fontFamily,
    color: revision ? undefined : segment.fontColor,
  };
}

function measureCss(measure: WordMeasure | undefined, line: WordLineSpacing | undefined): string | undefined {
  if (!measure) {
    return undefined;
  }
  if (measure.unit === "px") {
    return `${measure.value}px`;
  }
  if (measure.unit === "em") {
    return `${measure.value}em`;
  }
  if (line?.rule === "exact" || line?.rule === "atLeast") {
    return `${Math.round(measure.value * line.px * 10) / 10}px`;
  }
  const multiple = line?.rule === "auto" ? line.multiple : 1;
  return `${Math.round(measure.value * multiple * 1000) / 1000}em`;
}

function lineCss(line: WordLineSpacing | undefined): string | undefined {
  if (!line) {
    return undefined;
  }
  if (line.rule === "auto") {
    return String(line.multiple);
  }
  return `${line.px}px`;
}

function paragraphStyle(paragraph: WordSurfaceParagraph): CSSProperties {
  const align = paragraph.align === "both" ? "justify" : paragraph.align;
  return {
    textAlign: align,
    paddingLeft: measureCss(paragraph.indent, paragraph.line),
    textIndent: measureCss(paragraph.firstIndent, paragraph.line),
    marginTop: measureCss(paragraph.spaceBefore, paragraph.line),
    marginBottom: measureCss(paragraph.spaceAfter, paragraph.line),
    lineHeight: lineCss(paragraph.line),
    fontFamily: paragraph.fontFamily,
  };
}

function pageStyle(page: WordPageBox | undefined): CSSProperties {
  const box = page ?? {
    widthPx: 793.7,
    marginTopPx: 96,
    marginRightPx: 96,
    marginBottomPx: 96,
    marginLeftPx: 96,
    fontFamily: 'SimSun, "NSimSun", "Songti SC", "STSong", "Noto Serif SC", serif',
    fontSizePx: 16,
  };
  return {
    width: box.widthPx,
    paddingTop: box.marginTopPx,
    paddingRight: box.marginRightPx,
    paddingBottom: box.marginBottomPx,
    paddingLeft: box.marginLeftPx,
    fontFamily: box.fontFamily,
    fontSize: box.fontSizePx ? `${box.fontSizePx}px` : undefined,
  };
}

export type SurfacePaint = {
  hunks: WordSurfaceHunkView[];
  selectedId: string | null;
  drafts: Record<string, string>;
  onFocus: (hunkId: string, slot: "page" | "rail") => void;
  onPlainFocus: (active: boolean) => void;
  onPlainDirty: () => void;
  /** Optional hunkId: jump to that revision after switching to all markup. */
  onShowAllMarkup: (hunkId?: string) => void;
  markup: MarkupMode;
  hiddenAuthors?: Set<string>;
  /** False for vertical table cells — keep them read-only. */
  plainEditable?: boolean;
  paragraphIndex?: { current: number };
};

export const WordSurfaceDocument = memo(function WordSurfaceDocument(props: {
  fileName: string;
  loadError: string | null;
  snapshot: WordSurfaceSnapshot | null;
  paint: SurfacePaint;
}): ReactNode {
  const { fileName, loadError, snapshot, paint } = props;
  const empty = Boolean(
    snapshot &&
      snapshot.paragraphs.every((paragraph) =>
        paragraph.segments.every((segment) =>
          segment.kind === "text"
            ? !segment.text.trim()
            : segment.kind === "tracked"
              ? !segment.text.trim()
              : false,
        ),
      ),
  );
  const index = { current: 0 };
  const bodyPaint = { ...paint, paragraphIndex: index };
  const storyPaint = { ...paint, plainEditable: false as const };
  return (
    <article className="lm-word-surface-page" style={pageStyle(snapshot?.page)} aria-label={fileName}>
      {loadError && !snapshot ? (
        <p className="lm-word-surface-empty">{loadError}</p>
      ) : empty ? (
        <p className="lm-word-surface-empty">这份 Word 没有可抽出的正文。</p>
      ) : (
        <>
          {snapshot?.headerBlocks && snapshot.headerBlocks.length > 0 ? (
            <div className="lm-word-surface-header" data-testid="lm-word-surface-header">
              {renderSurfaceBlocks(snapshot.headerBlocks, storyPaint, snapshot.page)}
            </div>
          ) : null}
          {renderSurfaceBlocks(
            snapshot?.blocks?.length
              ? snapshot.blocks
              : (snapshot?.paragraphs ?? []).map((paragraph) => ({ kind: "paragraph" as const, ...paragraph })),
            bodyPaint,
            snapshot?.page,
          )}
          {snapshot?.footnoteBlocks && snapshot.footnoteBlocks.length > 0 ? (
            <div className="lm-word-surface-footnotes" data-testid="lm-word-surface-footnotes">
              {renderSurfaceBlocks(snapshot.footnoteBlocks, storyPaint, snapshot.page)}
            </div>
          ) : null}
          {snapshot?.footerBlocks && snapshot.footerBlocks.length > 0 ? (
            <div className="lm-word-surface-footer" data-testid="lm-word-surface-footer">
              {renderSurfaceBlocks(snapshot.footerBlocks, storyPaint, snapshot.page)}
            </div>
          ) : null}
        </>
      )}
    </article>
  );
});

function renderSurfaceBlocks(
  blocks: WordSurfaceBlock[],
  paint: SurfacePaint,
  page?: WordPageBox,
): ReactNode {
  return blocks.map((block, index) => {
    if (block.kind !== "table") {
      return renderSurfaceParagraph(block, index, paint);
    }
    const cols = scaledColWidths(block, page);
    return (
      <table
        key={index}
        className={`lm-word-surface-table${block.bordered ? " lm-word-surface-table-grid" : ""}`}
        style={tableStyle(block, page)}
      >
        {cols ? (
          <colgroup>
            {cols.map((width, colIndex) => (
              <col key={colIndex} style={{ width }} />
            ))}
          </colgroup>
        ) : null}
        <tbody>
          {block.rows.map((row, rowIndex) => {
            const rowTrack = row[0]?.rowTrack;
            return (
            <tr
              key={rowIndex}
              className={rowTrack ? "lm-word-track-row" : undefined}
              data-word-hunk={rowTrack?.revId}
              data-word-slot={rowTrack ? "page" : undefined}
              data-rev-color={rowTrack ? String(rowTrack.color) : undefined}
              onClick={rowTrack ? () => paint.onFocus(rowTrack.revId, "rail") : undefined}
            >
              {row.map((cell, cellIndex) => {
                const cellPaint: SurfacePaint = {
                  ...paint,
                  plainEditable: !cell.vertical,
                };
                return (
                  <td
                    key={cellIndex}
                    colSpan={cell.colspan}
                    style={cellStyle(cell)}
                    data-word-cell={cell.vertical ? "vertical" : "plain"}
                  >
                    {renderSurfaceBlocks(cell.blocks, cellPaint, page)}
                  </td>
                );
              })}
            </tr>
            );
          })}
        </tbody>
      </table>
    );
  });
}

function contentWidthPx(page: WordPageBox | undefined): number | undefined {
  if (!page) {
    return undefined;
  }
  return Math.max(0, page.widthPx - page.marginLeftPx - page.marginRightPx);
}

function scaledColWidths(
  block: Extract<WordSurfaceBlock, { kind: "table" }>,
  page: WordPageBox | undefined,
): number[] | undefined {
  const cols = block.colWidthsPx;
  if (!cols || cols.length === 0) {
    return undefined;
  }
  if (block.widthPx != null) {
    return cols;
  }
  const target =
    block.widthPct != null ? ((contentWidthPx(page) ?? 0) * block.widthPct) / 100 : contentWidthPx(page);
  if (!target || target <= 0) {
    return cols;
  }
  const sum = cols.reduce((total, width) => total + width, 0);
  if (sum <= 0) {
    return cols;
  }
  const factor = target / sum;
  return cols.map((width) => Math.round(width * factor * 10) / 10);
}

function tableStyle(
  block: Extract<WordSurfaceBlock, { kind: "table" }>,
  page: WordPageBox | undefined,
): CSSProperties | undefined {
  const cols = scaledColWidths(block, page);
  if (block.widthPx != null) {
    return { width: block.widthPx, minWidth: block.widthPx };
  }
  if (block.widthPct != null) {
    return { width: `${block.widthPct}%` };
  }
  if (cols && cols.length > 0) {
    return { width: cols.reduce((sum, width) => sum + width, 0) };
  }
  return { width: "100%" };
}

function cellStyle(cell: {
  widthPx?: number;
  vertical?: boolean;
  vAlign?: "top" | "center" | "bottom";
  colspan?: number;
}): CSSProperties {
  const style: CSSProperties = {};
  if (cell.vAlign) {
    style.verticalAlign = cell.vAlign;
  }
  if (cell.vertical) {
    style.writingMode = "vertical-rl";
    style.textOrientation = "upright";
    style.whiteSpace = "nowrap";
    style.textAlign = "center";
  } else {
    style.wordBreak = "keep-all";
    style.overflowWrap = "normal";
  }
  return style;
}

function paragraphBaseline(paragraph: WordSurfaceParagraph): string {
  if (paragraph.baselineText != null) {
    return paragraph.baselineText;
  }
  return paragraph.segments
    .map((segment) => {
      if (segment.kind === "text") {
        return segment.text;
      }
      if (segment.kind === "tracked") {
        return segment.change === "del" || segment.change === "moveFrom" ? "" : segment.text;
      }
      return segment.before;
    })
    .join("");
}

function liveRevisionPiece(
  segments: WordSurfaceParagraph["segments"],
  segIndex: number,
  segment: Extract<WordSurfaceSegment, { kind: "revision" }>,
  paint: SurfacePaint,
): { before: string; after: string } {
  const hunk = paint.hunks.find((row) => row.hunkId === segment.hunkId);
  if (!hunk || paint.drafts[segment.hunkId] === undefined) {
    return { before: segment.before, after: segment.after };
  }
  const changes = revisionPieces(hunk.before, liveAfter(paint.drafts, segment.hunkId, hunk.after)).filter(
    (piece) => piece.kind === "change",
  );
  const prior = segments
    .slice(0, segIndex)
    .filter((row) => row.kind === "revision" && row.hunkId === segment.hunkId).length;
  const piece = changes[prior];
  return piece && piece.kind === "change"
    ? { before: piece.before, after: piece.after }
    : { before: segment.before, after: segment.after };
}

function renderRevisionSpan(
  segments: WordSurfaceParagraph["segments"],
  segIndex: number,
  segment: Extract<WordSurfaceSegment, { kind: "revision" }>,
  paint: SurfacePaint,
): ReactNode {
  const piece = liveRevisionPiece(segments, segIndex, segment, paint);
  const changeIndex = segments
    .slice(0, segIndex)
    .filter((row) => row.kind === "revision" && row.hunkId === segment.hunkId).length;
  const mode = paint.markup;
  if (piece.before === piece.after) {
    return (
      <span
        key={segIndex}
        className={`lm-word-rev lm-word-rev-fmt${paint.selectedId === segment.hunkId ? " lm-word-rev-active" : ""}`}
        data-word-hunk={segment.hunkId}
        data-word-slot="page"
        data-rev-after={piece.after}
        data-change-index={String(changeIndex)}
        data-rev-color={String(segment.color ?? revisionColor(paint.hunks, segment.hunkId))}
        onClick={() => paint.onFocus(segment.hunkId, "rail")}
      >
        {piece.after}
      </span>
    );
  }
  if (mode === "original" || mode === "simple" || mode === "none") {
    return <span key={segIndex}>{mode === "original" ? piece.before : piece.after}</span>;
  }
  return (
    <span
      key={segIndex}
      className={`lm-word-rev${paint.selectedId === segment.hunkId ? " lm-word-rev-active" : ""}`}
      style={markStyle(segment, true)}
      data-word-hunk={segment.hunkId}
      data-word-slot="page"
      data-rev-after={piece.after}
      data-change-index={String(changeIndex)}
      data-rev-color={String(segment.color ?? revisionColor(paint.hunks, segment.hunkId))}
      onClick={() => paint.onFocus(segment.hunkId, "rail")}
    >
      {piece.before ? <del className="lm-word-rev-del">{piece.before}</del> : null}
      {piece.after ? <ins className="lm-word-rev-ins">{piece.after}</ins> : null}
    </span>
  );
}

function renderTrackedSpan(
  segment: Extract<WordSurfaceSegment, { kind: "tracked" }>,
  segIndex: number,
  paint: SurfacePaint,
  allFrom: number,
): ReactNode {
  const hidden = Boolean(paint.hiddenAuthors?.has(segment.author));
  const deleted = segment.change === "del" || segment.change === "moveFrom";
  const mode = paint.markup;
  const plain = (key: number, text: string) => (
    <span key={key} style={markStyle(segment, false)} data-all-from={String(allFrom)}>
      {text}
    </span>
  );
  if (hidden) {
    return deleted || !segment.text ? null : plain(segIndex, segment.text);
  }
  if (mode === "original") {
    return deleted || segment.change === "format" ? plain(segIndex, segment.text) : null;
  }
  if (mode === "simple" || mode === "none") {
    return deleted ? null : plain(segIndex, segment.text);
  }
  if (segment.change === "format") {
    return (
      <span
        key={segIndex}
        className={`lm-word-track lm-word-rev-fmt${paint.selectedId === segment.revId ? " lm-word-track-active" : ""}`}
        style={markStyle(segment, true)}
        data-word-hunk={segment.revId}
        data-word-slot="page"
        data-rev-color={String(segment.color)}
        data-rev-change={segment.change}
        data-all-from={String(allFrom)}
        onClick={() => paint.onFocus(segment.revId, "rail")}
      >
        {segment.text}
      </span>
    );
  }
  const Tag = deleted ? "del" : "ins";
  return (
    <span
      key={segIndex}
      className={`lm-word-track${paint.selectedId === segment.revId ? " lm-word-track-active" : ""}`}
      style={markStyle(segment, true)}
      data-word-hunk={segment.revId}
      data-word-slot="page"
      data-rev-color={String(segment.color)}
      data-rev-change={segment.change}
      data-all-from={String(allFrom)}
      onClick={() => paint.onFocus(segment.revId, "rail")}
    >
      <Tag className={deleted ? "lm-word-rev-del" : "lm-word-rev-ins"}>{segment.text}</Tag>
    </span>
  );
}

function renderSurfaceParagraph(paragraph: WordSurfaceParagraph, index: number, paint: SurfacePaint): ReactNode {
  const blank = paragraph.segments.every((segment) =>
    segment.kind === "text" || segment.kind === "tracked" ? !segment.text.trim() : false,
  );
  const visibleTrack = (
    segment: WordSurfaceParagraph["segments"][number],
  ): segment is Extract<WordSurfaceParagraph["segments"][number], { kind: "tracked" }> =>
    segment.kind === "tracked" && !paint.hiddenAuthors?.has(segment.author);
  const revised =
    paint.markup !== "none" &&
    paint.markup !== "original" &&
    paragraph.segments.some(
      (segment) => segment.kind === "revision" || visibleTrack(segment),
    );
  const revisionIds = paragraph.segments.flatMap((segment) =>
    segment.kind === "revision"
      ? [segment.hunkId]
      : visibleTrack(segment)
        ? [segment.revId]
        : [],
  );
  const editable = paint.plainEditable !== false;
  const paragraphIndex = paint.paragraphIndex ? paint.paragraphIndex.current++ : undefined;
  let allFrom = 0;
  return (
    <p
      key={index}
      className={`lm-word-surface-p${blank ? " lm-word-surface-blank" : ""}${revised ? " lm-word-surface-p-revised" : ""}`}
      style={paragraphStyle(paragraph)}
      data-testid={editable ? undefined : "lm-word-surface-p-readonly"}
    >
      {paint.markup === "simple" && revised ? (
        <button
          type="button"
          className="lm-word-rev-bar"
          aria-label="显示此段修订"
          data-testid="lm-word-rev-bar"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            if (revisionIds.length === 0) {
              paint.onShowAllMarkup();
              return;
            }
            const current =
              paint.selectedId && revisionIds.includes(paint.selectedId)
                ? revisionIds.indexOf(paint.selectedId)
                : -1;
            const next = revisionIds[(current + 1) % revisionIds.length];
            paint.onShowAllMarkup(next);
          }}
        />
      ) : null}
      {paragraph.listLabel ? <span className="lm-word-surface-label">{paragraph.listLabel}</span> : null}
      <span
        className="lm-word-surface-plain"
        data-baseline={paragraphBaseline(paragraph)}
        data-paragraph-index={paragraphIndex != null ? String(paragraphIndex) : undefined}
        contentEditable={editable}
        suppressContentEditableWarning
        spellCheck={false}
        role="textbox"
        aria-label="修改这段正文"
        onFocus={() => {
          if (editable) {
            paint.onPlainFocus(true);
          }
        }}
        onBlur={(event) => {
          if (!editable) {
            return;
          }
          const next = event.relatedTarget;
          const staying = next instanceof Element && next.closest(".lm-word-surface-page") !== null;
          paint.onPlainFocus(staying);
        }}
        onInput={() => {
          if (editable) {
            paint.onPlainDirty();
          }
        }}
      >
        {paragraph.segments.map((segment, segIndex) => {
          const from = allFrom;
          allFrom += segment.kind === "text" || segment.kind === "tracked" ? segment.text.length : (segment.before.length + segment.after.length);
          return segment.kind === "text" ? (
            <span key={segIndex} style={markStyle(segment, false)} data-all-from={String(from)}>
              {segment.text}
            </span>
          ) : segment.kind === "tracked" ? (
            renderTrackedSpan(segment, segIndex, paint, from)
          ) : (
            renderRevisionSpan(paragraph.segments, segIndex, segment, paint)
          );
        })}
      </span>
    </p>
  );
}
