/**
 * 将 ArtifactDraft 字段映射为上传 Word 模板中 {{占位符}} 的替换值。
 * placeholderMap：占位符名 → 字段路径（如 title、sections.0.body）。
 */

import type { ArtifactDraft } from "../types.js";

export const DRAFT_FIELD_HELP: string = [
  "常用字段路径：",
  "title, summary, matterId, taskId, audience, output, deliverableType,",
  "reviewNotes（多行）, sections（全部章节拼成多段）,",
  "sections.0.heading, sections.0.body, sections.1.heading, …",
].join(" ");

/**
 * 按简单路径从草稿取值；未知路径返回空字符串（便于模板逐步补充）。
 */
export function resolveDraftTemplateField(draft: ArtifactDraft, fieldPath: string): string {
  const p = fieldPath.trim();
  if (!p) {
    return "";
  }
  const lower = p.toLowerCase();
  if (lower === "title") {
    return draft.title;
  }
  if (lower === "summary") {
    return draft.summary;
  }
  if (lower === "matterid" || lower === "matter_id") {
    return draft.matterId ?? "";
  }
  if (lower === "taskid" || lower === "task_id") {
    return draft.taskId;
  }
  if (lower === "audience") {
    return draft.audience ?? "";
  }
  if (lower === "output") {
    return draft.output;
  }
  if (lower === "templateid" || lower === "template_id") {
    return draft.templateId;
  }
  if (lower === "deliverabletype" || lower === "deliverable_type") {
    return draft.deliverableType ?? "";
  }
  if (lower === "reviewnotes" || lower === "review_notes") {
    return draft.reviewNotes.join("\n");
  }
  if (lower === "sections" || lower === "all_sections") {
    return draft.sections.map((s) => `${s.heading}\n${s.body}`).join("\n\n");
  }
  const m = /^sections\.(\d+)\.(heading|body)$/.exec(p);
  if (m) {
    const i = Number(m[1]);
    const sec = draft.sections[i];
    if (!sec) {
      return "";
    }
    return m[2] === "heading" ? sec.heading : sec.body;
  }
  return "";
}

/**
 * 根据注册表中的 placeholderMap 生成 {{name}} -> 替换文本。
 */
export function buildPlaceholderValueMap(
  draft: ArtifactDraft,
  placeholderMap: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [phKey, fieldPath] of Object.entries(placeholderMap)) {
    const k = phKey.trim();
    if (!k) {
      continue;
    }
    out[k] = resolveDraftTemplateField(draft, fieldPath);
  }
  return out;
}

const SECTIONS_UNDERSCORE_RE = /^sections_(\d+)_(heading|body)$/i;

/**
 * 根据 .docx 中扫描出的 {{占位符名}} 猜测字段路径。用于登记上传模板时自动填充 placeholderMap（底层逻辑）。
 * 未识别的名字不会出现在结果中，可在 `lawmind/templates/index.json` 中手改补全。
 */
export function suggestPlaceholderFieldPaths(placeholderNames: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of placeholderNames) {
    const name = raw.trim();
    if (!name) {
      continue;
    }
    const l = name.toLowerCase();
    if (l === "title") {
      out[name] = "title";
      continue;
    }
    if (l === "summary") {
      out[name] = "summary";
      continue;
    }
    if (l === "audience") {
      out[name] = "audience";
      continue;
    }
    if (l === "output") {
      out[name] = "output";
      continue;
    }
    if (l === "matterid" || l === "matter_id") {
      out[name] = "matterId";
      continue;
    }
    if (l === "taskid" || l === "task_id") {
      out[name] = "taskId";
      continue;
    }
    if (l === "templateid" || l === "template_id") {
      out[name] = "templateId";
      continue;
    }
    if (l === "deliverabletype" || l === "deliverable_type") {
      out[name] = "deliverableType";
      continue;
    }
    if (l === "reviewnotes" || l === "review_notes") {
      out[name] = "reviewNotes";
      continue;
    }
    if (l === "sections" || l === "all_sections") {
      out[name] = "sections";
      continue;
    }
    const sm = SECTIONS_UNDERSCORE_RE.exec(name);
    if (sm) {
      out[name] = `sections.${sm[1]}.${sm[2].toLowerCase() === "heading" ? "heading" : "body"}`;
    }
  }
  return out;
}
