/**
 * 删除律师点名的用户卷宗：cases/<id> 与 matters/<id> 一起去掉。
 * 不碰程序、策略、审计、会话。通用文件接口仍然拒绝 matters/。
 */

import fs from "node:fs/promises";
import path from "node:path";
import { drainMatterProjections } from "../application/services/matter-write-service.js";
import { isValidMatterId } from "../cases/matter-id.js";
import { defaultCaseTemplate, defaultMatterStrategyTemplate } from "../memory/templates.js";
import { rememberDeletedMatter } from "./deleted-matters.js";

const BOOTSTRAP_CASE_FILES = new Set(["CASE.md", "MATTER_STRATEGY.md"]);

export type DeleteMatterVolumeResult =
  | {
      ok: true;
      matterId: string;
      removedCaseDir: boolean;
      removedMatterDir: boolean;
      userFileCount: number;
    }
  | { ok: false; error: string; userFileCount?: number };

function nominalChild(parent: string, id: string): string | null {
  const root = path.resolve(parent);
  const target = path.resolve(root, id);
  const rel = path.relative(root, target);
  if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) {
    return null;
  }
  return target;
}

type DirLookup = { kind: "dir"; path: string } | { kind: "missing" } | { kind: "escaped" };

/** 目录若是指向卷外的符号链接，拒绝，避免删到工作区外面。 */
async function existingDir(parent: string, id: string): Promise<DirLookup> {
  const nominal = nominalChild(parent, id);
  if (!nominal) {
    return { kind: "escaped" };
  }
  let realParent: string;
  try {
    realParent = await fs.realpath(path.resolve(parent));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return { kind: "missing" };
    }
    throw err;
  }
  try {
    const real = await fs.realpath(nominal);
    const rel = path.relative(realParent, real);
    // 必须就是这一卷的目录。指向卷外，或指向同级另一卷的符号链接，都不删。
    if (rel.includes("/") || rel.includes("\\") || rel.normalize("NFC") !== id.normalize("NFC")) {
      return { kind: "escaped" };
    }
    return { kind: "dir", path: real };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return { kind: "missing" };
    }
    throw err;
  }
}

function narrativeTail(raw: string): string {
  const idx = raw.search(/\n## 2\./);
  const body = idx >= 0 ? raw.slice(idx) : raw;
  return body.replace(/\r\n/g, "\n").trim();
}

/**
 * 第一节会被档案投影改写（门类、阶段）。第二节往后仍是模板，就算空壳。
 * 律师在事实、争点、策略里写过字，才算有内容。
 */
function isUntouchedBootstrap(name: string, matterId: string, raw: string): boolean {
  if (name === "CASE.md") {
    return narrativeTail(raw) === narrativeTail(defaultCaseTemplate(matterId));
  }
  if (name === "MATTER_STRATEGY.md") {
    return narrativeTail(raw) === narrativeTail(defaultMatterStrategyTemplate(matterId));
  }
  return false;
}

/** 卷宗里除未改过的建档模板以外的文件。材料、来信、交付、写过的档案都算。 */
export async function countUserCaseFiles(caseDir: string, matterId: string): Promise<number> {
  let count = 0;
  async function walk(dir: string, top: boolean): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      if (ent.isSymbolicLink()) {
        count += 1;
        continue;
      }
      const child = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        await walk(child, false);
        continue;
      }
      if (top && BOOTSTRAP_CASE_FILES.has(ent.name)) {
        const raw = await fs.readFile(child, "utf8").catch(() => "");
        if (isUntouchedBootstrap(ent.name, matterId, raw)) {
          continue;
        }
      }
      count += 1;
    }
  }
  await walk(caseDir, true);
  return count;
}

async function removeDir(dir: string): Promise<void> {
  await fs.rm(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 20 });
}

export async function deleteMatterVolume(
  workspaceDir: string,
  matterId: string,
  opts?: { requireEmpty?: boolean },
): Promise<DeleteMatterVolumeResult> {
  const id = matterId.trim();
  if (!isValidMatterId(id)) {
    return { ok: false, error: "案件 ID 不合法。" };
  }
  // 建档投影可能还在写 CASE.md。先等它落盘，再删，避免删完又被写回。
  await drainMatterProjections();
  const caseHit = await existingDir(path.join(workspaceDir, "cases"), id);
  const matterHit = await existingDir(path.join(workspaceDir, "matters"), id);
  if (caseHit.kind === "escaped" || matterHit.kind === "escaped") {
    return { ok: false, error: "案件路径超出工作区，未删除。" };
  }
  const userFileCount = caseHit.kind === "dir" ? await countUserCaseFiles(caseHit.path, id) : 0;
  if (opts?.requireEmpty && userFileCount > 0) {
    return {
      ok: false,
      error: `该卷还有 ${userFileCount} 个材料或卷宗文件。确认要连材料一起删时，再传 delete_materials=true。`,
      userFileCount,
    };
  }
  if (caseHit.kind === "dir") {
    await removeDir(caseHit.path);
  }
  if (matterHit.kind === "dir") {
    await removeDir(matterHit.path);
  }
  rememberDeletedMatter(workspaceDir, id);
  return {
    ok: true,
    matterId: id,
    removedCaseDir: caseHit.kind === "dir",
    removedMatterDir: matterHit.kind === "dir",
    userFileCount,
  };
}
