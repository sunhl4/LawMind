/** 将内部编号放进 title，正文尽量用人话，减少「随机码」干扰 */

export function internalIdsTitle(lines: Array<{ label: string; value: string | null | undefined }>): string {
  return lines
    .filter((x) => x.value)
    .map((x) => `${x.label}：${x.value}`)
    .join("\n");
}

/** 长串内部编号：缩写展示，完整值放 title */
export function shortenOpaqueId(id: string, head = 6, tail = 4): string {
  const t = id.trim();
  if (t.length <= head + tail + 1) {
    return t;
  }
  return `${t.slice(0, head)}…${t.slice(-tail)}`;
}

export function pathBasename(p: string): string {
  const normalized = p.replace(/\\/g, "/").replace(/\/+$/, "");
  const seg = normalized.split("/").filter(Boolean);
  return seg.length ? seg.at(-1)! : p;
}

/** 列表标题一行：优先业务摘要，避免整行都是内部 id */
export function ellipsisText(s: string, maxChars: number): string {
  const t = s.trim();
  if (t.length <= maxChars) {
    return t;
  }
  return `${t.slice(0, maxChars)}…`;
}
