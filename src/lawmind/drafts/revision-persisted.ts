/**
 * 审核台后台修订：确认助手是否已将 drafts/<taskId>.json 落盘。
 */

import { createHash } from "node:crypto";
import fs from "node:fs";
import type { AgentTurn } from "../agent/types.js";
import { draftPath, readDraft } from "./index.js";

export type DraftRevisionBaseline = {
  mtimeMs: number;
  contentHash: string;
};

function hashContent(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

export function snapshotDraftRevisionBaseline(
  workspaceDir: string,
  taskId: string,
): DraftRevisionBaseline | undefined {
  const target = draftPath(workspaceDir, taskId);
  try {
    const stat = fs.statSync(target);
    const content = fs.readFileSync(target, "utf8");
    return { mtimeMs: stat.mtimeMs, contentHash: hashContent(content) };
  } catch {
    return undefined;
  }
}

function normalizeDraftRelativePath(filePath: string): string {
  return filePath.replace(/\\/g, "/").replace(/^\.\//, "");
}

export function turnHasSuccessfulDraftWrite(turn: AgentTurn | undefined, taskId: string): boolean {
  if (!turn) {
    return false;
  }
  const expectedPath = `drafts/${taskId}.json`;
  for (const msg of turn.messages) {
    if (msg.role !== "tool" || !msg.toolCallResponses?.length) {
      continue;
    }
    for (const tr of msg.toolCallResponses) {
      if (!tr.result?.ok) {
        continue;
      }
      if (tr.name === "update_draft") {
        const data = tr.result.data;
        const tid =
          data &&
          typeof data === "object" &&
          typeof (data as { taskId?: unknown }).taskId === "string"
            ? (data as { taskId: string }).taskId
            : "";
        if (tid === taskId) {
          return true;
        }
      }
      if (tr.name !== "write_document") {
        continue;
      }
      const data = tr.result.data;
      const fp =
        data &&
        typeof data === "object" &&
        typeof (data as { filePath?: unknown }).filePath === "string"
          ? normalizeDraftRelativePath((data as { filePath: string }).filePath)
          : "";
      if (fp === expectedPath || fp.endsWith(`/${expectedPath}`)) {
        return true;
      }
    }
  }
  return false;
}

export function draftRevisionWasPersisted(
  workspaceDir: string,
  taskId: string,
  baseline: DraftRevisionBaseline | undefined,
  turn?: AgentTurn,
): boolean {
  const draft = readDraft(workspaceDir, taskId);
  if (!draft || draft.taskId !== taskId) {
    return false;
  }

  let fileChanged = false;
  try {
    const target = draftPath(workspaceDir, taskId);
    const stat = fs.statSync(target);
    const content = fs.readFileSync(target, "utf8");
    const nextHash = hashContent(content);
    if (!baseline) {
      fileChanged = true;
    } else {
      fileChanged = stat.mtimeMs > baseline.mtimeMs || nextHash !== baseline.contentHash;
    }
  } catch {
    return false;
  }

  if (turnHasSuccessfulDraftWrite(turn, taskId)) {
    return true;
  }
  return fileChanged;
}

export function buildRevisionRetryInstruction(taskId: string): string {
  return `【系统复查 · 必须落盘】

上一轮对话尚未把修订写入 \`drafts/${taskId}.json\`，审核台无法展示新正文。

请**立即**执行：
1. 读取当前 \`drafts/${taskId}.json\`（可用 analyze_document / search_workspace）；
2. 按此前审核备注与补充说明修改正文；
3. **优先**调用 \`update_draft\`（传入 task_id \`${taskId}\` 与更新后的 sections / summary / title）；若必须写整文件 JSON，再调用 \`write_document\`，\`file_path\` 必须为 \`drafts/${taskId}.json\`。

禁止只做文字说明；落盘成功后用一句话确认已写回。`.slice(0, 12_000);
}
