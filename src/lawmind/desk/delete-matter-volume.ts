/**
 * 删除律师点名的用户卷宗：cases/<id> 与 matters/<id> 一起去掉，
 * 并随案清理 lawmind/replica-cloud/<id> 同步包。
 * 可选级联：本案任务记录、绑定本案的会话、未受保护的草稿。
 * 不碰程序、策略、审计、模型用量账本；已批准/已交付的草稿始终保留。
 * 通用文件接口仍然拒绝 matters/。
 */

import fs from "node:fs/promises";
import path from "node:path";
import { deleteSessionWithCascade, isDraftProtected } from "../agent/session-delete-cascade.js";
import { listSessions, saveSession } from "../agent/session.js";
import { drainMatterProjections } from "../application/services/matter-write-service.js";
import { emit } from "../audit/index.js";
import { isValidMatterId } from "../cases/matter-id.js";
import { deleteDraft, listDrafts } from "../drafts/index.js";
import { defaultMatterCloudDataDir, safeMatterId } from "../matter-replica/matter-cloud-store.js";
import { defaultCaseTemplate, defaultMatterStrategyTemplate } from "../memory/templates.js";
import { deleteTaskRecord, listTaskRecords } from "../tasks/index.js";
import { rememberDeletedMatter } from "./deleted-matters.js";

const BOOTSTRAP_CASE_FILES = new Set(["CASE.md", "MATTER_STRATEGY.md"]);

export type DeleteMatterVolumeOptions = {
  /** 卷里还有用户文件时要求显式放行（delete_materials / 对话框勾选）。 */
  requireEmpty?: boolean;
  /** 连同本案历史任务记录（tasks/*.json）一起删。 */
  deleteTasks?: boolean;
  /** 删除绑定本案的会话（含转写；excludeSessionId 除外）。 */
  deleteSessions?: boolean;
  /** 删除本案未批准且未导出的草稿。 */
  deleteUnapprovedDrafts?: boolean;
  /** 正在对话的会话 ID——级联删会话时跳过它。 */
  excludeSessionId?: string;
  /** 审计留痕用的操作者 ID。 */
  actorId?: string;
};

export type DeleteMatterVolumeResult =
  | {
      ok: true;
      matterId: string;
      removedCaseDir: boolean;
      removedMatterDir: boolean;
      removedReplicaCloud: boolean;
      userFileCount: number;
      deletedTasks: number;
      deletedSessions: number;
      unlinkedSessions: number;
      deletedDrafts: number;
      keptDrafts: number;
      auditEmitted: boolean;
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

/** replica-cloud 目录里的 ops-bundle 登记的是哪个案件。读不出就当作不属于，不删。 */
export async function replicaDirBelongsToMatter(dir: string, matterId: string): Promise<boolean> {
  try {
    const raw = await fs.readFile(path.join(dir, "ops-bundle.json"), "utf8");
    const parsed = JSON.parse(raw) as { matterId?: unknown };
    return parsed.matterId === matterId;
  } catch {
    return false;
  }
}

export async function deleteMatterVolume(
  workspaceDir: string,
  matterId: string,
  opts?: DeleteMatterVolumeOptions,
): Promise<DeleteMatterVolumeResult> {
  const id = matterId.trim();
  if (!isValidMatterId(id)) {
    return { ok: false, error: "案件 ID 不合法。" };
  }
  // 建档投影可能还在写 CASE.md。先等它落盘，再删，避免删完又被写回。
  await drainMatterProjections();
  const caseHit = await existingDir(path.join(workspaceDir, "cases"), id);
  const matterHit = await existingDir(path.join(workspaceDir, "matters"), id);
  let replicaHit = await existingDir(defaultMatterCloudDataDir(workspaceDir), safeMatterId(id));
  // 中文编号经 safeMatterId 清洗后可能撞名（「甲案」「乙案」都是 __）：
  // 只有 ops-bundle 里登记的 matterId 确属本案才随案删，否则保留。
  if (replicaHit.kind === "dir" && !(await replicaDirBelongsToMatter(replicaHit.path, id))) {
    replicaHit = { kind: "missing" };
  }
  if (caseHit.kind === "escaped" || matterHit.kind === "escaped" || replicaHit.kind === "escaped") {
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

  // 级联先走（按文件尽力而为，不抛）；卷宗目录最后删。
  const matterDrafts = listDrafts(workspaceDir).filter((row) => row.matterId === id);
  const protectedTaskIds = new Set(
    matterDrafts
      .filter((draft) => isDraftProtected(draft.taskId, workspaceDir))
      .map((draft) => draft.taskId),
  );

  let deletedDrafts = 0;
  let deletedTasks = 0;
  let keptDrafts = protectedTaskIds.size;
  if (opts?.deleteUnapprovedDrafts) {
    for (const draft of matterDrafts) {
      if (protectedTaskIds.has(draft.taskId)) {
        continue;
      }
      if (deleteDraft(workspaceDir, draft.taskId)) {
        deletedDrafts += 1;
        // 未交付草稿随案删时，其任务记录一并清掉，避免孤儿 tasks。
        if (deleteTaskRecord(workspaceDir, draft.taskId)) {
          deletedTasks += 1;
        }
      }
    }
  } else {
    keptDrafts = matterDrafts.length;
  }

  if (opts?.deleteTasks) {
    for (const task of listTaskRecords(workspaceDir).filter((row) => row.matterId === id)) {
      // 已交付/已批准草稿的任务账必须留着，否则审核台挂空。
      if (protectedTaskIds.has(task.taskId)) {
        continue;
      }
      if (deleteTaskRecord(workspaceDir, task.taskId)) {
        deletedTasks += 1;
      }
    }
  }

  let deletedSessions = 0;
  if (opts?.deleteSessions) {
    const exclude = opts.excludeSessionId?.trim() ?? "";
    for (const session of listSessions(workspaceDir).filter((row) => row.matterId === id)) {
      if (exclude && session.sessionId === exclude) {
        continue;
      }
      const cascaded = deleteSessionWithCascade(workspaceDir, session.sessionId, {
        cascadeDelegations: true,
      });
      if (cascaded.deletedSession) {
        deletedSessions += 1;
      }
    }
  }

  // 未删的绑定会话一律解开 matterId（含 excludeSessionId），与对话框文案一致。
  let unlinkedSessions = 0;
  for (const session of listSessions(workspaceDir).filter((row) => row.matterId === id)) {
    const next = { ...session };
    delete next.matterId;
    saveSession(workspaceDir, next);
    unlinkedSessions += 1;
  }

  if (caseHit.kind === "dir") {
    await removeDir(caseHit.path);
  }
  if (matterHit.kind === "dir") {
    await removeDir(matterHit.path);
  }
  if (replicaHit.kind === "dir") {
    await removeDir(replicaHit.path);
  }
  rememberDeletedMatter(workspaceDir, id);

  // 证据链：删卷必须留痕。审计写入失败不撤销删除，但要在结果里明说。
  let auditEmitted = false;
  try {
    await emit(path.join(workspaceDir, "audit"), {
      taskId: `matter:${id}`,
      kind: "matter.deleted",
      actor: "lawyer",
      actorId: opts?.actorId,
      matterId: id,
      detail: JSON.stringify({
        matterId: id,
        removedCaseDir: caseHit.kind === "dir",
        removedMatterDir: matterHit.kind === "dir",
        removedReplicaCloud: replicaHit.kind === "dir",
        userFileCount,
        deletedTasks,
        deletedSessions,
        unlinkedSessions,
        deletedDrafts,
        keptDrafts,
      }),
    });
    auditEmitted = true;
  } catch {
    auditEmitted = false;
  }

  return {
    ok: true,
    matterId: id,
    removedCaseDir: caseHit.kind === "dir",
    removedMatterDir: matterHit.kind === "dir",
    removedReplicaCloud: replicaHit.kind === "dir",
    userFileCount,
    deletedTasks,
    deletedSessions,
    unlinkedSessions,
    deletedDrafts,
    keptDrafts,
    auditEmitted,
  };
}
