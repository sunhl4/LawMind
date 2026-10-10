/**
 * Margin balloons for the open Word review. They sit beside the paper
 * in the same scroll container.
 */
import { useLayoutEffect, useRef, type ReactNode } from "react";
import { revisionPieces } from "../../../../../src/lawmind/drafts/word-surface-pieces.ts";
import type { WordSurfaceHunkView, WordTrackedView } from "../../../../../src/lawmind/drafts/word-surface.ts";
import { renderWordRunText } from "./word-surface-run-text";

export type MarginLiveEdit = { key: string; before: string; after: string };

export function wordBalloonLines(
  before: string,
  after: string,
  rationale?: string,
): { label: string; text: string; mark: "del" | "ins" | "fmt"; changeIndex: number }[] {
  if (rationale?.startsWith("设置格式")) {
    return [{ label: rationale, text: after || before, mark: "fmt", changeIndex: 0 }];
  }
  const moved = rationale === "移动的内容";
  const lines: { label: string; text: string; mark: "del" | "ins" | "fmt"; changeIndex: number }[] = [];
  let changeIndex = 0;
  for (const piece of revisionPieces(before, after)) {
    if (piece.kind !== "change") {
      continue;
    }
    if (piece.before) {
      lines.push({
        label: moved ? "移动来源" : "删除的内容",
        text: piece.before,
        mark: "del",
        changeIndex,
      });
    }
    if (piece.after) {
      lines.push({
        label: moved ? "移动目标" : "插入的内容",
        text: piece.after,
        mark: "ins",
        changeIndex,
      });
    }
    changeIndex += 1;
  }
  return lines;
}

export function BalloonEdit(props: {
  text: string;
  editable: boolean;
  testId: string;
  onChange: (text: string) => void;
  onBlur: () => void;
}): ReactNode {
  const ref = useRef<HTMLModElement>(null);
  const focused = useRef(false);
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node || focused.current) {
      return;
    }
    if (node.textContent !== props.text) {
      node.textContent = props.text;
    }
  }, [props.text]);
  return (
    <ins
      ref={ref}
      className="lm-word-rev-ins lm-word-rev-edit"
      contentEditable={props.editable}
      suppressContentEditableWarning
      role="textbox"
      aria-label="修改这条修订"
      data-testid={props.testId}
      spellCheck={false}
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onFocus={() => {
        focused.current = true;
      }}
      onInput={(event) => props.onChange(event.currentTarget.textContent ?? "")}
      onBlur={() => {
        focused.current = false;
        props.onBlur();
      }}
    />
  );
}

export function briefRevisionKind(row: Pick<WordTrackedView, "change">): string {
  if (row.change === "format") {
    return "格式";
  }
  if (row.change === "del" || row.change === "moveFrom") {
    return "删除";
  }
  if (row.change === "ins" || row.change === "moveTo") {
    return "插入";
  }
  return "修订";
}

export function trackedBalloonLabel(row: WordTrackedView): string {
  if (row.change === "format") {
    const name = row.format?.trim();
    return name && name !== "设置格式" ? `设置格式：${name}` : "设置格式";
  }
  if (row.change === "del") {
    return "删除的内容";
  }
  if (row.change === "ins") {
    return "插入的内容";
  }
  if (row.change === "moveFrom") {
    return "移动来源";
  }
  return "移动目标";
}

export function formatRevisionTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function changeSummary(before: string, after: string): string {
  const bits = revisionPieces(before, after)
    .filter((piece) => piece.kind === "change")
    .map((piece) => {
      if (piece.kind !== "change") {
        return "";
      }
      if (piece.before && piece.after) {
        return `${piece.before} → ${piece.after}`;
      }
      return piece.after || piece.before;
    })
    .filter(Boolean);
  return (bits.join("；") || after || before).replace(/\s+/g, " ").trim();
}

export function liveAfter(drafts: Record<string, string>, hunkId: string, after: string): string {
  return drafts[hunkId] ?? after;
}

export function TrackBalloon(props: {
  row: WordTrackedView;
  own: boolean;
  accepted: boolean;
  open: boolean;
  selected: boolean;
  busy: boolean;
  onFocus: () => void;
  onFold: () => void;
  onUnfold: () => void;
  onAccept: () => void;
  onReject: () => void;
}): ReactNode {
  const { row } = props;
  return (
    <section
      className={`lm-word-rev-card${props.selected ? " lm-word-rev-card-active" : ""}${!props.open ? " lm-word-rev-card-done" : ""}${!props.open && !props.own ? " lm-word-rev-card-brief" : ""}`}
      data-word-hunk={row.revId}
      data-word-slot="rail"
      data-rev-color={String(row.color)}
      data-own-revision={props.own ? "true" : "false"}
      data-testid={`lm-word-track-${row.revId}`}
      onClick={(event) => {
        const target = event.target;
        if (target instanceof Element && target.closest("button")) {
          return;
        }
        props.onFocus();
      }}
    >
      {props.open ? (
        <>
          <div className="lm-word-rev-card-head">
            <p className="lm-word-rev-byline">
              {row.author}
              {row.date ? `，${formatRevisionTime(row.date)}` : ""}
            </p>
            {props.own ? (
              <div className="lm-word-rev-card-actions">
                {props.accepted ? (
                  <button type="button" className="lm-btn lm-btn-ghost lm-btn-sm" onClick={props.onFold}>
                    收起
                  </button>
                ) : null}
                <button
                  type="button"
                  className="lm-btn lm-btn-sm"
                  data-testid={`lm-word-track-accept-${row.revId}`}
                  aria-label="接受"
                  title="接受后折叠，导出仍保留这条修订"
                  aria-pressed={props.accepted}
                  disabled={props.busy}
                  onClick={props.onAccept}
                >
                  接受
                </button>
                <button
                  type="button"
                  className="lm-btn lm-btn-ghost lm-btn-sm"
                  data-testid={`lm-word-track-reject-${row.revId}`}
                  aria-label="拒绝"
                  title="拒绝后从正文和导出拿掉"
                  disabled={props.busy}
                  onClick={props.onReject}
                >
                  拒绝
                </button>
              </div>
            ) : null}
          </div>
          <div className="lm-word-rev-preview">
            <p className="lm-word-rev-balloon-line">
              <span className="lm-word-rev-balloon-label">{trackedBalloonLabel(row)}</span>
              {row.change === "format" ? null : row.change === "del" || row.change === "moveFrom" ? (
                <del className="lm-word-rev-del">{renderWordRunText(row.text)}</del>
              ) : (
                <ins className="lm-word-rev-ins">{renderWordRunText(row.text)}</ins>
              )}
            </p>
          </div>
        </>
      ) : (
        <button
          type="button"
          className="lm-word-rev-fold"
          data-testid={`lm-word-fold-${row.revId}`}
          onClick={props.onUnfold}
        >
          {props.own ? (
            <span className="lm-word-rev-fold-mark" aria-hidden="true">
              ✓
            </span>
          ) : null}
          <span className="lm-word-rev-fold-text">
            {props.own
              ? `已接受 · ${row.text || trackedBalloonLabel(row)}`
              : `${row.author} · ${briefRevisionKind(row)}`}
          </span>
        </button>
      )}
    </section>
  );
}

export function HunkBalloon(props: {
  hunk: WordSurfaceHunkView;
  afterText: string;
  open: boolean;
  selected: boolean;
  busy: boolean;
  onFocus: () => void;
  onFold: () => void;
  onUnfold: () => void;
  onAccept: () => void;
  onReject: () => void;
  onDraft: (text: string, changeIndex: number) => void;
  onCommit: () => void;
}): ReactNode {
  const { hunk } = props;
  const reviewed = hunk.status !== "pending";
  const foldLabel = hunk.status === "accepted" ? "已接受" : "待定";
  return (
    <section
      className={`lm-word-rev-card${props.selected ? " lm-word-rev-card-active" : ""}${reviewed && !props.open ? " lm-word-rev-card-done" : ""}`}
      data-word-hunk={hunk.hunkId}
      data-word-slot="rail"
      data-rev-color={String(hunk.color)}
      data-testid={`lm-word-hunk-${hunk.hunkId}`}
      onClick={(event) => {
        const target = event.target;
        if (target instanceof Element && target.closest("button, textarea, a, .lm-word-rev-edit")) {
          return;
        }
        props.onFocus();
      }}
    >
      {props.open ? (
        <>
          <div className="lm-word-rev-card-head">
            <p className="lm-word-rev-byline">
              {hunk.author ?? "审阅"}
              {hunk.revisedAt ? `，${formatRevisionTime(hunk.revisedAt)}` : ""}
            </p>
            <div className="lm-word-rev-card-actions">
              {reviewed ? (
                <button type="button" className="lm-btn lm-btn-ghost lm-btn-sm" onClick={props.onFold}>
                  收起
                </button>
              ) : null}
              <button
                type="button"
                className="lm-btn lm-btn-sm"
                data-testid={`lm-word-accept-${hunk.hunkId}`}
                aria-label="接受"
                title="接受修订"
                aria-pressed={hunk.status === "accepted"}
                disabled={props.busy}
                onClick={props.onAccept}
              >
                接受
              </button>
              <button
                type="button"
                className="lm-btn lm-btn-ghost lm-btn-sm"
                data-testid={`lm-word-reject-${hunk.hunkId}`}
                aria-label="拒绝"
                title="拒绝修订"
                aria-pressed={hunk.status === "rejected"}
                disabled={props.busy}
                onClick={props.onReject}
              >
                拒绝
              </button>
            </div>
          </div>
          <div className="lm-word-rev-preview">
            {wordBalloonLines(hunk.before, props.afterText, hunk.rationale).map((line, lineIndex) => (
              <p key={lineIndex} className="lm-word-rev-balloon-line">
                <span className="lm-word-rev-balloon-label">{line.label}</span>
                {line.mark === "del" ? (
                  <del className="lm-word-rev-del">{renderWordRunText(line.text)}</del>
                ) : (
                  <BalloonEdit
                    text={line.text.replaceAll("\f", "\n")}
                    editable={hunk.status === "pending"}
                    testId={`lm-word-edit-${hunk.hunkId}`}
                    onChange={(text) => props.onDraft(text, line.changeIndex)}
                    onBlur={props.onCommit}
                  />
                )}
              </p>
            ))}
          </div>
          {!hunk.placed ? <p className="lm-word-rev-unplaced">未在正文中找到</p> : null}
        </>
      ) : (
        <button type="button" className="lm-word-rev-fold" data-testid={`lm-word-fold-${hunk.hunkId}`} onClick={props.onUnfold}>
          <span className="lm-word-rev-fold-mark" aria-hidden="true">
            {hunk.status === "accepted" ? "✓" : "✕"}
          </span>
          <span className="lm-word-rev-fold-text">
            {foldLabel} · {changeSummary(hunk.before, hunk.after)}
          </span>
        </button>
      )}
    </section>
  );
}
