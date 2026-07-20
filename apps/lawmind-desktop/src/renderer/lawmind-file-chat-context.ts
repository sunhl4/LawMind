import { useCallback, useEffect, useRef, useState } from "react";

const MAX_FILE_CHAT_CONTEXT = 8;

export type FileChatContextItem = {
  id: string;
  root: "workspace" | "project";
  relPath: string;
  kind: "file" | "directory";
};

export type FileChatContextScope = {
  assistantId: string;
  sessionId?: string | null;
};

/** Stable map key: pins must not leak across assistants or chat sessions. */
export function fileChatScopeKey(scope: FileChatContextScope): string {
  const assistantId = scope.assistantId.trim() || "default";
  const sessionId = scope.sessionId?.trim() || "__pending__";
  return `${assistantId}::${sessionId}`;
}

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

/**
 * When a real session id appears, move any pins stored under `__pending__` for that
 * assistant into the session bucket (once), so early “引用到对话” is not lost.
 */
export function migratePendingFileChatPins(
  byScope: Record<string, FileChatContextItem[]>,
  scope: FileChatContextScope,
): Record<string, FileChatContextItem[]> {
  const sessionId = scope.sessionId?.trim();
  if (!sessionId) {
    return byScope;
  }
  const pendingKey = fileChatScopeKey({ assistantId: scope.assistantId, sessionId: null });
  const realKey = fileChatScopeKey({ assistantId: scope.assistantId, sessionId });
  const pending = byScope[pendingKey];
  if (!pending?.length) {
    return byScope;
  }
  const existing = byScope[realKey];
  const next = { ...byScope };
  delete next[pendingKey];
  if (!existing?.length) {
    next[realKey] = pending;
  }
  return next;
}

export function useFileChatContext(
  setError: (message: string | null) => void,
  scope: FileChatContextScope,
) {
  const [byScope, setByScope] = useState<Record<string, FileChatContextItem[]>>({});
  const scopeKey = fileChatScopeKey(scope);
  const fileChatContextItems = byScope[scopeKey] ?? [];
  const itemsRef = useRef<FileChatContextItem[]>(fileChatContextItems);
  itemsRef.current = fileChatContextItems;
  const scopeKeyRef = useRef(scopeKey);
  scopeKeyRef.current = scopeKey;

  useEffect(() => {
    setByScope((prev) => migratePendingFileChatPins(prev, scope));
  }, [scope.assistantId, scope.sessionId]);

  const addFileToChatContext = useCallback(
    (payload: Pick<FileChatContextItem, "root" | "relPath" | "kind">) => {
      const key = scopeKeyRef.current;
      const prev = itemsRef.current;
      const id = makeFileContextItemId(payload);
      if (prev.some((x) => x.id === id)) {
        return;
      }
      if (prev.length >= MAX_FILE_CHAT_CONTEXT) {
        setError(`最多同时引用 ${MAX_FILE_CHAT_CONTEXT} 个路径，请先在对话区移除部分。`);
        return;
      }
      setError(null);
      const nextItems = [...prev, { id, ...payload }];
      itemsRef.current = nextItems;
      setByScope((map) => ({ ...map, [key]: nextItems }));
    },
    [setError],
  );

  const removeFileChatContextItem = useCallback((id: string) => {
    const key = scopeKeyRef.current;
    setByScope((map) => {
      const prev = map[key] ?? [];
      const nextItems = prev.filter((x) => x.id !== id);
      itemsRef.current = nextItems;
      return { ...map, [key]: nextItems };
    });
  }, []);

  const clearFileChatContext = useCallback(() => {
    const key = scopeKeyRef.current;
    itemsRef.current = [];
    setByScope((map) => ({ ...map, [key]: [] }));
  }, []);

  return {
    fileChatContextItems,
    addFileToChatContext,
    removeFileChatContextItem,
    clearFileChatContext,
  };
}
