import type { FileChatContextItem } from "./lawmind-file-chat-context";
import {
  collectDroppedAbsItems,
  droppedFileAbsPath,
  isChatFileDrop,
  isLawmindFsDrag,
  readLawmindFsDragFromDataTransfer,
  type LawmindFsDragPayload,
} from "./lawmind-file-drag";
import { resolveRelForAbs } from "./lawmind-workspace-relpath";

export const CHAT_FILE_DROP_MAX = 8;

export type ChatFileDropPin = Pick<FileChatContextItem, "root" | "relPath" | "kind">;

export type ImportDroppedFilesResult = {
  ok: boolean;
  items?: Array<ChatFileDropPin & { imported?: boolean }>;
  errors?: string[];
  error?: string;
};

export type ChatFileDropBridge = {
  getPathForFile?: (file: File) => string | null | undefined;
  importDroppedFiles?: (payload: {
    absPaths: string[];
    matterId?: string | null;
  }) => Promise<ImportDroppedFilesResult>;
};

export type ApplyChatFileDropResult = {
  pins: ChatFileDropPin[];
  errors: string[];
};

function desktopDropBridge(): ChatFileDropBridge {
  const desk = typeof window !== "undefined" ? window.lawmindDesktop : undefined;
  return {
    getPathForFile: desk?.getPathForFile,
    importDroppedFiles: desk?.importDroppedFiles,
  };
}

export function mapAbsItemToChatPin(
  item: { absPath: string; kind: "file" | "directory" },
  roots: { workspaceDir?: string | null; projectDir?: string | null },
): ChatFileDropPin | null {
  const mapped = resolveRelForAbs(roots.workspaceDir, roots.projectDir, item.absPath);
  if (!mapped) {
    return null;
  }
  if (!mapped.rel && item.kind !== "directory") {
    return null;
  }
  return { root: mapped.root, relPath: mapped.rel, kind: item.kind };
}

function pinKey(p: ChatFileDropPin): string {
  return `${p.root}|${p.kind}|${p.relPath}`;
}

function pushUniquePin(pins: ChatFileDropPin[], pin: ChatFileDropPin): void {
  const key = pinKey(pin);
  if (pins.some((p) => pinKey(p) === key)) {
    return;
  }
  if (pins.length >= CHAT_FILE_DROP_MAX) {
    return;
  }
  pins.push(pin);
}

function fsPayloadToPin(payload: LawmindFsDragPayload): ChatFileDropPin {
  return {
    root: payload.root,
    relPath: payload.relPath.replace(/^\/+/, ""),
    kind: payload.kind,
  };
}

/**
 * Resolve a conversation drop: internal file-tree MIME, or OS files whose path
 * is under the workspace/project; remaining files are copied in via Electron.
 */
export async function applyChatFileDrop(opts: {
  dataTransfer: DataTransfer | null;
  workspaceDir?: string | null;
  projectDir?: string | null;
  matterId?: string | null;
  bridge?: ChatFileDropBridge;
}): Promise<ApplyChatFileDropResult> {
  const dt = opts.dataTransfer;
  const pins: ChatFileDropPin[] = [];
  const errors: string[] = [];
  if (!dt || !isChatFileDrop(dt)) {
    return { pins, errors };
  }

  if (isLawmindFsDrag(dt)) {
    const payload = readLawmindFsDragFromDataTransfer(dt);
    if (payload) {
      pushUniquePin(pins, fsPayloadToPin(payload));
    }
    return { pins, errors };
  }

  const bridge = opts.bridge ?? desktopDropBridge();
  const absItems = collectDroppedAbsItems(dt, (file) =>
    droppedFileAbsPath(file, bridge.getPathForFile),
  );
  if (absItems.length === 0) {
    errors.push("未能识别文件路径。请从 LawMind 桌面应用拖入，或先把文件放到工作区/材料夹。");
    return { pins, errors };
  }

  const importer = bridge.importDroppedFiles;
  // Desktop importer stats the path (file vs directory) and pins in-workspace
  // trees without copying — same as Codex `--add-dir`, then `ls`.
  if (importer) {
    const toImport = absItems.map((item) => item.absPath).slice(0, CHAT_FILE_DROP_MAX);
    try {
      const imported = await importer({
        absPaths: toImport,
        matterId: opts.matterId ?? null,
      });
      if (imported.error?.trim()) {
        errors.push(imported.error.trim());
      }
      for (const msg of imported.errors ?? []) {
        if (msg.trim()) {
          errors.push(msg.trim());
        }
      }
      for (const item of imported.items ?? []) {
        if (item.relPath == null) {
          continue;
        }
        const relPath = item.relPath.replace(/^\/+/, "");
        if (!relPath && item.kind !== "directory") {
          continue;
        }
        pushUniquePin(pins, {
          root: item.root === "project" ? "project" : "workspace",
          relPath,
          kind: item.kind === "directory" ? "directory" : "file",
        });
      }
    } catch {
      errors.push("无法把工作区外的文件收进本案。请检查文件是否仍在原位置。");
    }
    return { pins, errors };
  }

  const outside: string[] = [];
  for (const item of absItems) {
    if (pins.length >= CHAT_FILE_DROP_MAX) {
      break;
    }
    const mapped = mapAbsItemToChatPin(item, {
      workspaceDir: opts.workspaceDir,
      projectDir: opts.projectDir,
    });
    if (mapped) {
      pushUniquePin(pins, mapped);
      continue;
    }
    outside.push(item.absPath);
  }

  if (outside.length > 0) {
    errors.push("工作区外的文件需要 LawMind 桌面应用才能自动收进本案。");
  }
  return { pins, errors };
}

export async function pinDroppedChatFiles(opts: {
  dataTransfer: DataTransfer;
  workspaceDir?: string | null;
  projectDir?: string | null;
  matterId?: string | null;
  bridge?: ChatFileDropBridge;
  onAdd: (pin: ChatFileDropPin) => void;
  onError?: (message: string | null) => void;
  onEachPin?: (pin: ChatFileDropPin) => void;
}): Promise<ChatFileDropPin[]> {
  const result = await applyChatFileDrop(opts);
  if (result.errors.length > 0) {
    opts.onError?.(result.errors.join(" "));
  } else if (result.pins.length > 0) {
    opts.onError?.(null);
  }
  for (const pin of result.pins) {
    opts.onAdd(pin);
    opts.onEachPin?.(pin);
  }
  return result.pins;
}
