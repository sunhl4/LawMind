import type { FileChatContextItem } from "./lawmind-file-chat-context";
import { instructionLooksLikeWordEdit } from "../../../../src/lawmind/platform/word-revision-instruction.ts";
import { readRecentFileContextPaths } from "./lawmind-compose-context";

export type ActiveWordFile = {
  root: "workspace" | "project";
  relPath: string;
};

let activeWorkbenchWord: ActiveWordFile | null = null;

export function setActiveWorkbenchWordFile(file: ActiveWordFile | null): void {
  if (!file?.relPath.trim() || !/\.docx?$/i.test(file.relPath)) {
    activeWorkbenchWord = null;
    return;
  }
  activeWorkbenchWord = { root: file.root, relPath: file.relPath.trim().replace(/\\/g, "/") };
}

export function readActiveWorkbenchWordFile(): ActiveWordFile | null {
  return activeWorkbenchWord;
}

export function chatLooksLikeWordEdit(text: string): boolean {
  return instructionLooksLikeWordEdit(text) || /导出|出稿|打开结果|改稿|修订|立场/.test(text);
}

function isWordFile(relPath: string): boolean {
  return /\.docx?$/i.test(relPath);
}

/** When the lawyer types 修改/导出 in 对话 without a pin, reuse the open or last Word. */
export function resolveImplicitWordPinsForChat(params: {
  text: string;
  existing: Array<Pick<FileChatContextItem, "root" | "relPath" | "kind">>;
}): Array<Pick<FileChatContextItem, "root" | "relPath" | "kind">> {
  if (!chatLooksLikeWordEdit(params.text)) {
    return [];
  }
  if (params.existing.some((it) => it.kind === "file" && isWordFile(it.relPath))) {
    return [];
  }
  const active = readActiveWorkbenchWordFile();
  if (active) {
    return [{ root: active.root, relPath: active.relPath, kind: "file" }];
  }
  const recent = readRecentFileContextPaths().find(
    (it) => it.kind === "file" && isWordFile(it.relPath),
  );
  return recent ? [recent] : [];
}
