import type { ReactNode } from "react";

export function renderInlineLegalMarkdown(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const tokenRe = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = tokenRe.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }
    const token = match[0];
    if (token.startsWith("**")) {
      nodes.push(<strong key={`strong-${match.index}`}>{token.slice(2, -2)}</strong>);
    } else {
      nodes.push(
        <code key={`code-${match.index}`} className="lm-md-code">
          {token.slice(1, -1)}
        </code>,
      );
    }
    lastIndex = match.index + token.length;
  }
  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }
  return nodes;
}

export function renderLegalMarkdown(text: string): ReactNode {
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

    if (/^---+$/.test(trimmed)) {
      blocks.push(<hr key={`hr-${index}`} className="lm-md-hr" />);
      index += 1;
      continue;
    }

    const h1 = /^#\s+(.+)$/.exec(line);
    if (h1) {
      blocks.push(
        <div key={`h1-${index}`} className="lm-md-h1">
          {renderInlineLegalMarkdown(h1[1])}
        </div>,
      );
      index += 1;
      continue;
    }

    const h2 = /^##\s+(.+)$/.exec(line);
    if (h2) {
      blocks.push(
        <div key={`h2-${index}`} className="lm-md-h2">
          {renderInlineLegalMarkdown(h2[1])}
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
            <div key={`bq-line-${qi}`}>{renderInlineLegalMarkdown(ql)}</div>
          ))}
        </blockquote>,
      );
      continue;
    }

    if (trimmed.includes("|") && trimmed.startsWith("|")) {
      const tableRows: string[][] = [];
      while (index < lines.length) {
        const raw = (lines[index] ?? "").trim();
        if (!raw.includes("|")) {
          break;
        }
        if (/^\|?\s*:?-{3,}/.test(raw)) {
          index += 1;
          continue;
        }
        const cells = raw
          .replace(/^\|/, "")
          .replace(/\|$/, "")
          .split("|")
          .map((c) => c.trim());
        tableRows.push(cells);
        index += 1;
      }
      if (tableRows.length > 0) {
        const [head, ...body] = tableRows;
        blocks.push(
          <table key={`table-${index}`} className="lm-md-table">
            <thead>
              <tr>
                {(head ?? []).map((cell, ci) => (
                  <th key={`th-${ci}`}>{renderInlineLegalMarkdown(cell)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {body.map((row, ri) => (
                <tr key={`tr-${ri}`}>
                  {row.map((cell, ci) => (
                    <td key={`td-${ri}-${ci}`}>{renderInlineLegalMarkdown(cell)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>,
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
          <li key={`ul-item-${index}`}>{renderInlineLegalMarkdown(bulletMatch[1])}</li>,
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
          <li key={`ol-item-${index}`}>{renderInlineLegalMarkdown(orderedMatch[1])}</li>,
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
        {renderInlineLegalMarkdown(line)}
      </div>,
    );
    index += 1;
  }

  return <>{blocks}</>;
}
