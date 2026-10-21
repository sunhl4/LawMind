/**
 * WordprocessingML 标签定位的单一实现。
 *
 * 为什么必须按同名标签计数：`w:pPr` / `w:rPr` / `w:tblPr` / `w:trPr` / `w:tcPr`
 * **可以嵌套**。格式修订就写成
 * `<w:rPrChange><w:rPr>旧属性</w:rPr></w:rPrChange>`，
 * 属性变更写成 `<w:pPrChange><w:pPr>…</w:pPr></w:pPrChange>`。
 * 用 `indexOf("</w:rPr>")` 的懒惰写法先撞上的是**内层**闭合，会截断外层：
 * 读侧把半截 XML 当属性解析，写侧重建出不闭合的 `document.xml`（Word 报
 * 「内容有问题」）。这里统一按深度配对，属性值里的 `>`（`w:val="a>b"`）由
 * 引号状态机跳过。
 *
 * 调用方：格式审计 / 修订预览 / 修订写入（`word-revision`）/ 格式自动修。
 * 改动这里等于同时改四条路径，先跑 `word-xml-span.test.ts` 与四边的回归。
 */

/** `<w:name` 之后必须是属性、`>` 或 `/>`，否则是 `<w:nameXxx`。 */
export function isWordNameBoundary(xml: string, index: number): boolean {
  const next = xml[index];
  return next === ">" || next === "/" || (next !== undefined && /\s/u.test(next));
}

export function indexOfWordOpen(xml: string, name: string, from = 0): number {
  const needle = `<w:${name}`;
  let cursor = from;
  while (cursor < xml.length) {
    const start = xml.indexOf(needle, cursor);
    if (start < 0) {
      return -1;
    }
    if (isWordNameBoundary(xml, start + needle.length)) {
      return start;
    }
    cursor = start + needle.length;
  }
  return -1;
}

/** 起始标签 `>` 的下标；引号内的 `>` 不算。 */
export function indexOfXmlTagEnd(xml: string, from: number): number {
  let quote: '"' | "'" | null = null;
  for (let i = from; i < xml.length; i += 1) {
    const ch = xml[i];
    if (quote) {
      if (ch === quote) {
        quote = null;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === ">") {
      return i;
    }
  }
  return -1;
}

/**
 * 配对闭合标签**之后**的下标；未闭合（含被截断的 XML）返回 `-1`。
 *
 * 自闭合的子元素（`<w:rPr/>`）不增加深度——旧实现把它算作一层，遇到外层闭合
 * 时深度还差一层，于是把「未闭合」误判成真的。
 */
function matchingCloseEnd(xml: string, openStart: number, name: string): number {
  const openEnd = indexOfXmlTagEnd(xml, openStart);
  if (openEnd < 0) {
    return -1;
  }
  if (xml[openEnd - 1] === "/") {
    return openEnd + 1;
  }
  const closeNeedle = `</w:${name}>`;
  let depth = 1;
  let cursor = openEnd + 1;
  while (cursor < xml.length) {
    const nextOpen = indexOfWordOpen(xml, name, cursor);
    const nextClose = xml.indexOf(closeNeedle, cursor);
    if (nextClose < 0) {
      return -1;
    }
    if (nextOpen >= 0 && nextOpen < nextClose) {
      const childOpenEnd = indexOfXmlTagEnd(xml, nextOpen);
      if (childOpenEnd < 0) {
        return -1;
      }
      if (xml[childOpenEnd - 1] !== "/") {
        depth += 1;
      }
      cursor = childOpenEnd + 1;
      continue;
    }
    depth -= 1;
    cursor = nextClose + closeNeedle.length;
    if (depth === 0) {
      return cursor;
    }
  }
  return -1;
}

/**
 * 历史契约：未闭合时返回 `xml.length`（调用方把切片当作「到文末」）。
 * 需要区分「真的闭合」与「被截断」时用 `elementSpan`。
 */
export function indexOfMatchingClose(xml: string, openStart: number, name: string): number {
  const end = matchingCloseEnd(xml, openStart, name);
  return end < 0 ? xml.length : end;
}

export type WordElementSpan = {
  /** `<w:name` 的起始下标。 */
  start: number;
  /** 元素之后（含闭合标签）的下标。 */
  end: number;
  innerStart: number;
  innerEnd: number;
  selfClosing: boolean;
};

/**
 * 定位最外层 `<w:name>`。未闭合或找不到时返回 `undefined`——绝不返回半截，
 * 否则写侧会把残缺 XML 拼回去。
 */
export function elementSpan(xml: string, name: string, from = 0): WordElementSpan | undefined {
  const start = indexOfWordOpen(xml, name, from);
  if (start < 0) {
    return undefined;
  }
  const openEnd = indexOfXmlTagEnd(xml, start);
  if (openEnd < 0) {
    return undefined;
  }
  if (xml[openEnd - 1] === "/") {
    return {
      start,
      end: openEnd + 1,
      innerStart: openEnd + 1,
      innerEnd: openEnd + 1,
      selfClosing: true,
    };
  }
  const end = matchingCloseEnd(xml, start, name);
  if (end < 0) {
    return undefined;
  }
  return {
    start,
    end,
    innerStart: openEnd + 1,
    innerEnd: end - `</w:${name}>`.length,
    selfClosing: false,
  };
}

/** 最外层 `<w:name>` 的内文；找不到 / 自闭合 / 未闭合时返回 `""`。 */
export function elementInner(xml: string, name: string): string {
  const span = elementSpan(xml, name);
  if (!span || span.selfClosing) {
    return "";
  }
  return xml.slice(span.innerStart, span.innerEnd);
}
