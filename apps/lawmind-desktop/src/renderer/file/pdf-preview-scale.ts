/** pdf.js maps 72 PDF points → 96 CSS px at viewer scale 1.0 (100%). */
export const PDF_TO_CSS_UNITS = 96 / 72;

/** Viewer scale (1 = 100%) so the page fits the scroller width. */
export function fitViewerScale(containerWidth: number, pageWidthPdfUnits: number): number {
  if (pageWidthPdfUnits <= 0 || containerWidth <= 0) {
    return 1;
  }
  const widthAt100 = pageWidthPdfUnits * PDF_TO_CSS_UNITS;
  const raw = Math.max(0.15, (containerWidth - 32) / widthAt100);
  return Math.round(raw * 50) / 50;
}
