import fs from "node:fs";
import path from "node:path";
import { caseFilePath } from "../case-workspace.js";
import { appendCaseSectionBullet } from "../case-writes.js";
import { appendLawyerProfileLearning } from "../lawyer-profile-learning.js";
import type { MemoryRecord } from "./contract.js";
import { listMemoryRecords } from "./store.js";

const CASE_HEADINGS: Record<string, string> = {
  "matter.core_issue": "## 4. 核心争点",
  "matter.risk": "## 7. 风险与待确认事项",
  "matter.goal": "## 6. 当前任务目标",
  "matter.progress": "## 8. 工作进展记录",
  "matter.artifact": "## 9. 生成产物",
};

function stripBulletsContaining(text: string, body: string): string {
  return text
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();
      if (!trimmed.startsWith("-")) {
        return true;
      }
      return !trimmed.includes(body);
    })
    .join("\n");
}

function rewriteIfPresent(filePath: string, body: string): void {
  if (!fs.existsSync(filePath)) {
    return;
  }
  const raw = fs.readFileSync(filePath, "utf8");
  if (!raw.includes(body)) {
    return;
  }
  const next = stripBulletsContaining(raw, body);
  if (next !== raw) {
    fs.writeFileSync(filePath, next);
  }
}

function projectionFiles(workspaceDir: string, record: MemoryRecord): string[] {
  if (record.scope === "matter" && record.scopeId) {
    return [caseFilePath(workspaceDir, record.scopeId)];
  }
  if (record.scope === "client" && record.scopeId) {
    return [path.join(workspaceDir, "clients", record.scopeId, "CLIENT_PROFILE.md")];
  }
  if (record.scope === "firm") {
    return [
      path.join(workspaceDir, "FIRM_PROFILE.md"),
      path.join(workspaceDir, "playbooks", "CLAUSE_PLAYBOOK.md"),
    ];
  }
  return [
    path.join(workspaceDir, "LAWYER_PROFILE.md"),
    path.join(workspaceDir, "memory", "lawyer-profile-archive.md"),
  ];
}

/** 已作废的句子留在记忆库。热档案里删掉对应条目，避免打开文件还像在生效。 */
export function retractMemoryProjection(workspaceDir: string, record: MemoryRecord): void {
  const body = record.body.trim();
  if (body.length < 6) {
    return;
  }
  const stillCurrent = listMemoryRecords(workspaceDir).some(
    (row) =>
      row.id !== record.id &&
      row.scope === record.scope &&
      row.scopeId === record.scopeId &&
      row.validity === "current" &&
      row.confirmation === "confirmed" &&
      row.body.trim() === body,
  );
  if (stillCurrent) {
    return;
  }
  for (const filePath of projectionFiles(workspaceDir, record)) {
    rewriteIfPresent(filePath, body);
  }
}

function fileHasBody(filePath: string, body: string): boolean {
  if (!fs.existsSync(filePath)) {
    return false;
  }
  return fs.readFileSync(filePath, "utf8").includes(body);
}

function appendBullet(filePath: string, body: string): void {
  if (!fs.existsSync(filePath) || fileHasBody(filePath, body)) {
    return;
  }
  const raw = fs.readFileSync(filePath, "utf8");
  fs.writeFileSync(filePath, `${raw.trimEnd()}\n- ${body}\n`);
}

/** 恢复后把句子放回热档案。文件里已经有这句就不再写。 */
export async function restoreMemoryProjection(
  workspaceDir: string,
  record: MemoryRecord,
): Promise<void> {
  const body = record.body.trim();
  if (body.length < 6 || record.validity !== "current") {
    return;
  }
  if (record.scope === "lawyer") {
    const profile = path.join(workspaceDir, "LAWYER_PROFILE.md");
    if (!fileHasBody(profile, body)) {
      await appendLawyerProfileLearning(workspaceDir, body, "manual");
    }
    return;
  }
  if (record.scope === "matter" && record.scopeId) {
    const filePath = caseFilePath(workspaceDir, record.scopeId);
    if (fileHasBody(filePath, body)) {
      return;
    }
    await appendCaseSectionBullet(
      workspaceDir,
      record.scopeId,
      CASE_HEADINGS[record.key] ?? "## 7. 风险与待确认事项",
      body,
      { mode: "merge", timestamped: false },
    );
    return;
  }
  for (const filePath of projectionFiles(workspaceDir, record)) {
    appendBullet(filePath, body);
  }
}
