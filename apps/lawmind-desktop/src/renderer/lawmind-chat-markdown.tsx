import type { CSSProperties, ReactNode } from "react";
import { LawmindAnalysisChart } from "./LawmindAnalysisChart";
import {
  renderKatexHtml,
  tokenizeInlineLegalMarkdown,
  tryConsumeDisplayMath,
} from "./lawmind-chat-markdown-math";
import {
  consumeMarkdownTable,
  isMarkdownTableBlockStart,
  type TableColumnAlign,
} from "./lawmind-chat-markdown-table";
import { openContractRevisionForTask } from "./lawmind-open-contract-revision";
import { requestOpenChatSession } from "./lawmind-open-chat-session-bus";

export type LegalMarkdownContext = {
  apiBase?: string;
  workspaceDir?: string;
  onOpenDraft?: (taskId: string) => void;
  onOpenError?: (message: string) => void;
};

function openStatuteUrl(url: string): void {
  if (typeof window === "undefined") {
    return;
  }
  if (window.lawmindDesktop?.openExternal) {
    void window.lawmindDesktop.openExternal(url);
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
}

function columnAlignStyle(align: TableColumnAlign): CSSProperties | undefined {
  return align ? { textAlign: align } : undefined;
}

export function LegalMath(props: { tex: string; display?: boolean }): ReactNode {
  const display = props.display === true;
  const html = renderKatexHtml(props.tex, display);
  if (!html) {
    return (
      <span className="lm-md-math lm-md-math--fallback" data-testid="lm-md-math">
        {display ? `$$${props.tex}$$` : `\\(${props.tex}\\)`}
      </span>
    );
  }
  return (
    <span
      className={display ? "lm-md-math lm-md-math--display" : "lm-md-math"}
      data-testid="lm-md-math"
      data-display={display ? "true" : "false"}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

export function renderInlineLegalMarkdown(
  text: string,
  ctx?: LegalMarkdownContext,
): ReactNode[] {
  return tokenizeInlineLegalMarkdown(text).map((token, tokenIndex) => {
    if (token.kind === "bold") {
      return (
        <strong key={`strong-${tokenIndex}`}>{renderInlineLegalMarkdown(token.value, ctx)}</strong>
      );
    }
    if (token.kind === "code") {
      return (
        <code key={`code-${tokenIndex}`} className="lm-md-code">
          {token.value}
        </code>
      );
    }
    if (token.kind === "math") {
      return <LegalMath key={`math-${tokenIndex}`} tex={token.tex} display={token.display} />;
    }
    if (token.kind === "session_link") {
      return (
        <button
          key={`session-${tokenIndex}`}
          type="button"
          className="lm-md-session-link"
          data-testid="lm-md-session-link"
          onClick={() =>
            requestOpenChatSession({
              sessionId: token.sessionId,
              title: token.label,
              ...(token.assistantId ? { assistantId: token.assistantId } : {}),
            })
          }
        >
          {token.label}
        </button>
      );
    }
    if (token.kind === "draft_link") {
      return (
        <button
          key={`draft-${tokenIndex}`}
          type="button"
          className="lm-md-session-link"
          data-testid="lm-md-draft-link"
          title={token.label}
          onClick={() => {
            if (ctx?.onOpenDraft) {
              ctx.onOpenDraft(token.taskId);
              return;
            }
            if (!ctx?.apiBase?.trim()) {
              ctx?.onOpenError?.("请从对话打开这份稿。");
              return;
            }
            void openContractRevisionForTask({
              apiBase: ctx.apiBase,
              taskId: token.taskId,
              workspaceDir: ctx.workspaceDir,
            }).then((result) => {
              if (!result.ok) {
                ctx.onOpenError?.(result.error);
              }
            });
          }}
        >
          {token.label}
        </button>
      );
    }
    if (token.kind === "statute_link") {
      return (
        <button
          key={`statute-${tokenIndex}`}
          type="button"
          className="lm-md-session-link"
          data-testid="lm-md-statute-link"
          title={token.label}
          onClick={() => openStatuteUrl(token.url)}
        >
          {token.label}
        </button>
      );
    }
    return token.value;
  });
}

function isMathFenceLang(lang: string): boolean {
  return lang === "math" || lang === "latex" || lang === "tex";
}

function consumeFence(
  lines: string[],
  index: number,
): { lang: string; body: string[]; next: number } | null {
  const trimmed = (lines[index] ?? "").trim();
  if (!trimmed.startsWith("```")) {
    return null;
  }
  const lang = trimmed.slice(3).trim().split(/\s+/)[0] ?? "";
  const body: string[] = [];
  for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
    if (/^\s*```/.test(lines[cursor] ?? "")) {
      return { lang, body, next: cursor + 1 };
    }
    body.push(lines[cursor] ?? "");
  }
  // Unclosed fence: keep the remainder as the body so streaming ```lm-chart / code
  // does not leak pipes into a table.
  return { lang, body, next: lines.length };
}

export function renderLegalMarkdown(text: string, ctx?: LegalMarkdownContext): ReactNode {
  const lines = text.split("\n");
  const blocks: ReactNode[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] ?? "";
    const trimmed = line.trim();

    if (trimmed === "") {
      blocks.push(<div key={`space-${index}`} className="lm-md-space" />);
      index += 1;
      continue;
    }

    const fence = consumeFence(lines, index);
    if (fence) {
      if (fence.lang === "lm-chart") {
        blocks.push(
          <LawmindAnalysisChart key={`chart-${index}`} specText={fence.body.join("\n")} />,
        );
      } else if (isMathFenceLang(fence.lang)) {
        blocks.push(<LegalMath key={`math-fence-${index}`} tex={fence.body.join("\n")} display />);
      } else {
        blocks.push(
          <pre key={`pre-${index}`} className="lm-md-pre">
            <code>{fence.body.join("\n")}</code>
          </pre>,
        );
      }
      index = fence.next;
      continue;
    }

    const displayMath = tryConsumeDisplayMath(lines, index);
    if (displayMath) {
      blocks.push(<LegalMath key={`math-block-${index}`} tex={displayMath.tex} display />);
      index = displayMath.next;
      continue;
    }

    if (/^---+$/.test(trimmed)) {
      blocks.push(<hr key={`hr-${index}`} className="lm-md-hr" />);
      index += 1;
      continue;
    }

    const h1 = /^#\s+(.+)$/.exec(line);
    if (h1) {
      blocks.push(
        <div key={`h1-${index}`} className="lm-md-h1">
          {renderInlineLegalMarkdown(h1[1], ctx)}
        </div>,
      );
      index += 1;
      continue;
    }

    const h2 = /^##\s+(.+)$/.exec(line);
    if (h2) {
      blocks.push(
        <div key={`h2-${index}`} className="lm-md-h2">
          {renderInlineLegalMarkdown(h2[1], ctx)}
        </div>,
      );
      index += 1;
      continue;
    }

    if (trimmed.startsWith(">")) {
      const quoteLines: string[] = [];
      while (index < lines.length) {
        const q = (lines[index] ?? "").trim();
        if (!q.startsWith(">")) {
          break;
        }
        quoteLines.push(q.replace(/^>\s?/, ""));
        index += 1;
      }
      blocks.push(
        <blockquote key={`bq-${index}`} className="lm-md-quote">
          {quoteLines.map((ql, qi) => (
            <div key={`bq-line-${qi}`}>{renderInlineLegalMarkdown(ql, ctx)}</div>
          ))}
        </blockquote>,
      );
      continue;
    }

    if (isMarkdownTableBlockStart(lines, index)) {
      const table = consumeMarkdownTable(lines, index);
      if (table.rows.length > 0) {
        const [head, ...body] = table.rows;
        const startIndex = index;
        index = table.next;
        blocks.push(
          <div key={`table-${startIndex}`} className="lm-md-table-wrap">
            <table className="lm-md-table" data-testid="lm-md-table">
              <thead>
                <tr>
                  {(head ?? []).map((cell, ci) => (
                    <th key={`th-${ci}`} style={columnAlignStyle(table.alignments[ci])}>
                      {renderInlineLegalMarkdown(cell, ctx)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {body.map((row, ri) => (
                  <tr key={`tr-${ri}`}>
                    {row.map((cell, ci) => (
                      <td key={`td-${ri}-${ci}`} style={columnAlignStyle(table.alignments[ci])}>
                        {renderInlineLegalMarkdown(cell, ctx)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>,
        );
        continue;
      }
    }

    const bullet = /^-\s+(.+)$/.exec(line);
    if (bullet) {
      const items: ReactNode[] = [];
      while (index < lines.length) {
        const bulletMatch = /^-\s+(.+)$/.exec(lines[index] ?? "");
        if (!bulletMatch) {
          break;
        }
        items.push(
          <li key={`ul-item-${index}`}>{renderInlineLegalMarkdown(bulletMatch[1], ctx)}</li>,
        );
        index += 1;
      }
      blocks.push(
        <ul key={`ul-${index}`} className="lm-md-list">
          {items}
        </ul>,
      );
      continue;
    }

    const ordered = /^\d+\.\s+(.+)$/.exec(line);
    if (ordered) {
      const items: ReactNode[] = [];
      while (index < lines.length) {
        const orderedMatch = /^\d+\.\s+(.+)$/.exec(lines[index] ?? "");
        if (!orderedMatch) {
          break;
        }
        items.push(
          <li key={`ol-item-${index}`}>{renderInlineLegalMarkdown(orderedMatch[1], ctx)}</li>,
        );
        index += 1;
      }
      blocks.push(
        <ol key={`ol-${index}`} className="lm-md-list lm-md-ol">
          {items}
        </ol>,
      );
      continue;
    }

    blocks.push(
      <div key={`p-${index}`} className="lm-md-p">
        {renderInlineLegalMarkdown(line, ctx)}
      </div>,
    );
    index += 1;
  }

  return <>{blocks}</>;
}
