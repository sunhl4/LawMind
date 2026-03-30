/**
 * Matter index aggregation.
 *
 * 把 Markdown 案件档案、任务状态、草稿快照、审计事件聚合为
 * 一个可直接供 UI / CLI 消费的案件摘要对象。
 */

import fs from "node:fs/promises";
import { readAllAuditLogs } from "../audit/index.js";
import { listDrafts } from "../drafts/index.js";
import { caseFilePath } from "../memory/index.js";
import { listTaskRecords } from "../tasks/index.js";
import type { MatterIndex, MatterOverview, MatterSearchHit, MatterSummary } from "../types.js";

function uniq(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function extractSectionEntries(content: string, heading: string): string[] {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`${escaped}\\n\\n([\\s\\S]*?)(?:\\n##\\s+\\d+\\.|$)`);
  const match = pattern.exec(content);
  if (!match) {
    return [];
  }

  return uniq(
    match[1]
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("-"))
      .map((line) => line.replace(/^-\s*(\[[^\]]+\]\s*)?/, "").trim()),
  );
}

export async function buildMatterIndex(
  workspaceDir: string,
  matterId: string,
): Promise<MatterIndex> {
  const filePath = caseFilePath(workspaceDir, matterId);
  const caseMemory = await fs.readFile(filePath, "utf8").catch(() => "");
  const tasks = listTaskRecords(workspaceDir).filter((task) => task.matterId === matterId);
  const drafts = listDrafts(workspaceDir).filter((draft) => draft.matterId === matterId);
  const taskIds = new Set(tasks.map((task) => task.taskId));
  const auditEvents = (await readAllAuditLogs(`${workspaceDir}/audit`)).filter((event) =>
    taskIds.has(event.taskId),
  );

  const coreIssues = extractSectionEntries(caseMemory, "## 4. 核心争点");
  const taskGoals = extractSectionEntries(caseMemory, "## 6. 当前任务目标");
  const riskNotes = extractSectionEntries(caseMemory, "## 7. 风险与待确认事项");
  const progressEntries = extractSectionEntries(caseMemory, "## 8. 工作进展记录");
  const artifacts = extractSectionEntries(caseMemory, "## 9. 生成产物");

  const openTasks = tasks.filter(
    (task) => task.status !== "rendered" && task.status !== "rejected",
  );
  const renderedTasks = tasks.filter((task) => task.status === "rendered");
  const latestUpdatedAt = [
    ...tasks.map((task) => task.updatedAt),
    ...auditEvents.map((e) => e.timestamp),
  ]
    .toSorted()
    .at(-1);

  return {
    matterId,
    caseFilePath: filePath,
    caseMemory,
    coreIssues,
    taskGoals,
    riskNotes,
    progressEntries,
    artifacts,
    tasks,
    drafts,
    auditEvents,
    openTasks,
    renderedTasks,
    latestUpdatedAt,
  };
}

export async function listMatterIds(workspaceDir: string): Promise<string[]> {
  const caseRoot = `${workspaceDir}/cases`;
  const fromCases = await fs
    .readdir(caseRoot, { withFileTypes: true })
    .then((entries) => entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name))
    .catch(() => [] as string[]);
  const fromTasks = listTaskRecords(workspaceDir)
    .map((task) => task.matterId)
    .filter((value): value is string => Boolean(value));

  return uniq([...fromCases, ...fromTasks]).toSorted();
}

function byLatestUpdatedDesc(a?: string, b?: string): number {
  return (b ?? "").localeCompare(a ?? "");
}

export function buildMatterOverview(index: MatterIndex): MatterOverview {
  return {
    matterId: index.matterId,
    latestUpdatedAt: index.latestUpdatedAt,
    openTaskCount: index.openTasks.length,
    renderedTaskCount: index.renderedTasks.length,
    riskCount: index.riskNotes.length,
    artifactCount: index.artifacts.length,
    topIssue: index.coreIssues[0],
    topRisk: index.riskNotes[0],
  };
}

export async function listMatterOverviews(workspaceDir: string): Promise<MatterOverview[]> {
  const matterIds = await listMatterIds(workspaceDir);
  const indexes = await Promise.all(
    matterIds.map((matterId) => buildMatterIndex(workspaceDir, matterId)),
  );
  return indexes
    .map(buildMatterOverview)
    .toSorted((a, b) => byLatestUpdatedDesc(a.latestUpdatedAt, b.latestUpdatedAt));
}

export function summarizeMatterIndex(index: MatterIndex): MatterSummary {
  const headline =
    index.coreIssues[0] ??
    index.taskGoals[0] ??
    `${index.matterId} 当前暂无核心争点，请先完成检索与草拟。`;
  const statusLine = `open=${index.openTasks.length}, rendered=${index.renderedTasks.length}, risks=${index.riskNotes.length}, artifacts=${index.artifacts.length}`;
  const keyRisks = index.riskNotes.slice(0, 5);
  const nextActions =
    index.openTasks.length > 0
      ? index.openTasks.slice(0, 5).map((task) => `${task.status}: ${task.summary}`)
      : index.taskGoals.slice(0, 5);
  const recentActivity = index.progressEntries.slice(-5).toReversed();

  return {
    headline,
    statusLine,
    keyRisks,
    nextActions,
    recentActivity,
  };
}

function includesQuery(text: string, query: string): boolean {
  return text.toLowerCase().includes(query.toLowerCase());
}

export function searchMatterIndex(index: MatterIndex, query: string): MatterSearchHit[] {
  const hits: MatterSearchHit[] = [];
  const pushHits = (section: MatterSearchHit["section"], texts: string[]) => {
    for (const text of texts) {
      if (includesQuery(text, query)) {
        hits.push({ section, text });
      }
    }
  };

  pushHits("coreIssues", index.coreIssues);
  pushHits("taskGoals", index.taskGoals);
  pushHits("riskNotes", index.riskNotes);
  pushHits("progressEntries", index.progressEntries);
  pushHits("artifacts", index.artifacts);

  for (const task of index.tasks) {
    if (includesQuery(task.summary, query) || includesQuery(task.kind, query)) {
      hits.push({
        section: "tasks",
        text: `${task.status}: ${task.summary}`,
        taskId: task.taskId,
      });
    }
  }

  for (const draft of index.drafts) {
    const draftText = `${draft.title}\n${draft.summary}\n${draft.sections.map((section) => `${section.heading} ${section.body}`).join("\n")}`;
    if (includesQuery(draftText, query)) {
      hits.push({
        section: "drafts",
        text: `${draft.title}: ${draft.summary}`,
        taskId: draft.taskId,
      });
    }
  }

  for (const event of index.auditEvents) {
    const auditText = `${event.kind} ${event.detail ?? ""}`;
    if (includesQuery(auditText, query)) {
      hits.push({
        section: "auditEvents",
        text: `${event.kind}: ${event.detail ?? "(no detail)"}`,
        taskId: event.taskId,
      });
    }
  }

  return hits;
}

export { isValidMatterId, parseOptionalMatterId, MATTER_ID_PATTERN } from "./matter-id.js";
export { createMatterIfAbsent } from "./matter-create.js";
export type { CreateMatterResult } from "./matter-create.js";
