/**
 * 删除案件前的盘点与分级建议（删除向导的真相源）。
 *
 * 删除不再只是「删 cases/ 与 matters/ 两个目录」：任务、会话、草稿、副本云同步包
 * 都挂着 matterId。本模块把这些存量扫出来，按场景（空壳 / 在办 / 已结案）给出
 * 默认保留方案，由律师（或对话里的助手转述）确认后交给 deleteMatterVolume 执行。
 *
 * 永远保留：审计链（audit/）与模型用量账本（model-usage/）——工作区证据链不随案件删除。
 * 已交付或已批准（有 outputPath）的草稿受保护，任何选项都不删。
 */

import fs from "node:fs";
import path from "node:path";
import {
  loadMatter,
  readApprovals,
  readDeadlines,
  readQueueItems,
} from "../adapters/matter-storage/index.js";
import { isDraftProtected } from "../agent/session-delete-cascade.js";
import { listSessions } from "../agent/session.js";
import { isValidMatterId } from "../cases/matter-id.js";
import { listDrafts } from "../drafts/index.js";
import { defaultMatterCloudDataDir, safeMatterId } from "../matter-replica/matter-cloud-store.js";
import { listTaskRecords } from "../tasks/index.js";
import { countUserCaseFiles, replicaDirBelongsToMatter } from "./delete-matter-volume.js";

export type MatterDeleteScenario = "empty_shell" | "active" | "closed" | "missing";

export type MatterDeletePlanOptions = {
  /** 连同 cases/<id> 里的材料/卷宗文件一起删（不勾且有存量时删除会被拒绝）。 */
  deleteMaterials: boolean;
  /** 删除本案的历史任务记录（tasks/*.json）。审计链仍留有事件。 */
  deleteTasks: boolean;
  /** 删除绑定本案的对话会话（含转写）。 */
  deleteSessions: boolean;
  /** 删除未批准且未导出的草稿；已批准/已交付的始终保留。 */
  deleteUnapprovedDrafts: boolean;
};

export type MatterDeletePlan = {
  matterId: string;
  displayName: string;
  status: string | null;
  scenario: MatterDeleteScenario;
  volume: { caseDir: boolean; matterDir: boolean; userFileCount: number };
  tasks: number;
  sessions: { count: number; sampleTitles: string[] };
  drafts: { total: number; protectedCount: number; unprotectedCount: number };
  openDeadlines: number;
  openQueueItems: number;
  pendingApprovals: number;
  replicaCloud: boolean;
  suggested: MatterDeletePlanOptions;
  warnings: string[];
  alwaysKept: string[];
};

/** replica-cloud 里本案的目录（子目录名与 MatterCloudStore 同一套清洗规则）。 */
export function replicaCloudMatterDir(workspaceDir: string, matterId: string): string {
  return path.join(defaultMatterCloudDataDir(workspaceDir), safeMatterId(matterId));
}

function suggestFor(scenario: MatterDeleteScenario): MatterDeletePlanOptions {
  if (scenario === "empty_shell") {
    // 空壳卷：没有任何用户内容，四项都安全。
    return {
      deleteMaterials: true,
      deleteTasks: true,
      deleteSessions: true,
      deleteUnapprovedDrafts: true,
    };
  }
  if (scenario === "closed") {
    // 已结案：任务与未交付草稿默认随案清理；材料与对话默认保留，由律师明示。
    return {
      deleteMaterials: false,
      deleteTasks: true,
      deleteSessions: false,
      deleteUnapprovedDrafts: true,
    };
  }
  // 在办（或已不存在）：一律保守，全由律师逐项明示。
  return {
    deleteMaterials: false,
    deleteTasks: false,
    deleteSessions: false,
    deleteUnapprovedDrafts: false,
  };
}

function emptyInvalidPlan(id: string): MatterDeletePlan {
  return {
    matterId: id,
    displayName: id,
    status: null,
    scenario: "missing",
    volume: { caseDir: false, matterDir: false, userFileCount: 0 },
    tasks: 0,
    sessions: { count: 0, sampleTitles: [] },
    drafts: { total: 0, protectedCount: 0, unprotectedCount: 0 },
    openDeadlines: 0,
    openQueueItems: 0,
    pendingApprovals: 0,
    replicaCloud: false,
    suggested: suggestFor("missing"),
    warnings: ["案件 ID 不合法，未扫描工作区。"],
    alwaysKept: ["审计痕迹（audit/）", "模型用量账本（model-usage/）"],
  };
}

export async function buildMatterDeletePlan(
  workspaceDir: string,
  matterId: string,
): Promise<MatterDeletePlan> {
  const id = matterId.trim();
  if (!isValidMatterId(id)) {
    return emptyInvalidPlan(id);
  }
  const caseDir = path.join(workspaceDir, "cases", id);
  const matterDirPath = path.join(workspaceDir, "matters", id);
  const caseDirExists = fs.existsSync(caseDir);
  const matterDirExists = fs.existsSync(matterDirPath);
  const userFileCount = caseDirExists ? await countUserCaseFiles(caseDir, id) : 0;

  const record = loadMatter(workspaceDir, id);
  const status = record?.status ?? null;

  const tasks = listTaskRecords(workspaceDir).filter((task) => task.matterId === id);
  const boundSessions = listSessions(workspaceDir).filter((session) => session.matterId === id);
  const matterDrafts = listDrafts(workspaceDir).filter((draft) => draft.matterId === id);
  const protectedCount = matterDrafts.filter((draft) =>
    isDraftProtected(draft.taskId, workspaceDir),
  ).length;

  // 队列/审批只读真相源（matters/<id>/*.jsonl）。派生视图会把空壳模板的小节
  // 也算成待办，删除盘点要的是「这卷真实登记的未结事项」。
  const openDeadlines = readDeadlines(workspaceDir, id).filter(
    (row) => row.status === "open" || row.status === "snoozed",
  ).length;
  const openQueueItems = readQueueItems(workspaceDir, id).filter(
    (item) => item.status === "open" || item.status === "in_progress",
  ).length;
  const pendingApprovals = readApprovals(workspaceDir, id).filter(
    (item) => item.status === "pending",
  ).length;

  const volume = { caseDir: caseDirExists, matterDir: matterDirExists, userFileCount };
  const hasLiveBindings =
    userFileCount > 0 ||
    tasks.length > 0 ||
    matterDrafts.length > 0 ||
    boundSessions.length > 0 ||
    openDeadlines > 0 ||
    openQueueItems > 0 ||
    pendingApprovals > 0;
  const scenario: MatterDeleteScenario =
    !caseDirExists && !matterDirExists
      ? "missing"
      : !hasLiveBindings
        ? "empty_shell"
        : status === "closed" || status === "delivered"
          ? "closed"
          : "active";

  const suggested = suggestFor(scenario);

  const warnings: string[] = [];
  if (scenario === "active") {
    warnings.push("案件仍在办理中。建议先结案或移交，再删除。");
  }
  if (openDeadlines > 0) {
    warnings.push(`还有 ${openDeadlines} 条未完成期限，删除后不再提醒。`);
  }
  if (openQueueItems > 0) {
    warnings.push(`还有 ${openQueueItems} 条待办未结。`);
  }
  if (pendingApprovals > 0) {
    warnings.push(`还有 ${pendingApprovals} 条审批未决。`);
  }
  if (boundSessions.length > 0 && !suggested.deleteSessions) {
    warnings.push(`${boundSessions.length} 段对话默认保留，仅解除案件关联。`);
  }
  if (protectedCount > 0) {
    warnings.push(`${protectedCount} 份已交付/已批准的文书会保留在草稿库。`);
  }

  const alwaysKept = ["审计痕迹（audit/）", "模型用量账本（model-usage/）"];
  if (protectedCount > 0) {
    alwaysKept.push("已交付或已批准的文书草稿");
  }

  const replicaDir = replicaCloudMatterDir(workspaceDir, id);
  const replicaCloud =
    fs.existsSync(replicaDir) && (await replicaDirBelongsToMatter(replicaDir, id));

  return {
    matterId: id,
    displayName: record?.title?.trim() || id,
    status,
    scenario,
    volume,
    tasks: tasks.length,
    sessions: {
      count: boundSessions.length,
      sampleTitles: boundSessions
        .map((session) => session.title?.trim() ?? "")
        .filter((title) => title.length > 0)
        .slice(0, 3),
    },
    drafts: {
      total: matterDrafts.length,
      protectedCount,
      unprotectedCount: matterDrafts.length - protectedCount,
    },
    openDeadlines,
    openQueueItems,
    pendingApprovals,
    replicaCloud,
    suggested,
    warnings,
    alwaysKept,
  };
}
