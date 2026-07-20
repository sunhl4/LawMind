import { useEffect, useMemo, useRef, useState } from "react";
import { type RootKey, type FsEntry, type IndexedFile } from "./file-workbench-types";

// Core workspace paths that require lawyer confirmation before delete/rename.
const PROTECTED_WORKSPACE: Record<string, string> = {
  "assistants.json": "助手配置文件 — 删除后所有助手定义将永久丢失",
  sessions: "会话记录目录 — 删除后所有对话历史将永久丢失",
  cases: "案件数据目录 — 删除后所有案件资料将永久丢失",
  memory: "记忆数据库目录 — 删除后助手长期记忆将清空",
  delegations: "协作委派记录目录 — 删除后协作历史将丢失",
};

export function isProtectedWorkspacePath(root: RootKey, relPath: string): string | null {
  if (root !== "workspace") {
    return null;
  }
  const norm = relPath.replace(/^\/+/, "").replace(/\/+$/, "");
  if (!norm) {
    return null;
  }
  const parts = norm.split("/").filter(Boolean);
  const top = parts[0];
  if (!top) {
    return null;
  }
  // 仅保护根级的 `cases` 容器目录；`cases/<卷宗>/…` 内材料按普通路径
  if (top === "cases") {
    return norm === "cases" ? PROTECTED_WORKSPACE.cases : null;
  }
  if (top === "assistants.json") {
    return norm === "assistants.json" ? PROTECTED_WORKSPACE["assistants.json"] : null;
  }
  return PROTECTED_WORKSPACE[top] ?? null;
}

/** Word / Office / PDF：本工作台为纯文本编辑器，不内嵌富文本预览 */
export function isOfficeLikePath(relPath: string): boolean {
  const low = relPath.toLowerCase();
  return [".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".pdf"].some((s) => low.endsWith(s));
}

const IMAGE_EXT_MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

/** 邮件附件等常见图片：侧栏可内嵌预览 */
export function isImageLikePath(relPath: string): boolean {
  const low = relPath.toLowerCase();
  return Object.keys(IMAGE_EXT_MIME).some((ext) => low.endsWith(ext));
}

export function mimeTypeForImagePath(relPath: string): string | null {
  const low = relPath.toLowerCase();
  for (const [ext, mime] of Object.entries(IMAGE_EXT_MIME)) {
    if (low.endsWith(ext)) {
      return mime;
    }
  }
  return null;
}

export function keyOf(root: RootKey, dirPath: string): string {
  return `${root}:${dirPath}`;
}

export function basename(relPath: string): string {
  const parts = relPath.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? relPath;
}

export function getDirname(relPath: string): string {
  const parts = relPath.split("/").filter(Boolean);
  return parts.slice(0, -1).join("/");
}

export function joinRelPath(a: string, b: string): string {
  const l = a.replace(/^\/+|\/+$/g, "");
  const r = b.replace(/^\/+|\/+$/g, "");
  if (!l) {return r;}
  if (!r) {return l;}
  return `${l}/${r}`;
}

export function splitStemExt(name: string, kind: "file" | "directory"): { stem: string; ext: string } {
  if (kind === "directory") {
    return { stem: name, ext: "" };
  }
  const i = name.lastIndexOf(".");
  if (i <= 0 || i === name.length - 1) {
    return { stem: name, ext: "" };
  }
  return { stem: name.slice(0, i), ext: name.slice(i) };
}

/**
 * `cases/...` → 第一层路径段 + 相对工作区根的目标相对路径（不含 `cases/<seg>/` 前缀）。
 * 例如 `cases/mid/a/b` → `{ firstSeg: "mid", workspaceDestRel: "a/b" }`；
 * `cases/mid` → `{ firstSeg: "mid", workspaceDestRel: "" }`。
 */
export function parseCasesRelForWorkspaceMove(relPath: string): { firstSeg: string; workspaceDestRel: string } | null {
  const norm = relPath.replace(/^\/+/, "");
  if (!norm.startsWith("cases/")) {
    return null;
  }
  const rest = norm.slice("cases/".length);
  const parts = rest.split("/").filter(Boolean);
  if (parts.length === 0) {
    return null;
  }
  const firstSeg = parts[0];
  const inner = parts.slice(1);
  return { firstSeg, workspaceDestRel: inner.join("/") };
}

/** 在 `parentDir` 下为 `leaf` 分配不冲突的相对路径（含父级 mkdir）。 */
export async function allocateNonCollidingChildPath(
  root: RootKey,
  parentDir: string,
  leaf: string,
  kind: "file" | "directory",
): Promise<string> {
  if (parentDir) {
    const mk = await window.lawmindDesktop?.fsMkdir({ root, path: parentDir });
    if (mk && !mk.ok) {
      throw new Error(mk.error ?? "无法创建目标目录");
    }
  }
  const res = await window.lawmindDesktop?.fsList({ root, path: parentDir });
  if (res && !res.ok) {
    throw new Error(res.error ?? "无法列出目录");
  }
  const existing = new Set((res?.entries ?? []).map((e: FsEntry) => e.name));
  const { stem, ext } = splitStemExt(leaf, kind);
  let candidate = leaf;
  let n = 0;
  while (existing.has(candidate)) {
    n++;
    candidate = ext ? `${stem} (${n})${ext}` : `${stem} (${n})`;
  }
  return joinRelPath(parentDir, candidate);
}

export async function allocateNonCollidingRelPath(root: RootKey, desiredRelPath: string, kind: "file" | "directory"): Promise<string> {
  const parts = desiredRelPath.split("/").filter(Boolean);
  const parent = parts.length <= 1 ? "" : parts.slice(0, -1).join("/");
  const leaf = parts.length === 0 ? desiredRelPath : (parts[parts.length - 1] ?? desiredRelPath);
  return allocateNonCollidingChildPath(root, parent, leaf, kind);
}

export function resolveRelForAbs(
  workspaceDir: string,
  projectDir: string | null,
  absPath: string,
): { root: RootKey; rel: string } | null {
  const a = absPath.replace(/\\/g, "/");
  const w = workspaceDir.replace(/\\/g, "/").replace(/\/$/, "");
  const p = projectDir?.replace(/\\/g, "/").replace(/\/$/, "") ?? "";
  if (w && (a === w || a.startsWith(`${w}/`))) {
    return { root: "workspace", rel: a === w ? "" : a.slice(w.length + 1) };
  }
  if (p && (a === p || a.startsWith(`${p}/`))) {
    return { root: "project", rel: a === p ? "" : a.slice(p.length + 1) };
  }
  return null;
}

export function getFileIcon(name: string, kind: "file" | "directory", isOpen = false): string {
  if (kind === "directory") {return isOpen ? "📂" : "📁";}
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    md: "📝", txt: "📄", json: "📋", ts: "📘", tsx: "📘",
    js: "📙", jsx: "📙", css: "🎨", html: "🌐", pdf: "📕",
    docx: "📝", doc: "📝", xlsx: "📊", png: "🖼", jpg: "🖼",
    svg: "🖼", sh: "⚙️", yaml: "⚙️", yml: "⚙️",
  };
  return map[ext] ?? "📄";
}

// Fuzzy-ish scorer: exact match > name match > path match
export function scoreMatch(file: IndexedFile, query: string): number {
  const q = query.toLowerCase();
  const name = file.name.toLowerCase();
  const p = file.path.toLowerCase();
  if (name === q) {return 100;}
  if (name.startsWith(q)) {return 80;}
  if (name.includes(q)) {return 60;}
  if (p.includes(q)) {return 30;}
  return 0;
}

// ── Quick Open Modal (Cursor-style) ──────────────────────────────────────────
// Completely standalone floating modal. No focus-management tricks needed:
// the input and list items are in the SAME React subtree; clicking a list item
// is a plain onClick that fires before any blur-induced unmount.
export function QuickOpenModal({
  files,
  onOpen,
  onClose,
}: {
  files: IndexedFile[];
  onOpen: (root: RootKey, path: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const results = useMemo(() => {
    if (!query.trim()) {
      return files.slice(0, 14);
    }
    return files
      .map((f) => ({ f, score: scoreMatch(f, query) }))
      .filter(({ score }) => score > 0)
      .toSorted((a, b) => b.score - a.score)
      .map(({ f }) => f)
      .slice(0, 14);
  }, [files, query]);

  // Keep cursor in bounds when results change
  useEffect(() => {
    setCursor((c) => Math.min(c, Math.max(results.length - 1, 0)));
  }, [results]);

  // Scroll active item into view
  useEffect(() => {
    const el = listRef.current?.children[cursor] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  const confirm = (idx: number) => {
    const file = results[idx];
    if (file) {
      onOpen(file.root, file.path);
      onClose();
    }
  };

  return (
    <div
      className="lm-wizard-backdrop lm-wizard-backdrop--quickopen"
      onMouseDown={(e) => {
        // Close only when clicking the backdrop itself (not the modal)
        if (e.target === e.currentTarget) {onClose();}
      }}
    >
      <div className="lm-quickopen-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="lm-quickopen-inputrow">
          <span className="lm-quickopen-magnifier">🔍</span>
          <input
            ref={inputRef}
            type="text"
            className="lm-quickopen-input"
            placeholder="输入文件名快速打开…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") { e.preventDefault(); onClose(); }
              if (e.key === "ArrowDown") { e.preventDefault(); setCursor((c) => Math.min(c + 1, results.length - 1)); }
              if (e.key === "ArrowUp") { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)); }
              if (e.key === "Enter") { e.preventDefault(); confirm(cursor); }
            }}
          />
          <kbd className="lm-quickopen-esc" onClick={onClose}>Esc</kbd>
        </div>

        {results.length > 0 ? (
          <div ref={listRef} className="lm-quickopen-list">
            {results.map((f, i) => (
              <div
                key={`${f.root}:${f.path}`}
                className={`lm-quickopen-item ${i === cursor ? "active" : ""}`}
                onMouseEnter={() => setCursor(i)}
                // Plain onClick works here: input and list are in the same modal,
                // so no blur/unmount race condition exists.
                onClick={() => confirm(i)}
              >
                <span className="lm-quickopen-item-icon">{getFileIcon(f.name, "file")}</span>
                <div className="lm-quickopen-item-text">
                  <span className="lm-quickopen-item-name">{f.name}</span>
                  <span className="lm-quickopen-item-path">{f.path}</span>
                </div>
                <span className="lm-quickopen-item-root">{f.root}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="lm-quickopen-empty">
            {files.length === 0 ? "索引中，请稍候…" : "未找到匹配文件"}
          </div>
        )}

        <div className="lm-quickopen-footer">
          <span>↑↓ 导航</span>
          <span>↵ 打开</span>
          <span>Esc 关闭</span>
        </div>
      </div>
    </div>
  );
}
