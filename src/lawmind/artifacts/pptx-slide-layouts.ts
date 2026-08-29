/**
 * Structured PPT slide layouts (not single text-box dumps).
 * Used by training / client decks for agenda, bullets, matrix, checklist.
 */

export type SlideLayoutKind =
  | "titleBody"
  | "agenda"
  | "bullets"
  | "twoColumn"
  | "matrix"
  | "checklist"
  | "quote";

export type ParsedSlideContent = {
  layout: SlideLayoutKind;
  heading: string;
  bullets: string[];
  /** matrix: rows of cells */
  matrix?: string[][];
  left?: string[];
  right?: string[];
  footer?: string;
};

function splitBullets(body: string): string[] {
  return body
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .map((l) => l.replace(/^[-*•]\s+/, "").replace(/^\d+[.)、]\s*/, ""))
    .filter((l) => !/^\|?\s*-+\s*\|/.test(l));
}

function parseMarkdownTable(body: string): string[][] | undefined {
  const lines = body
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("|") && l.endsWith("|"));
  if (lines.length < 2) {
    return undefined;
  }
  const rows = lines
    .filter((l) => !/^\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)+\|?$/.test(l))
    .map((l) =>
      l
        .slice(1, -1)
        .split("|")
        .map((c) => c.trim()),
    )
    .filter((r) => r.some((c) => c.length > 0));
  return rows.length >= 1 ? rows : undefined;
}

/** Infer a layout from section heading/body for professional slide composition. */
export function parseSectionToSlideContent(
  heading: string,
  body: string,
  seeAlso?: string,
): ParsedSlideContent {
  const h = heading.trim();
  const matrix = parseMarkdownTable(body);
  if (matrix && matrix.length >= 2) {
    return { layout: "matrix", heading: h, bullets: [], matrix, footer: seeAlso };
  }
  if (/议程|大纲|目录|agenda/i.test(h)) {
    return {
      layout: "agenda",
      heading: h,
      bullets: splitBullets(body).slice(0, 8),
      footer: seeAlso,
    };
  }
  if (/红旗|行动|清单|checklist|教训|下一步/i.test(h)) {
    return {
      layout: "checklist",
      heading: h,
      bullets: splitBullets(body).slice(0, 8),
      footer: seeAlso,
    };
  }
  if (/脱敏声明|一句话结论|为什么重要/i.test(h)) {
    const bullets = splitBullets(body);
    return {
      layout: "quote",
      heading: h,
      bullets: bullets.length ? bullets : [body.trim().slice(0, 280)],
      footer: seeAlso,
    };
  }
  const bullets = splitBullets(body);
  if (bullets.length >= 4) {
    const mid = Math.ceil(bullets.length / 2);
    return {
      layout: "twoColumn",
      heading: h,
      bullets,
      left: bullets.slice(0, mid),
      right: bullets.slice(mid),
      footer: seeAlso,
    };
  }
  if (bullets.length >= 1) {
    return { layout: "bullets", heading: h, bullets: bullets.slice(0, 8), footer: seeAlso };
  }
  return {
    layout: "titleBody",
    heading: h,
    bullets: [body.trim() || "（无正文）"],
    footer: seeAlso,
  };
}
