/**
 * Re-export server anchor helpers for renderer (keep IDs in sync with preview API).
 */

export {
  resolveSourceAnchorId,
  sectionAnchorExcerpt,
  slugifyHeadingForAnchor,
  type SourceSectionCiting,
} from "../../server/lawmind-source-anchor.js";

export function scrollToSourceAnchor(anchorId: string): boolean {
  if (typeof document === "undefined") {
    return false;
  }
  const el = document.getElementById(anchorId);
  if (!el) {
    return false;
  }
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  el.classList.add("lm-source-anchor-highlight");
  window.setTimeout(() => el.classList.remove("lm-source-anchor-highlight"), 2400);
  return true;
}
