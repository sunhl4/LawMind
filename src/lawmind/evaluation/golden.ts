/**
 * Phase B：将审核标记为黄金样本的草稿晋升为可复用黄金案例（JSON 快照）。
 */

import fs from "node:fs";
import fsPromises from "node:fs/promises";
import path from "node:path";
import { readDraft, readReasoningSnapshot, readResearchSnapshot } from "../drafts/index.js";
import type { ArtifactDraft, ResearchBundle } from "../types.js";

export type GoldenExampleEntry = {
  taskId: string;
  promotedAt: string;
  draft: ArtifactDraft;
  researchBundle?: ResearchBundle;
  /** 若当时已生成推理图谱快照则一并保存 */
  hasReasoningSnapshot: boolean;
};

function goldenDir(workspaceDir: string): string {
  return path.join(workspaceDir, "golden");
}

function goldenFilePath(workspaceDir: string, taskId: string): string {
  return path.join(goldenDir(workspaceDir), `${taskId}.golden.json`);
}

function goldenJournalPath(workspaceDir: string): string {
  return path.join(goldenDir(workspaceDir), "golden.jsonl");
}

export type GoldenPromoteResult = {
  entry: GoldenExampleEntry;
  /** false when golden file already existed (idempotent re-entry) */
  created: boolean;
};

/**
 * 将任务草稿与检索快照写入 golden/，并追加 golden.jsonl 一行便于流式处理。
 */
export async function promoteGoldenExample(
  workspaceDir: string,
  taskId: string,
): Promise<GoldenPromoteResult | undefined> {
  const goldenPath = goldenFilePath(workspaceDir, taskId);
  if (fs.existsSync(goldenPath)) {
    try {
      const raw = await fsPromises.readFile(goldenPath, "utf8");
      const entry = JSON.parse(raw) as GoldenExampleEntry;
      return { entry, created: false };
    } catch {
      /* fall through to regenerate */
    }
  }
  const draft = readDraft(workspaceDir, taskId);
  if (!draft) {
    return undefined;
  }
  const bundle = readResearchSnapshot(workspaceDir, taskId);
  const graph = readReasoningSnapshot(workspaceDir, taskId);
  const promotedAt = new Date().toISOString();
  const entry: GoldenExampleEntry = {
    taskId,
    promotedAt,
    draft,
    researchBundle: bundle,
    hasReasoningSnapshot: Boolean(graph),
  };
  await fsPromises.mkdir(goldenDir(workspaceDir), { recursive: true });
  await fsPromises.writeFile(
    goldenFilePath(workspaceDir, taskId),
    JSON.stringify(entry, null, 2),
    "utf8",
  );
  const line = `${JSON.stringify({ taskId, promotedAt, templateId: draft.templateId, matterId: draft.matterId })}\n`;
  await fsPromises.appendFile(goldenJournalPath(workspaceDir), line, "utf8");
  return { entry, created: true };
}

export async function listGoldenTaskIds(workspaceDir: string): Promise<string[]> {
  try {
    const dir = goldenDir(workspaceDir);
    const files = await fsPromises.readdir(dir);
    return files
      .filter((f) => f.endsWith(".golden.json"))
      .map((f) => f.replace(/\.golden\.json$/, ""))
      .toSorted();
  } catch {
    return [];
  }
}
