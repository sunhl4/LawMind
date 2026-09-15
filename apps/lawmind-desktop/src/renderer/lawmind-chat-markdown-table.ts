export type TableColumnAlign = "left" | "center" | "right" | undefined;

export function splitMarkdownTableRow(raw: string): string[] {
  const trimmed = raw.trim();
  const inner = trimmed.replace(/^\|/, "").replace(/\|$/, "");
  return inner.split("|").map((cell) => cell.trim());
}

export function isGfmTableSeparator(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed || !trimmed.includes("-")) {
    return false;
  }
  if (!/^[:|\-\s]+$/.test(trimmed)) {
    return false;
  }
  const cells = splitMarkdownTableRow(trimmed);
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

export function parseGfmTableAlignments(separatorLine: string): TableColumnAlign[] {
  return splitMarkdownTableRow(separatorLine).map((cell) => {
    const left = cell.startsWith(":");
    const right = cell.endsWith(":");
    if (left && right) {
      return "center";
    }
    if (right) {
      return "right";
    }
    if (left) {
      return "left";
    }
    return undefined;
  });
}

export function isMarkdownTableBlockStart(lines: string[], index: number): boolean {
  const line = (lines[index] ?? "").trim();
  if (!line.includes("|")) {
    return false;
  }
  const next = (lines[index + 1] ?? "").trim();
  if (isGfmTableSeparator(next)) {
    return true;
  }
  return line.startsWith("|");
}

export function consumeMarkdownTable(
  lines: string[],
  index: number,
): { rows: string[][]; alignments: TableColumnAlign[]; next: number } {
  const rows: string[][] = [];
  let alignments: TableColumnAlign[] = [];
  let cursor = index;
  while (cursor < lines.length) {
    const raw = (lines[cursor] ?? "").trim();
    if (!raw.includes("|")) {
      break;
    }
    if (isGfmTableSeparator(raw)) {
      alignments = parseGfmTableAlignments(raw);
      cursor += 1;
      continue;
    }
    rows.push(splitMarkdownTableRow(raw));
    cursor += 1;
  }
  return { rows, alignments, next: cursor };
}
