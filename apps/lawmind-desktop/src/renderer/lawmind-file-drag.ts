/**
 * HTML5 drag payload for workspace/project file tree → chat/meeting pins.
 */

import type { RootKey } from "./file/file-workbench-types";

export const LAWMID_FS_DRAG_MIME = "application/x-lawmind-fs-item";

export type LawmindFsDragPayload = {
  root: RootKey;
  relPath: string;
  kind: "file" | "directory";
};

export function encodeLawmindFsDrag(payload: LawmindFsDragPayload): string {
  return JSON.stringify(payload);
}

export function parseLawmindFsDrag(raw: string | undefined | null): LawmindFsDragPayload | null {
  if (!raw?.trim()) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<LawmindFsDragPayload>;
    if (parsed.root !== "workspace" && parsed.root !== "project") {
      return null;
    }
    if (parsed.kind !== "file" && parsed.kind !== "directory") {
      return null;
    }
    if (typeof parsed.relPath !== "string") {
      return null;
    }
    return {
      root: parsed.root,
      relPath: parsed.relPath,
      kind: parsed.kind,
    };
  } catch {
    return null;
  }
}

export function readLawmindFsDragFromDataTransfer(
  dt: DataTransfer | null,
): LawmindFsDragPayload | null {
  if (!dt) {
    return null;
  }
  return parseLawmindFsDrag(dt.getData(LAWMID_FS_DRAG_MIME));
}
