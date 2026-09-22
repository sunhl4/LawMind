/** Source citation → draft section anchor (shared by route + renderer). */

export type SourceSectionCiting = {
  heading: string;
  anchorId: string;
  excerpt?: string;
};

export function slugifyHeadingForAnchor(heading: string): string {
  const base = heading
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9\u4e00-\u9fff-]/gi, "")
    .slice(0, 48);
  return base || "section";
}

export function resolveSourceAnchorId(taskId: string, heading: string): string {
  return `lm-source-anchor-${taskId}-${slugifyHeadingForAnchor(heading)}`;
}

export function sectionAnchorExcerpt(body: string, maxLen = 160): string {
  const t = body.replace(/\s+/g, " ").trim();
  if (!t) {
    return "";
  }
  return t.length <= maxLen ? t : `${t.slice(0, maxLen)}…`;
}
