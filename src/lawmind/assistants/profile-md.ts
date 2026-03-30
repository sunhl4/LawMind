/**
 * Per-assistant long-form preference memory (Markdown).
 *
 * Path: `<lawMindRoot>/assistants/<assistantId>/PROFILE.md`
 *
 * Complements workspace-level `LAWYER_PROFILE.md`: injected into the agent system
 * prompt when the assistant ID is known (desktop / multi-assistant).
 */

import fs from "node:fs";
import path from "node:path";

const INVALID_ID = /[./\\]/;

export function assistantProfileDir(lawMindRoot: string, assistantId: string): string {
  const id = assistantId.trim();
  if (!id || INVALID_ID.test(id)) {
    throw new Error("invalid assistant id");
  }
  return path.join(lawMindRoot, "assistants", id);
}

export function assistantProfilePath(lawMindRoot: string, assistantId: string): string {
  return path.join(assistantProfileDir(lawMindRoot, assistantId), "PROFILE.md");
}

/** Read per-assistant profile; returns empty string if missing. Throws if `assistantId` is unsafe. */
export function readAssistantProfileMarkdown(lawMindRoot: string, assistantId: string): string {
  const p = assistantProfilePath(lawMindRoot, assistantId);
  try {
    return fs.readFileSync(p, "utf8");
  } catch {
    return "";
  }
}

/** Append a dated entry (explicit lawyer-controlled evolution path). */
/** 审核台写入 PROFILE 的单行摘要（可测）。 */
export function buildReviewProfileLine(taskId: string, status: string, note?: string): string {
  const n = note?.trim();
  return n
    ? `草稿审核（任务 ${taskId}，${status}）：${n}`
    : `草稿审核（任务 ${taskId}，${status}）。`;
}

/** 分段元数据：便于 UI 展示「最近写入来源」（审核台 / 其他）。 */
export type AssistantProfileSectionMeta = {
  /** `##` 后的 ISO 时间戳行 */
  stamp: string;
  body: string;
  /** 启发式：正文含审核摘要句式则标为 review */
  sourceHint: "review" | "unknown";
};

/**
 * 解析 `PROFILE.md` 中由 `---` 分隔的区块（与 append 格式一致）。
 * 首块（文件头说明）不纳入列表；解析失败时返回空数组。
 */
export function listAssistantProfileSections(
  lawMindRoot: string,
  assistantId: string,
): AssistantProfileSectionMeta[] {
  const raw = readAssistantProfileMarkdown(lawMindRoot, assistantId).trim();
  if (!raw) {
    return [];
  }
  const chunks = raw
    .split(/\n---\n/g)
    .map((c) => c.trim())
    .filter(Boolean);
  if (chunks.length === 0) {
    return [];
  }
  const out: AssistantProfileSectionMeta[] = [];
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    if (i === 0 && chunk.startsWith("#")) {
      continue;
    }
    const m = /^##\s+([^\n]+)\n+([\s\S]*)$/m.exec(chunk);
    if (!m) {
      continue;
    }
    const stamp = m[1].trim();
    const body = m[2].trim();
    const sourceHint: "review" | "unknown" = body.includes("草稿审核") ? "review" : "unknown";
    out.push({ stamp, body, sourceHint });
  }
  return out;
}

export function appendAssistantProfileMarkdown(
  lawMindRoot: string,
  assistantId: string,
  entry: string,
): void {
  const dir = assistantProfileDir(lawMindRoot, assistantId);
  fs.mkdirSync(dir, { recursive: true });
  const p = assistantProfilePath(lawMindRoot, assistantId);
  const line = entry.trim();
  if (!line) {
    return;
  }
  const stamp = new Date().toISOString();
  const block = `\n\n---\n\n## ${stamp}\n\n${line}\n`;
  if (fs.existsSync(p)) {
    fs.appendFileSync(p, block, "utf8");
  } else {
    fs.writeFileSync(
      p,
      `# 助手偏好档案\n\n> 本文件由 LawMind 按助手维护，可与工作区 \`LAWYER_PROFILE.md\` 并存；显式追加更安全。\n${block}`,
      "utf8",
    );
  }
}
