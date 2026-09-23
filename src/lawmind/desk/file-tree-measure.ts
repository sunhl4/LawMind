/**
 * 目录树度量：文件数与字节数（软链跳过）。
 *
 * 为什么单独成文件、且放在 `desk/` 而不是某个工具里：**记录侧**（`apply_file_ops` 执行时
 * 把复制件的体积写进 desk-write 日志）与**撤销侧**（`revert_desk_write` 反向回放时判断
 * 「律师改过没有」）必须是**同一把尺子**。此前记录用整棵树的字节和、撤销用目录 inode 的
 * 字节数，结果任何「复制文件夹」都会被判成「已被修改，未删除」——撤销永远失败。
 *
 * 放在 `desk/`：`desk-apply` 与 `agent/tools/legal/*` 都依赖 `desk/`（反向依赖才是问题）。
 */

import fs from "node:fs";
import path from "node:path";

export type FileTreeMeasure = {
  files: number;
  bytes: number;
  /** 任一上限被越过（调用方据此拒绝复制，而不是先算完整棵树）。 */
  overflow: boolean;
};

/** 上限缺省表示不设限（撤销侧只要字节和，不需要早停）。 */
export type FileTreeLimits = {
  maxFiles?: number;
  maxBytes?: number;
};

/** 目录树的文件数与字节数（软链跳过；读不到的条目跳过而不是抛错）。 */
export function measureFileTree(abs: string, limits?: FileTreeLimits): FileTreeMeasure {
  const maxFiles = limits?.maxFiles;
  const maxBytes = limits?.maxBytes;
  let st: fs.Stats;
  try {
    st = fs.lstatSync(abs);
  } catch {
    return { files: 0, bytes: 0, overflow: false };
  }
  if (st.isFile()) {
    return { files: 1, bytes: st.size, overflow: false };
  }
  if (!st.isDirectory()) {
    return { files: 0, bytes: 0, overflow: false };
  }
  let files = 0;
  let bytes = 0;
  let overflow = false;
  const visit = (dir: string): void => {
    if (overflow) {
      return;
    }
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      if (overflow) {
        return;
      }
      if (ent.isSymbolicLink()) {
        continue;
      }
      const child = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        visit(child);
        continue;
      }
      if (!ent.isFile()) {
        continue;
      }
      files += 1;
      try {
        bytes += fs.statSync(child).size;
      } catch {
        /* skip unreadable */
      }
      if (
        (typeof maxFiles === "number" && files > maxFiles) ||
        (typeof maxBytes === "number" && bytes > maxBytes)
      ) {
        overflow = true;
      }
    }
  };
  visit(abs);
  return { files, bytes, overflow };
}
