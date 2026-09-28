import type { CSSProperties } from "react";
import { canvasMono, type CanvasTokens } from "./tokens";
import { useCanvasTheme } from "./theme";
import { mergeStyle } from "./primitives";
import { highlightLine, languageFromPath, type HighlightKind } from "./highlight";

function kindColor(kind: HighlightKind, theme: CanvasTokens): string {
  if (kind === "keyword") {return theme.accent.primary;}
  if (kind === "string") {return theme.stat.success;}
  if (kind === "comment") {return theme.text.quaternary;}
  if (kind === "number") {return theme.stat.warning;}
  if (kind === "type") {return theme.category.purple;}
  if (kind === "punct") {return theme.text.tertiary;}
  return theme.text.primary;
}

export function DiffStats(props: { additions?: number; deletions?: number; style?: CSSProperties }) {
  const theme = useCanvasTheme();
  const additions = props.additions ?? 0;
  const deletions = props.deletions ?? 0;
  if (additions === 0 && deletions === 0) {
    return null;
  }
  return (
    <span style={mergeStyle({ fontVariantNumeric: "tabular-nums", fontSize: 12, fontWeight: 590 }, props.style)}>
      {additions > 0 ? <span style={{ color: theme.stat.success }}>+{additions}</span> : null}
      {additions > 0 && deletions > 0 ? " " : null}
      {deletions > 0 ? <span style={{ color: theme.stat.danger }}>-{deletions}</span> : null}
    </span>
  );
}

export type DiffLineData = {
  type: "added" | "removed" | "unchanged";
  content: string;
  lineNumber?: number;
};

export function DiffView(props: {
  lines: DiffLineData[];
  path?: string;
  language?: string;
  showLineNumbers?: boolean;
  coloredLineNumbers?: boolean;
  showAccentStrip?: boolean;
  style?: CSSProperties;
}) {
  const theme = useCanvasTheme();
  const showNumbers = props.showLineNumbers !== false;
  const colorNumbers = props.coloredLineNumbers !== false;
  const strip = props.showAccentStrip !== false;
  const language = languageFromPath(props.path, props.language);
  return (
    <div
      style={mergeStyle(
        {
          fontFamily: canvasMono,
          fontSize: 12,
          lineHeight: "20px",
          overflow: "auto",
          background: theme.bg.editor,
        },
        props.style,
      )}
      data-path={props.path}
      data-language={language}
    >
      {props.lines.map((line, index) => {
        const background =
          line.type === "added" ? theme.diff.insertedLine : line.type === "removed" ? theme.diff.removedLine : "transparent";
        const accent = line.type === "added" ? theme.diff.stripAdded : line.type === "removed" ? theme.diff.stripRemoved : "transparent";
        const numberColor =
          colorNumbers && line.type === "added"
            ? theme.stat.success
            : colorNumbers && line.type === "removed"
              ? theme.stat.danger
              : theme.text.quaternary;
        const mark = line.type === "added" ? "+" : line.type === "removed" ? "-" : " ";
        const markColor = line.type === "added" ? theme.stat.success : line.type === "removed" ? theme.stat.danger : theme.text.quaternary;
        return (
          <div key={index} style={{ display: "flex", background, minWidth: "100%" }}>
            {strip ? <span style={{ width: 3, flexShrink: 0, background: accent }} /> : null}
            {showNumbers ? (
              <span
                style={{
                  width: 48,
                  flexShrink: 0,
                  textAlign: "right",
                  paddingRight: 12,
                  color: numberColor,
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {line.lineNumber ?? ""}
              </span>
            ) : null}
            <span style={{ width: 16, flexShrink: 0, color: markColor }}>{mark}</span>
            <span style={{ whiteSpace: "pre", paddingRight: 16 }}>
              {highlightLine(line.content, language).map((token, tokenIndex) => (
                <span
                  key={tokenIndex}
                  style={{
                    color: kindColor(token.kind, theme),
                    fontStyle: token.kind === "comment" ? "italic" : "normal",
                  }}
                >
                  {token.text}
                </span>
              ))}
            </span>
          </div>
        );
      })}
    </div>
  );
}
