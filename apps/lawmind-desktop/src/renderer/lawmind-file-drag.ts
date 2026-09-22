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

export function dataTransferHasType(dt: DataTransfer | null, mime: string): boolean {
  if (!dt) {
    return false;
  }
  return [...dt.types].includes(mime);
}

export function isLawmindFsDrag(dt: DataTransfer | null): boolean {
  return dataTransferHasType(dt, LAWMID_FS_DRAG_MIME);
}

/** Finder / Explorer / file-list drag (not internal file-tree MIME). */
export function isOsFileDrag(dt: DataTransfer | null): boolean {
  return dataTransferHasType(dt, "Files") || dataTransferHasType(dt, "text/uri-list");
}

export function isChatFileDrop(dt: DataTransfer | null): boolean {
  return isLawmindFsDrag(dt) || isOsFileDrag(dt);
}

export function electronFilePath(file: File | null | undefined): string | null {
  if (!file) {
    return null;
  }
  const withPath = file as File & { path?: string };
  return typeof withPath.path === "string" && withPath.path.trim() ? withPath.path.trim() : null;
}

export function droppedFileAbsPath(
  file: File | null | undefined,
  getPathForFile?: (file: File) => string | null | undefined,
): string | null {
  if (!file) {
    return null;
  }
  const fromBridge = getPathForFile?.(file);
  if (typeof fromBridge === "string" && fromBridge.trim()) {
    return fromBridge.trim();
  }
  return electronFilePath(file);
}

/** `file:///Users/a/b.docx` or `file:///C:/Users/a/b.docx` → absolute path. */
export function fileUrlToAbsPath(raw: string | undefined | null): string | null {
  const line = (raw ?? "").trim();
  if (!line || line.startsWith("#")) {
    return null;
  }
  const lower = line.toLowerCase();
  if (!lower.startsWith("file:")) {
    if (line.startsWith("/") || /^[A-Za-z]:[\\/]/.test(line)) {
      return line.replace(/\\/g, "/");
    }
    return null;
  }
  try {
    const url = new URL(line);
    let pathname = decodeURIComponent(url.pathname);
    if (/^\/[A-Za-z]:\//.test(pathname)) {
      pathname = pathname.slice(1);
    }
    return pathname || null;
  } catch {
    return null;
  }
}

export function parseFileUriList(raw: string | undefined | null): string[] {
  if (!raw?.trim()) {
    return [];
  }
  const out: string[] = [];
  const seen = new Set<string>();
  for (const line of raw.split(/\r?\n/)) {
    const abs = fileUrlToAbsPath(line);
    if (!abs || seen.has(abs)) {
      continue;
    }
    seen.add(abs);
    out.push(abs);
  }
  return out;
}

export type DroppedAbsItem = {
  absPath: string;
  kind: "file" | "directory";
};

function pushDroppedAbs(items: DroppedAbsItem[], seen: Set<string>, absPath: string, kind: "file" | "directory"): void {
  const n = absPath.replace(/\\/g, "/").trim();
  if (!n || seen.has(n)) {
    return;
  }
  seen.add(n);
  items.push({ absPath: n, kind });
}

/**
 * Absolute paths from an OS file drop. Internal file-tree MIME is ignored here
 * (callers should prefer `readLawmindFsDragFromDataTransfer` first).
 */
export function collectDroppedAbsItems(
  dt: DataTransfer | null,
  getPathForFile?: (file: File) => string | null | undefined,
): DroppedAbsItem[] {
  if (!dt) {
    return [];
  }
  const items: DroppedAbsItem[] = [];
  const seen = new Set<string>();
  const dtItems = dt.items;
  if (dtItems && dtItems.length > 0) {
    for (let i = 0; i < dtItems.length; i += 1) {
      const item = dtItems[i];
      if (!item || item.kind !== "file") {
        continue;
      }
      const file = item.getAsFile();
      const entry = (
        item as DataTransferItem & {
          webkitGetAsEntry?: () => { isDirectory?: boolean } | null;
        }
      ).webkitGetAsEntry?.();
      const kind: "file" | "directory" = entry?.isDirectory ? "directory" : "file";
      const abs = droppedFileAbsPath(file, getPathForFile);
      if (abs) {
        pushDroppedAbs(items, seen, abs, kind);
      }
    }
  }
  if (items.length === 0 && dt.files && dt.files.length > 0) {
    for (let i = 0; i < dt.files.length; i += 1) {
      const file = dt.files[i];
      const abs = droppedFileAbsPath(file, getPathForFile);
      if (abs) {
        pushDroppedAbs(items, seen, abs, "file");
      }
    }
  }
  if (items.length === 0) {
    const uris = parseFileUriList(dt.getData("text/uri-list") || dt.getData("text/plain"));
    for (const abs of uris) {
      pushDroppedAbs(items, seen, abs, "file");
    }
  }
  return items;
}
