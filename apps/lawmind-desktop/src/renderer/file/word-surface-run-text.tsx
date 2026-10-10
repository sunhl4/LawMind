/**
 * Paint `\n` / `\f` as elements. A raw line-feed or form-feed in 宋体
 * shows up as a box; a `<br>` does not.
 */
import { Fragment, type ReactNode } from "react";

export function renderWordRunText(text: string): ReactNode {
  if (!text.includes("\n") && !text.includes("\f")) {
    return text;
  }
  const parts = text.split(/(\n|\f)/u);
  return parts.map((part, index) => {
    if (part === "\n") {
      return <br key={index} />;
    }
    if (part === "\f") {
      return <span key={index} className="lm-word-break-page-inline" data-word-break="page" />;
    }
    if (!part) {
      return null;
    }
    return <Fragment key={index}>{part}</Fragment>;
  });
}
