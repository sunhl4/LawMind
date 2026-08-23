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
    case "analyze_document": {
      const file = basenamePath(firstString(args, ["path", "rel_path", "file", "file_path"]));
      return file || undefined;
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
    case "list_more_tools": {
      const name = firstString(args, ["name"]);
      return name ? clip(name) : "查看更多能力";
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
    const err = asTrimmedString(result.error);
    return { title, detail: err ? clip(err, 96) : "未完成" };
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
