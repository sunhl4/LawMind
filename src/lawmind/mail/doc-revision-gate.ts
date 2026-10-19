/**
 * `.doc` is read in-process from its OLE container. This message only shows when
 * that read yields nothing: encrypted, Word 6/95, or a corrupt container.
 */

import path from "node:path";

/** Lawyer-facing copy when the container cannot be read. */
export const DOC_NEEDS_DOCX_MESSAGE =
  "这份是旧版 Word（.doc），但正文没能读出来。常见原因是文档加密、Word 6/95 旧格式或文件损坏。请用 WPS 或 Word 打开确认后，另存为 .docx 再试；原 .doc 不用改。";

export const DOC_NEEDS_DOCX_CODE = "doc_needs_docx";

/** True for Word 97–2003 `.doc`, not `.docx`. */
export function isBinaryWordDocBaseline(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return ext === ".doc";
}
