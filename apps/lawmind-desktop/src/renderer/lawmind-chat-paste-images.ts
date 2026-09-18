/**
 * Paste clipboard images into chat context pins (Electron bytes or File.path).
 */

import type { FileChatContextItem } from "./lawmind-file-chat-context";
import type { ChatFileDropPin } from "./lawmind-file-drop-context";

export type PasteImageBridge = {
  getPathForFile?: (file: File) => string | null | undefined;
  importDroppedFiles?: (payload: {
    absPaths: string[];
    matterId?: string | null;
  }) => Promise<{
    ok: boolean;
    items?: Array<ChatFileDropPin & { imported?: boolean }>;
    errors?: string[];
    error?: string;
  }>;
  importPastedBytes?: (payload: {
    bytes: ArrayBuffer | Uint8Array;
    fileName?: string | null;
    mimeType?: string | null;
    matterId?: string | null;
  }) => Promise<{
    ok: boolean;
    root?: "workspace" | "project";
    relPath?: string;
    kind?: "file" | "directory";
    imported?: boolean;
    error?: string;
  }>;
};

function desktopPasteBridge(): PasteImageBridge {
  const desk = typeof window !== "undefined" ? window.lawmindDesktop : undefined;
  return {
    getPathForFile: desk?.getPathForFile,
    importDroppedFiles: desk?.importDroppedFiles,
    importPastedBytes: desk?.importPastedBytes,
  };
}

function isImageFile(file: File): boolean {
  if (file.type.startsWith("image/")) {
    return true;
  }
  return /\.(png|jpe?g|webp|gif|bmp|tiff?)$/i.test(file.name);
}

export async function pinPastedChatImages(opts: {
  clipboardData: DataTransfer | null;
  matterId?: string | null;
  bridge?: PasteImageBridge;
  onAdd: (pin: Pick<FileChatContextItem, "root" | "relPath" | "kind">) => void;
  onError?: (message: string | null) => void;
  onEachPin?: (pin: Pick<FileChatContextItem, "root" | "relPath" | "kind">) => void;
}): Promise<ChatFileDropPin[]> {
  const dt = opts.clipboardData;
  if (!dt?.files?.length) {
    return [];
  }
  const bridge = opts.bridge ?? desktopPasteBridge();
  const pins: ChatFileDropPin[] = [];
  const errors: string[] = [];

  for (const file of Array.from(dt.files)) {
    if (!isImageFile(file)) {
      continue;
    }
    const abs = bridge.getPathForFile?.(file)?.trim() || "";
    if (abs && bridge.importDroppedFiles) {
      const imported = await bridge.importDroppedFiles({
        absPaths: [abs],
        matterId: opts.matterId,
      });
      if (imported.ok && imported.items?.[0]) {
        const pin = {
          root: imported.items[0].root,
          relPath: imported.items[0].relPath,
          kind: imported.items[0].kind,
        };
        pins.push(pin);
        continue;
      }
      if (imported.error || imported.errors?.length) {
        errors.push(imported.error ?? imported.errors?.join(" ") ?? "导入失败");
      }
    }
    if (!bridge.importPastedBytes) {
      errors.push("请在 LawMind 桌面应用中粘贴截图。");
      continue;
    }
    try {
      const buf = await file.arrayBuffer();
      const result = await bridge.importPastedBytes({
        bytes: buf,
        fileName: file.name || "paste.png",
        mimeType: file.type || "image/png",
        matterId: opts.matterId,
      });
      if (result.ok && result.relPath && result.root) {
        pins.push({
          root: result.root,
          relPath: result.relPath,
          kind: result.kind ?? "file",
        });
      } else {
        errors.push(result.error ?? "粘贴图片导入失败");
      }
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }

  if (errors.length > 0) {
    opts.onError?.(errors.join(" "));
  } else if (pins.length > 0) {
    opts.onError?.(null);
  }
  for (const pin of pins) {
    opts.onAdd(pin);
    opts.onEachPin?.(pin);
  }
  return pins;
}
