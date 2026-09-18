/**
 * Lawyer-facing tool cards — Chinese titles/details, never snake_case tool ids.
 * Presentation only: does not change tool execute results.
 */

import { toolDisplayNameZh } from "../platform/requires-action.js";

export type LawyerToolCard = {
  title: string;
  detail?: string;
};

function asTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function firstString(args: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = asTrimmedString(args[key]);
    if (value) {
      return value;
    }
  }
  return "";
}

function basenamePath(raw: string): string {
  const normalized = raw.replace(/\\/g, "/").trim();
  if (!normalized) {
    return "";
  }
  const parts = normalized.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? normalized;
}

const HIDDEN_PROCESS_TOOLS = new Set(["run_compute", "run_analysis"]);

function clip(text: string, max = 72): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) {
    return t;
  }
  return `${t.slice(0, max)}…`;
}

function countEdits(args: Record<string, unknown>): number | undefined {
  const edits = args.edits;
  if (Array.isArray(edits)) {
    return edits.length;
  }
  return asFiniteNumber(args.edit_count) ?? asFiniteNumber(args.count);
}

function describeCallArgs(name: string, args: Record<string, unknown>): string | undefined {
  switch (name) {
    case "draft_document": {
      const title = firstString(args, [
        "title",
        "document_type",
        "deliverable_type",
        "instruction",
      ]);
      return title ? clip(title) : undefined;
    }
    case "research_task": {
      const q = firstString(args, ["query", "instruction", "topic", "question"]);
      return q ? clip(q) : undefined;
    }
    case "update_draft": {
      const task = firstString(args, ["task_id", "instruction"]);
      return task ? clip(task) : undefined;
    }
    case "apply_surgical_edits": {
      const n = countEdits(args);
      const file = basenamePath(firstString(args, ["path", "rel_path", "baseline_path", "file"]));
      if (n != null && file) {
        return `${n} 处 · ${file}`;
      }
      if (n != null) {
        return `${n} 处修订`;
      }
      return file || undefined;
    }
    case "write_document": {
      const file = basenamePath(firstString(args, ["path", "rel_path", "filename"]));
      return file || undefined;
    }
    case "send_email":
    case "prepare_outbound_mail": {
      const to = firstString(args, ["to", "recipient"]);
      const subject = firstString(args, ["subject"]);
      if (to && subject) {
        return clip(`${to} · ${subject}`, 80);
      }
      return clip(to || subject) || undefined;
    }
    case "list_mail_inbox":
    case "list_mail_attachments": {
      const matter = firstString(args, ["matter_id"]);
      return matter ? `本案 ${matter}` : undefined;
    }
    case "render_document":
    case "render_tracked_draft": {
      const task = firstString(args, ["task_id"]);
      return task ? clip(task) : undefined;
    }
    case "read_project_file":
    case "read_case_file":
    case "analyze_document":
    case "list_dir": {
      const file = basenamePath(firstString(args, ["path", "rel_path", "file", "file_path"]));
      return file || undefined;
    }
    case "explore_folder": {
      const folder = basenamePath(firstString(args, ["path", "materials"]));
      return folder || undefined;
    }
    case "draft_worker": {
      const section = firstString(args, ["section", "goal"]);
      return section ? clip(section) : undefined;
    }
    case "compare_documents": {
      const a = basenamePath(firstString(args, ["file_a", "path_a"]));
      const b = basenamePath(firstString(args, ["file_b", "path_b"]));
      if (a && b) {
        return clip(`${a} / ${b}`, 80);
      }
      return a || b || undefined;
    }
    case "execute_workflow": {
      const instruction = firstString(args, ["instruction", "existing_task_id"]);
      return instruction ? clip(instruction) : undefined;
    }
    case "read_skill": {
      const id = firstString(args, ["skill_id"]);
      return id ? clip(id) : "查看技能目录";
    }
    case "search_company_registry": {
      const name = firstString(args, ["name"]);
      return name ? clip(name) : "查询企业登记";
    }
    case "search_conversations": {
      const q = firstString(args, ["query"]);
      return q ? clip(q) : "检索其他对话";
    }
    case "read_conversation": {
      const q = firstString(args, ["query"]);
      return q ? clip(q) : "阅读历史对话";
    }
    case "update_plan": {
      const plan = args.plan;
      const n = Array.isArray(plan) ? plan.length : undefined;
      return n != null ? `${n} 步` : "更新本轮步骤";
    }
    case "run_compute":
    case "run_analysis": {
      const purpose = firstString(args, ["purpose"]);
      return purpose ? clip(purpose) : "正在整理测算";
    }
    case "render_chart": {
      const title = firstString(args, ["title"]);
      if (title) {
        return clip(title);
      }
      const spec = args.spec;
      if (spec && typeof spec === "object") {
        const specTitle = asTrimmedString((spec as { title?: unknown }).title);
        return specTitle ? clip(specTitle) : undefined;
      }
      return undefined;
    }
    case "calculate":
      return "按公式核算";
    case "apply_legal_events": {
      const events = args.events;
      if (Array.isArray(events) && events.length > 0) {
        return `${events.length} 项期限`;
      }
      const text = firstString(args, ["text"]);
      return text ? clip(text, 40) : undefined;
    }
    case "compile_intake_brief": {
      const t = firstString(args, ["transcript"]);
      return t ? clip(t, 40) : undefined;
    }
    case "update_matter_profile": {
      const caseNo = firstString(args, ["case_no"]);
      const court = firstString(args, ["court"]);
      return caseNo || court ? clip([caseNo, court].filter(Boolean).join(" · "), 48) : undefined;
    }
    case "create_matter": {
      const title = firstString(args, ["title"]);
      return title ? clip(title) : undefined;
    }
    default:
      return undefined;
  }
}

function describeResultData(name: string, data: unknown): string | undefined {
  if (!data || typeof data !== "object") {
    return undefined;
  }
  const rec = data as Record<string, unknown>;
  const outputPath = asTrimmedString(rec.outputPath) || asTrimmedString(rec.path);
  if (outputPath) {
    return `已写入 ${basenamePath(outputPath)}`;
  }
  if (name === "list_mail_inbox") {
    const count = asFiniteNumber(rec.count);
    if (count != null) {
      return count === 0 ? "邮件匣为空" : `已列出 ${count} 封`;
    }
  }
  if (name === "list_mail_attachments") {
    const count = asFiniteNumber(rec.count);
    if (count != null) {
      return count === 0 ? "无附件" : `已列出 ${count} 个附件`;
    }
  }
  if (name === "search_conversations") {
    const total = asFiniteNumber(rec.total);
    const hits = Array.isArray(rec.hits) ? rec.hits : [];
    const titles = hits
      .map((row) =>
        row && typeof row === "object" ? asTrimmedString((row as { title?: unknown }).title) : "",
      )
      .filter(Boolean)
      .slice(0, 2);
    if (total === 0 || (total == null && hits.length === 0)) {
      return "没有命中其他对话";
    }
    const n = total ?? hits.length;
    if (titles.length > 0) {
      return clip(`命中 ${n} 条：${titles.join("、")}`, 80);
    }
    return `命中 ${n} 条对话`;
  }
  if (name === "read_conversation") {
    const title = asTrimmedString(rec.title);
    return title ? clip(`已阅读「${title}」`, 80) : "已阅读历史对话";
  }
  if (name === "draft_worker") {
    const section = asTrimmedString(rec.section);
    const toolsUsed = Array.isArray(rec.toolsUsed) ? rec.toolsUsed.length : 0;
    const base = section ? `已起草「${section}」` : "已起草片段";
    return toolsUsed > 0 ? clip(`${base}（读 ${toolsUsed} 步）`, 80) : clip(base, 80);
  }
  if (name === "explore_folder") {
    const toolsUsed = Array.isArray(rec.toolsUsed) ? rec.toolsUsed.length : 0;
    const candidates = Array.isArray(rec.candidates) ? rec.candidates.length : 0;
    const summary = asTrimmedString(rec.summary);
    if (summary) {
      return clip(summary, 80);
    }
    if (candidates > 0) {
      const suffix = toolsUsed > 0 ? `，读 ${toolsUsed} 步` : "";
      return clip(`已探查 ${candidates} 个候选${suffix}`, 80);
    }
    return toolsUsed > 0 ? `已探查（读 ${toolsUsed} 步）` : "已探查文件夹";
  }
  if (name === "run_compute" || name === "run_analysis") {
    const summary = asTrimmedString(rec.lawyerSummary);
    if (summary) {
      return clip(summary, 80);
    }
  }
  const message = asTrimmedString(rec.message);
  if (message) {
    return clip(message, 80);
  }
  const taskId = asTrimmedString(rec.taskId);
  if (taskId) {
    return `任务 ${clip(taskId, 40)}`;
  }
  return undefined;
}

function verifyCodesFromData(data: unknown): string[] {
  if (!data || typeof data !== "object") {
    return [];
  }
  const verify = (data as { verify?: { codes?: unknown } }).verify;
  if (!Array.isArray(verify?.codes)) {
    return [];
  }
  return verify.codes.filter((c): c is string => typeof c === "string" && c.trim().length > 0);
}

export function lawyerFacingToolFailureDetail(
  name: string,
  error?: string,
  data?: unknown,
): string {
  if (HIDDEN_PROCESS_TOOLS.has(name)) {
    if (/超时|timed out/i.test(error ?? "")) {
      return "已超时";
    }
    return "核算未完成";
  }
  const err = asTrimmedString(error);
  const codes = verifyCodesFromData(data);
  const blob = `${err}\n${codes.join("\n")}`;
  if (!err && codes.length === 0) {
    return "未完成";
  }
  if (err.includes("【同一回合验收未过】") || /请立即调用\s+\w+/.test(err) || codes.length > 0) {
    if (/未见审阅痕迹|xml_qa/.test(blob)) {
      return "导出未见审阅痕迹，请重导";
    }
    if (/独立审稿/.test(blob)) {
      return "独立审稿未过";
    }
    if (/空修订|redlinePending=0|empty_redline/.test(blob)) {
      return "未产生可核验修订";
    }
    if (/引用对不上/.test(blob)) {
      return "引用对不上来源";
    }
    if (err.includes("【同一回合验收未过】") || /请立即调用\s+\w+/.test(err)) {
      return "本回合验收未过";
    }
  }
  return err ? clip(err, 96) : "未完成";
}

export function presentLawyerToolCall(
  name: string,
  args: Record<string, unknown> = {},
): LawyerToolCard {
  const title = toolDisplayNameZh(name);
  const detail = describeCallArgs(name, args);
  return detail ? { title, detail } : { title };
}

export function presentLawyerToolResult(
  name: string,
  args: Record<string, unknown> = {},
  result: { ok: boolean; error?: string; data?: unknown; aborted?: boolean; timedOut?: boolean },
): LawyerToolCard {
  const title = toolDisplayNameZh(name);
  if (result.aborted || result.error === "已停止") {
    return { title, detail: "已停止" };
  }
  if (result.timedOut || /timed out/i.test(result.error ?? "")) {
    return { title, detail: "已超时" };
  }
  if (!result.ok) {
    return { title, detail: lawyerFacingToolFailureDetail(name, result.error, result.data) };
  }
  if (result.data && typeof result.data === "object") {
    const verify = (result.data as { verify?: { message?: unknown } }).verify;
    const verifyMsg = asTrimmedString(verify?.message);
    if (verifyMsg) {
      return { title, detail: clip(verifyMsg, 96) };
    }
  }
  const fromData = describeResultData(name, result.data);
  if (fromData) {
    return { title, detail: fromData };
  }
  const fromArgs = describeCallArgs(name, args);
  return fromArgs ? { title, detail: fromArgs } : { title, detail: "已完成" };
}
