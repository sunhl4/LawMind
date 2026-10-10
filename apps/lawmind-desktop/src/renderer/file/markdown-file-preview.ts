/**
 * 中栏文本页：哪些路径默认按 Markdown 阅读面打开。
 * `.canvas.tsx` 走画布预览，不在此列。
 */

const MARKDOWN_EXT_RE = /\.(md|markdown|mdx)$/i;

export function isMarkdownWorkbenchPath(pathOrName: string): boolean {
  const base = pathOrName.trim().split(/[/\\]/).pop() ?? "";
  if (!base || /\.canvas\.tsx$/i.test(base)) {
    return false;
  }
  return MARKDOWN_EXT_RE.test(base);
}
