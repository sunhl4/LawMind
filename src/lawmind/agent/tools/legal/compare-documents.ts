/**
 * Read-only two-file compare. Reuses analyze_document ingest; does not write or redline.
 */

import { UNTRUSTED_DOCUMENT_PREAMBLE } from "../../../platform/content-trust.js";
import { diffLines } from "../../../text/line-diff.js";
import type { AgentTool } from "../../types.js";
import { analyzeDocument } from "./file-tools.js";

const MAX_COMPARE_LINES = 4000;
const MAX_HUNK_SAMPLES = 40;
const MAX_HUNK_LINE_CHARS = 200;

function asRelPath(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function rawAnalyzeText(data: unknown): { text: string; hasMore: boolean } {
  if (!data || typeof data !== "object") {
    return { text: "", hasMore: false };
  }
  const rec = data as { content?: unknown; hasMore?: unknown };
  let text = typeof rec.content === "string" ? rec.content : "";
  if (text.startsWith(UNTRUSTED_DOCUMENT_PREAMBLE)) {
    text = text.slice(UNTRUSTED_DOCUMENT_PREAMBLE.length).replace(/\n---\s*$/, "");
  }
  return { text, hasMore: rec.hasMore === true };
}

function clipLine(line: string): string {
  if (line.length <= MAX_HUNK_LINE_CHARS) {
    return line;
  }
  return `${line.slice(0, MAX_HUNK_LINE_CHARS)}…`;
}

export const compareDocuments: AgentTool = {
  definition: {
    name: "compare_documents",
    description:
      "只读对比两份工作区文件的文本差异，不改稿、不生成红线。参数为 file_a 与 file_b（相对工作区路径）。需要改稿时另用 apply_surgical_edits。",
    category: "analyze",
    parameters: {
      file_a: { type: "string", description: "第一份文件（相对工作区路径）", required: true },
      file_b: { type: "string", description: "第二份文件（相对工作区路径）", required: true },
    },
    isConcurrencySafe: true,
    riskLevel: "low",
  },
  async execute(params, ctx) {
    const fileA = asRelPath(params.file_a) || asRelPath(params.path_a);
    const fileB = asRelPath(params.file_b) || asRelPath(params.path_b);
    if (!fileA || !fileB) {
      return { ok: false, error: "请提供两份要对比的文件路径。" };
    }
    const [left, right] = await Promise.all([
      analyzeDocument.execute({ file_path: fileA }, ctx),
      analyzeDocument.execute({ file_path: fileB }, ctx),
    ]);
    if (!left.ok) {
      return { ok: false, error: left.error ?? `无法读取 ${fileA}` };
    }
    if (!right.ok) {
      return { ok: false, error: right.error ?? `无法读取 ${fileB}` };
    }
    const a = rawAnalyzeText(left.data);
    const b = rawAnalyzeText(right.data);
    const aLines = a.text.split(/\r?\n/);
    const bLines = b.text.split(/\r?\n/);
    const truncatedLines = aLines.length > MAX_COMPARE_LINES || bLines.length > MAX_COMPARE_LINES;
    const { hunks } = diffLines(
      aLines.slice(0, MAX_COMPARE_LINES).join("\n"),
      bLines.slice(0, MAX_COMPARE_LINES).join("\n"),
    );
    let added = 0;
    let removed = 0;
    const samples: Array<{ type: "add" | "remove"; lines: string[] }> = [];
    for (const hunk of hunks) {
      if (hunk.type === "add") {
        added += hunk.lines.length;
        if (samples.length < MAX_HUNK_SAMPLES) {
          samples.push({ type: "add", lines: hunk.lines.slice(0, 8).map(clipLine) });
        }
      } else if (hunk.type === "remove") {
        removed += hunk.lines.length;
        if (samples.length < MAX_HUNK_SAMPLES) {
          samples.push({ type: "remove", lines: hunk.lines.slice(0, 8).map(clipLine) });
        }
      }
    }
    const identical = added === 0 && removed === 0 && !a.hasMore && !b.hasMore && !truncatedLines;
    return {
      ok: true,
      data: {
        fileA,
        fileB,
        identical,
        added,
        removed,
        hunks: samples,
        truncated: a.hasMore || b.hasMore || truncatedLines,
        message: identical
          ? "两份文本一致。"
          : `差异：删 ${removed} 行，增 ${added} 行。只读对比，未改任何文件。`,
      },
    };
  },
};
