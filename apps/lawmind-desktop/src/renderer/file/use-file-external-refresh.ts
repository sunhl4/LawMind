/**
 * 中栏编辑器跟着磁盘刷新。
 *
 * 对话里的工具（改稿、导出、另存）和另一个窗口都会直接写盘，编辑器自己不会知道。
 * Word 预览有自己的轮询；这里补文本标签：先只读 mtime（`fsStat`），变了才整份读回，
 * 没有未保存修改就换掉。有未保存修改时一律不动——律师的手上内容优先，冲突留给保存时的
 * `expectedMtimeMs`。
 */

import { useEffect, useRef } from "react";
import type { AnyFileRoot } from "./file-workbench-types";

/** 本机 IPC 读 mtime，1.5s 足够近实时；只有 mtime 变了才整份读正文。 */
export const FILE_EXTERNAL_REFRESH_MS = 1_500;

/** PDF / Excel 这类只读或自管 dirty 的预览：只查 mtime，变了才让查看器重载。 */
export const FILE_MTIME_REFRESH_MS = 1_500;

/** 是否应该用磁盘内容替换当前标签。纯函数，便于单测。 */
export function shouldAdoptDiskFile(input: {
  /** 标签有未保存修改：律师正在编辑，不要覆盖。 */
  dirty: boolean;
  tabMtimeMs: number;
  diskMtimeMs?: number;
  tabContent: string;
  diskContent?: string;
}): boolean {
  if (input.dirty) {
    return false;
  }
  if (typeof input.diskMtimeMs !== "number" || !Number.isFinite(input.diskMtimeMs)) {
    return false;
  }
  if (typeof input.diskContent !== "string") {
    return false;
  }
  if (input.diskMtimeMs === input.tabMtimeMs) {
    return false;
  }
  return input.diskContent !== input.tabContent;
}

export type UseFileExternalRefreshInput = {
  enabled: boolean;
  root: AnyFileRoot;
  path: string;
  mtimeMs: number;
  content: string;
  dirty: boolean;
  onReload: (next: { content: string; mtimeMs: number }) => void;
};

export function useFileExternalRefresh(input: UseFileExternalRefreshInput): void {
  const { enabled, root, path, dirty } = input;
  const latestRef = useRef(input);
  latestRef.current = input;
  const inFlightRef = useRef(false);

  useEffect(() => {
    if (!enabled || dirty || !path) {
      return undefined;
    }
    let cancelled = false;

    const tick = async () => {
      if (cancelled || inFlightRef.current) {
        return;
      }
      if (typeof document !== "undefined" && document.visibilityState === "hidden") {
        return;
      }
      const current = latestRef.current;
      if (current.dirty) {
        return;
      }
      const stat = window.lawmindDesktop?.fsStat;
      const read = window.lawmindDesktop?.fsRead;
      if (typeof stat !== "function" || typeof read !== "function") {
        return;
      }
      inFlightRef.current = true;
      try {
        const meta = await stat({ root: current.root, path: current.path });
        if (cancelled || !meta?.ok || meta.kind !== "file") {
          return;
        }
        const target = latestRef.current;
        if (target.dirty) {
          return;
        }
        if (meta.mtimeMs === target.mtimeMs) {
          return;
        }
        const res = await read({ root: target.root, path: target.path });
        if (cancelled || !res?.ok || res.kind !== "text") {
          return;
        }
        const next = latestRef.current;
        if (
          shouldAdoptDiskFile({
            dirty: next.dirty,
            tabMtimeMs: next.mtimeMs,
            diskMtimeMs: res.mtimeMs ?? meta.mtimeMs,
            tabContent: next.content,
            diskContent: res.content,
          })
        ) {
          next.onReload({
            content: res.content as string,
            mtimeMs: (res.mtimeMs ?? meta.mtimeMs) as number,
          });
        }
      } catch {
        /* 瞬时读失败（iCloud 未落盘等）留给下一轮 */
      } finally {
        inFlightRef.current = false;
      }
    };

    const timer = window.setInterval(() => {
      void tick();
    }, FILE_EXTERNAL_REFRESH_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [dirty, enabled, path, root]);
}

export type UseFileMtimeWatcherInput = {
  enabled: boolean;
  root: AnyFileRoot;
  path: string;
  /** 当前查看器已知的 mtime；变了会重置「已知值」，避免重复触发。 */
  mtimeMs: number;
  /** 有未保存编辑时暂停轮询，避免把律师手上的内容冲掉。 */
  dirty?: boolean;
  intervalMs?: number;
  onChanged: (mtimeMs: number) => void;
};

/**
 * 只监视磁盘 mtime 的轻量轮询，供 PDF / Excel 这类自带加载逻辑的查看器使用。
 *
 * 不用整份读正文：mtime 变了才回调，查看器自己决定怎么重载。`dirty` 时不轮询，
 * 与文本标签的「未保存优先」同一口径。
 */
export function useFileMtimeWatcher(input: UseFileMtimeWatcherInput): void {
  const {
    enabled,
    root,
    path,
    mtimeMs,
    dirty = false,
    intervalMs = FILE_MTIME_REFRESH_MS,
  } = input;
  const latestRef = useRef(input);
  latestRef.current = input;
  const knownRef = useRef(mtimeMs);
  const lastInputRef = useRef(mtimeMs);
  if (mtimeMs !== lastInputRef.current) {
    lastInputRef.current = mtimeMs;
    knownRef.current = mtimeMs;
  }
  const inFlightRef = useRef(false);

  useEffect(() => {
    if (!enabled || dirty || !path) {
      return undefined;
    }
    let cancelled = false;

    const tick = async () => {
      if (cancelled || inFlightRef.current) {
        return;
      }
      if (typeof document !== "undefined" && document.visibilityState === "hidden") {
        return;
      }
      const current = latestRef.current;
      if (current.dirty) {
        return;
      }
      const stat = window.lawmindDesktop?.fsStat;
      if (typeof stat !== "function") {
        return;
      }
      inFlightRef.current = true;
      try {
        const meta = await stat({ root: current.root, path: current.path });
        if (cancelled || !meta?.ok || meta.kind !== "file") {
          return;
        }
        const mtimeMs = meta.mtimeMs;
        if (typeof mtimeMs !== "number" || !Number.isFinite(mtimeMs)) {
          return;
        }
        if (mtimeMs === knownRef.current) {
          return;
        }
        knownRef.current = mtimeMs;
        current.onChanged(mtimeMs);
      } catch {
        /* 瞬时失败留给下一轮 */
      } finally {
        inFlightRef.current = false;
      }
    };

    const timer = window.setInterval(() => {
      void tick();
    }, intervalMs);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [dirty, enabled, intervalMs, path, root]);
}
