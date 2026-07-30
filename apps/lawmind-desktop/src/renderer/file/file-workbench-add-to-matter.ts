/**
 * Move a workspace file/folder into cases/<matterId>/ (FileWorkbench「加入案件」).
 */

import { isValidMatterId } from "../../../../../src/lawmind/cases/matter-id.ts";
import {
  allocateNonCollidingRelPath,
  basename,
  getDirname,
  joinRelPath,
} from "./file-workbench-fs";

export type MoveIntoMatterResult =
  | { ok: true; toPath: string; caseDir: string; fromPath: string }
  | { ok: false; error: string };

export async function moveWorkspaceItemIntoMatterFs(input: {
  matterId: string;
  relPath: string;
  kind: "file" | "directory";
}): Promise<MoveIntoMatterResult> {
  const mid = input.matterId.trim();
  if (!isValidMatterId(mid)) {
    return { ok: false, error: "案件编号格式无效，请检查输入。" };
  }
  const caseDir = joinRelPath("cases", mid);
  const mk = await window.lawmindDesktop?.fsMkdir({ root: "workspace", path: caseDir });
  if (mk && !mk.ok) {
    return { ok: false, error: mk.error ?? "无法创建案件目录" };
  }
  const leaf = basename(input.relPath);
  const desired = joinRelPath(caseDir, leaf);
  const toPath = await allocateNonCollidingRelPath("workspace", desired, input.kind);
  const res = await window.lawmindDesktop?.fsRename({
    root: "workspace",
    fromPath: input.relPath,
    toPath,
  });
  if (!res?.ok) {
    return { ok: false, error: res?.error ?? "移动失败" };
  }
  return { ok: true, toPath, caseDir, fromPath: input.relPath };
}

export function remapTabsAfterWorkspaceMove<T extends { id: string; path: string; name: string }>(
  tabs: T[],
  fromPath: string,
  toPath: string,
): T[] {
  return tabs.map((t) => {
    if (t.path === fromPath) {
      return { ...t, id: `workspace:${toPath}`, path: toPath, name: basename(toPath) };
    }
    if (t.path.startsWith(`${fromPath}/`)) {
      const suffix = t.path.slice(fromPath.length + 1);
      const np = joinRelPath(toPath, suffix);
      return { ...t, id: `workspace:${np}`, path: np, name: basename(np) };
    }
    return t;
  });
}

export function parentDirsToRefresh(fromPath: string, caseDir: string): string[] {
  return [getDirname(fromPath), caseDir];
}
