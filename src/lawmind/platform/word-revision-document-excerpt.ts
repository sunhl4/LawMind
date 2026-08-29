/**
 * Short Word excerpt for type inference when the lawyer does not pick a family.
 */

import { readDocxText } from "../agent/tools/legal/ingest-helpers.js";
import { resolveLawyerLocalFile } from "../runtime/lawyer-local-file.js";
import type { ComposeContextPin } from "./compose-context-pin.js";

export const WORD_EXCERPT_MAX_CHARS = 12_000;

export async function readPinnedWordExcerpt(opts: {
  workspaceDir: string;
  projectDir?: string;
  pins?: ComposeContextPin[];
  maxChars?: number;
}): Promise<string> {
  const pins = opts.pins ?? [];
  const maxChars = opts.maxChars ?? WORD_EXCERPT_MAX_CHARS;
  for (const pin of pins) {
    if (pin.pinKind !== "file" || pin.kind !== "file") {
      continue;
    }
    if (!/\.docx$/i.test(pin.relPath)) {
      continue;
    }
    const found = resolveLawyerLocalFile({
      workspaceDir: opts.workspaceDir,
      projectDir: opts.projectDir,
      raw: pin.relPath,
      preferredRoot: pin.root,
      pins,
      wordOnly: true,
    });
    if (!found) {
      continue;
    }
    try {
      const text = await readDocxText(found.abs);
      const clipped = text.trim().slice(0, maxChars);
      if (clipped) {
        return clipped;
      }
    } catch {
      /* next pin */
    }
  }
  return "";
}
