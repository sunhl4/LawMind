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
