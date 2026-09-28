/**
 * Revision export only accepts `.docx`. Binary `.doc` may still be read for text,
 * but must not be a tracked-change baseline.
 */

import path from "node:path";

/** Lawyer-facing copy when a revision needs a `.docx` and the file is still `.doc`. */
export const DOC_NEEDS_DOCX_MESSAGE =
  "这份文件是旧版 Word（.doc）。修订只能写在 .docx 上。请用 Word 或 WPS 将它另存为同名的 .docx 后再继续；原 .doc 不用改。";

export const DOC_NEEDS_DOCX_CODE = "doc_needs_docx";

/** True for Word 97–2003 `.doc`, not `.docx`. */
export function isBinaryWordDocBaseline(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return ext === ".doc";
}
