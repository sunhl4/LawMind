/**
 * Preview diff for pending memory adoption suggestions (GitAgent/GAP style).
 */

import fs from "node:fs";
import path from "node:path";
import { diffLines, type LineDiffResult } from "../text/line-diff.js";
import { listMemorySuggestions, type MemoryAdoptionRecord } from "./adoption-service.js";
import {
  resolveMemoryTargetRelativePath,
  type MemoryTargetPathOptions,
} from "./memory-target-path.js";

const SECTION_EIGHT = "## 八、个人积累";
const TAIL_MARKER = "\n---\n\n_最后更新";

export type AdoptionPreviewDiffOk = {
  ok: true;
  suggestionId: string;
  scope: MemoryAdoptionRecord["scope"];
  kind: MemoryAdoptionRecord["kind"];
  targetPath: string;
  beforeCharCount: number;
  afterCharCount: number;
  hunks: LineDiffResult["hunks"];
};

export type AdoptionPreviewDiffErr = {
  ok: false;
  error: string;
  hint?: string;
};

export type AdoptionPreviewDiffResult = AdoptionPreviewDiffOk | AdoptionPreviewDiffErr;

function readUtf8Sync(filePath: string): string {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return "";
  }
}

function simulateLawyerProfileAppend(content: string, payload: string): string {
  const core = payload.trim();
  if (!core) {
    return content;
  }
  const line = `- [preview] [source:preview] ${core}`;
  if (!content.includes(SECTION_EIGHT)) {
    return `${content.trimEnd()}\n\n${SECTION_EIGHT}\n\n${line}\n`;
  }
  const eightIdx = content.indexOf(SECTION_EIGHT);
  const tailIdx = content.lastIndexOf(TAIL_MARKER);
  if (tailIdx > eightIdx) {
    const before = content.slice(0, tailIdx).trimEnd();
    const after = content.slice(tailIdx);
    return `${before}\n${line}\n${after}`;
  }
  return `${content.trimEnd()}\n${line}\n`;
}

function simulateAppendPayload(content: string, payload: string): string {
  const p = payload.trim();
  if (!p) {
    return content;
  }
  const base = content.trimEnd();
  if (!base) {
    return `${p}\n`;
  }
  return `${base}\n\n${p}\n`;
}

export function simulateAfterContent(before: string, record: MemoryAdoptionRecord): string {
  if (record.kind === "lawyer.profile_learning") {
    return simulateLawyerProfileAppend(before, record.payload);
  }
  return simulateAppendPayload(before, record.payload);
}

export async function buildAdoptionPreviewDiff(
  workspaceDir: string,
  suggestionId: string,
  opts?: MemoryTargetPathOptions,
): Promise<AdoptionPreviewDiffResult> {
  const all = await listMemorySuggestions(workspaceDir);
  const rec = all.find((r) => r.id === suggestionId);
  if (!rec) {
    return { ok: false, error: "not_found", hint: "未找到该记忆建议。" };
  }
  const targetPath = resolveMemoryTargetRelativePath(rec, opts);
  if (!targetPath) {
    return {
      ok: false,
      error: "target_path_unresolved",
      hint: "无法解析目标文件路径（请提供 matterId 或 targetId）。",
    };
  }
  const full = path.join(path.resolve(workspaceDir), targetPath);
  const before = readUtf8Sync(full);
  const after = simulateAfterContent(before, rec);
  const { hunks } = diffLines(before, after);
  return {
    ok: true,
    suggestionId,
    scope: rec.scope,
    kind: rec.kind,
    targetPath,
    beforeCharCount: before.length,
    afterCharCount: after.length,
    hunks,
  };
}
