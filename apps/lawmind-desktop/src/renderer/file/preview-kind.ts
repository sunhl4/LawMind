import { isImageLikePath, isOfficeLikePath } from "./file-workbench-fs";
import type { FilePreviewKind } from "./file-workbench-types";

/** Map a relative path to the middle-column preview kind. */
export function resolvePreviewKind(relPath: string): FilePreviewKind {
  const low = relPath.toLowerCase();
  if (/\.docx$/i.test(low)) {
    return "word";
  }
  if (/\.pdf$/i.test(low)) {
    return "pdf";
  }
  if (/\.xlsx$/i.test(low)) {
    return "xlsx";
  }
  if (/\.(mp3|wav|m4a|aac|ogg|flac|mp4|webm|mov|m4v)$/i.test(low)) {
    return "media";
  }
  if (/\.eml$/i.test(low)) {
    return "eml";
  }
  if (/\.zip$/i.test(low)) {
    return "zip";
  }
  if (/\.doc$/i.test(low) && !/\.docx$/i.test(low)) {
    return "doc";
  }
  if (isImageLikePath(relPath)) {
    return "image";
  }
  if (isOfficeLikePath(relPath)) {
    return "fallback";
  }
  return "text";
}

export function isBinaryPreviewKind(kind: FilePreviewKind): boolean {
  return kind !== "text";
}
