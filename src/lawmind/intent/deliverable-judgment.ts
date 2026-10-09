/**
 * Tracked-change export can only target an editable Word.
 * The model names the file. This does not decide what the deliverable should be.
 */

const NON_REVISABLE_EXT = /\.(?:pdf|png|jpe?g|gif|webp|tif|tiff|bmp)$/i;

export const PDF_NOT_REVISABLE_MESSAGE =
  "审阅痕迹只能落在可编辑 Word 上。这份基线是 PDF 或图片，不能导出修订稿。";

export type TrackedBaselineRefusal = {
  code: "pdf_not_revisable";
  message: string;
};

/** The path itself cannot carry Word tracked changes. */
export function trackedBaselineRefusal(
  baselineRel: string | undefined,
): TrackedBaselineRefusal | undefined {
  const baseline = baselineRel?.trim() ?? "";
  if (baseline && NON_REVISABLE_EXT.test(baseline)) {
    return { code: "pdf_not_revisable", message: PDF_NOT_REVISABLE_MESSAGE };
  }
  return undefined;
}

/**
 * Whether an omitted task_id may keep writing the focused draft.
 * An explicit task_id skips this. A follow-up with no new file is not
 * automatically the open draft; the model passes task_id when it still is.
 */
export function mayImplicitlyReuseLinkedDraft(opts: {
  wordRevisionTurn?: boolean;
  mailContractTurn?: boolean;
}): boolean {
  return opts.wordRevisionTurn === true || opts.mailContractTurn === true;
}
