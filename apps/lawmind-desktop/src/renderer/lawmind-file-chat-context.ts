import { useCallback, useRef, useState } from "react";

const MAX_FILE_CHAT_CONTEXT = 8;

export type FileChatContextItem = {
  id: string;
  root: "workspace" | "project";
  relPath: string;
  kind: "file" | "directory";
};

export function formatFileChatContextPill(
  it: FileChatContextItem,
  maxPath = 24,
): { shortLabel: string; title: string } {
  const scope = it.root === "workspace" ? "工作区" : "项目";
  const kind = it.kind === "directory" ? "目录" : "文件";
  const path = it.relPath.trim() || scope;
  const title = `${scope} ${kind}：${it.relPath || "（根）"}`;
  const ellipsize = (s: string) => (s.length <= maxPath ? s : `…${s.slice(-(maxPath - 1))}`);
  return { shortLabel: `${kind === "目录" ? "📁" : "📄"} ${ellipsize(path)}`, title };
}

export function makeFileContextItemId(
  p: Pick<FileChatContextItem, "root" | "relPath" | "kind">,
): string {
  return `${p.root}|${p.kind}|${encodeURIComponent(p.relPath)}`;
}

export function buildFileContextMessagePrefix(items: FileChatContextItem[]): string {
  if (items.length === 0) {
    return "";
  }
  const lines = items.map((it) => {
    const scope = it.root === "workspace" ? "工作区" : "项目";
    const p = it.relPath || "（工作区/项目根，谨慎操作）";
    if (it.root === "workspace") {
      const hint =
        it.kind === "directory"
          ? "请先在目录中定位要读的文件，用 analyze_document 读工作区相对路径。"
          : "请用 analyze_document 读取以下工作区相对路径。";
      return `- [${scope} · ${it.kind === "directory" ? "目录" : "文件"}] \`${p}\` — ${hint}`;
    }
    const hint =
      it.kind === "directory"
        ? "对项目内文件用 read_project_file(相对项目根的路径) 逐份阅读；目录下请先列举再选读。"
        : "请用 read_project_file 读取。";
    return `- [${scope} · ${it.kind === "directory" ? "目录" : "文件"}] \`${p}\` — ${hint}`;
  });
  return `【用户在 LawMind 文件页将下列路径标为“本回合重点”】\n${lines.join("\n")}\n\n`;
}

export function useFileChatContext(setError: (message: string | null) => void) {
  const [fileChatContextItems, setFileChatContextItems] = useState<FileChatContextItem[]>([]);
  const fileChatContextRef = useRef<FileChatContextItem[]>([]);
  fileChatContextRef.current = fileChatContextItems;

  const addFileToChatContext = useCallback(
    (payload: Pick<FileChatContextItem, "root" | "relPath" | "kind">) => {
      const prev = fileChatContextRef.current;
      const id = makeFileContextItemId(payload);
      if (prev.some((x) => x.id === id)) {
        return;
      }
      if (prev.length >= MAX_FILE_CHAT_CONTEXT) {
        setError(`最多同时引用 ${MAX_FILE_CHAT_CONTEXT} 个路径，请先在对话区移除部分。`);
        return;
      }
      setError(null);
      setFileChatContextItems([...prev, { id, ...payload }]);
    },
    [setError],
  );

  const removeFileChatContextItem = useCallback((id: string) => {
    setFileChatContextItems((previous) => previous.filter((x) => x.id !== id));
  }, []);

  const clearFileChatContext = useCallback(() => {
    setFileChatContextItems([]);
  }, []);

  return {
    fileChatContextItems,
    addFileToChatContext,
    removeFileChatContextItem,
    clearFileChatContext,
  };
}
