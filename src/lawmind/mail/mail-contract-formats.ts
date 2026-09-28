/**
 * Contract-attachment classification for mail review automations.
 * Only `.docx` is ready for surgical edit + tracked export.
 * Binary `.doc` must be saved as `.docx` by the lawyer before redline.
 * Other formats use the opinion (analyze_document) path, or a converter for wps/rtf/odt.
 */

export type ContractAttachmentKind =
  | "tracked_word"
  | "legacy_doc"
  | "convertible_word"
  | "analyzable"
  | "other";

/** Ready for tracked redline — OpenXML `.docx` only. */
const TRACKED_WORD_RE = /\.docx$/i;

/** Word 97–2003 binary — readable as text, not a revision baseline. */
const LEGACY_DOC_RE = /\.doc$/i;

/** Alternate word-like formats that may need a converter for tracked export. */
const CONVERTIBLE_WORD_RE = /\.(wps|rtf|odt)$/i;

/** Readable via analyze_document (PDF text/OCR, image OCR, plain text). */
const ANALYZABLE_RE = /\.(pdf|png|jpe?g|webp|bmp|tif|tiff|txt|md|docm)$/i;

export function attachmentExtension(name: string): string {
  const base = name.trim().toLowerCase().replace(/\\/g, "/");
  const leaf = base.includes("/") ? (base.split("/").pop() ?? base) : base;
  const dot = leaf.lastIndexOf(".");
  return dot > 0 ? leaf.slice(dot) : "";
}

export function classifyContractAttachment(nameOrPath: string): ContractAttachmentKind {
  const ext = attachmentExtension(nameOrPath);
  if (!ext) {
    return "other";
  }
  if (TRACKED_WORD_RE.test(ext)) {
    return "tracked_word";
  }
  if (LEGACY_DOC_RE.test(ext)) {
    return "legacy_doc";
  }
  if (CONVERTIBLE_WORD_RE.test(ext)) {
    return "convertible_word";
  }
  if (ANALYZABLE_RE.test(ext)) {
    return "analyzable";
  }
  return "other";
}

export function isReviewableContractAttachment(nameOrPath: string): boolean {
  return classifyContractAttachment(nameOrPath) !== "other";
}

/** @deprecated Prefer isTrackedWordAttachment — kept for call-site clarity. */
export function isTrackedDocxAttachment(nameOrPath: string): boolean {
  return isTrackedWordAttachment(nameOrPath);
}

export function isTrackedWordAttachment(nameOrPath: string): boolean {
  return classifyContractAttachment(nameOrPath) === "tracked_word";
}

/** Image formats persisted from mail for OCR / vision review. */
export const MAIL_IMAGE_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".bmp",
  ".tif",
  ".tiff",
]);

export function isMailImageAttachment(nameOrPath: string): boolean {
  return MAIL_IMAGE_EXTENSIONS.has(attachmentExtension(nameOrPath));
}
