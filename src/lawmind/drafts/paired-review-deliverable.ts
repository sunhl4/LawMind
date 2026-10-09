/**
 * Word pins on a turn. A pinned Word is not by itself a tracked-redline deliverable.
 */

import type { ComposeContextPin } from "../platform/compose-context-pin.js";

export function wordFilePinRelPaths(pins: readonly ComposeContextPin[] | undefined): string[] {
  const out: string[] = [];
  for (const pin of pins ?? []) {
    if (pin.pinKind !== "file" || pin.kind !== "file") {
      continue;
    }
    if (/\.docx?$/i.test(pin.relPath)) {
      out.push(pin.relPath);
    }
  }
  return out;
}

export function pinsIncludeWordFile(pins: readonly ComposeContextPin[] | undefined): boolean {
  return wordFilePinRelPaths(pins).length > 0;
}
