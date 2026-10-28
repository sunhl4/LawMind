/**
 * 来件附件能不能在 LawMind 里直接看。
 *
 * 只认确定的「只读」格式：图片、PDF、纯文本。HTML / SVG 这类可执行文档
 * 一律按 other 处理，交给下载后用本机应用打开，不在应用里内联渲染。
 */
export type IntakeAttachmentPreviewKind = "image" | "pdf" | "text" | "other";

const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp"]);
const TEXT_EXT = new Set([".txt", ".md", ".csv"]);

export function intakeAttachmentPreviewKind(name: string): IntakeAttachmentPreviewKind {
  const ext = name.toLowerCase().match(/\.[a-z0-9]+$/)?.[0] ?? "";
  if (IMAGE_EXT.has(ext)) {
    return "image";
  }
  if (ext === ".pdf") {
    return "pdf";
  }
  if (TEXT_EXT.has(ext)) {
    return "text";
  }
  return "other";
}
