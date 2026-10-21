/**
 * 格式体检（只读）。把「律师自己找格式问题」变成 LawMind 的活。
 *
 * 三种口径由调用方声明，工具不猜：
 * - imported：当事人/客户/对方来的文件，跟随原文主流格式，不套模板；
 * - from-scratch：从零起草的公文，按国标草案；
 * - retemplate：律师明确要求整体调整格式，才按国标草案改整篇。
 *
 * 本工具只出清单，不改一个字。要改，另走改稿工具。
 */

import fs from "node:fs/promises";
import {
  auditDocumentFormat,
  formatForLawmindText,
  renderFormatAuditText,
  type FormatAuditMode,
  type FormatAuditReport,
} from "../../../drafts/document-format-audit.js";
import { readDocxDocumentLayout } from "../../../drafts/word-surface.js";
import { resolveLawyerLocalFile } from "../../../runtime/lawyer-local-file.js";
import type { AgentTool } from "../../types.js";

const MODES: readonly FormatAuditMode[] = ["imported", "from-scratch", "retemplate"];

function asMode(value: unknown): FormatAuditMode {
  return typeof value === "string" && (MODES as readonly string[]).includes(value)
    ? (value as FormatAuditMode)
    : "imported";
}

function asParagraphList(value: unknown): number[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const list = value
    .map((item) => (typeof item === "number" ? item : Number(item)))
    .filter((item) => Number.isInteger(item) && item >= 0);
  return list.length > 0 ? list : undefined;
}

export const checkDocumentFormat: AgentTool = {
  definition: {
    name: "check_document_format",
    description:
      "只读格式体检：逐段检查 .docx 的字体、字号、行距、缩进、标题层级、成文日期，出一份「哪不行」的清单，不改文件。" +
      "mode=imported（默认）用于当事人/客户/对方来的文件：跟随原文件主流格式，不套模板。" +
      "mode=from-scratch 用于从零起草的公文（按 GB/T 9704 草案）。" +
      "mode=retemplate 只在律师明确要求整体调整格式时用。" +
      "报告里明确列出没检查的项目——不要把它当成「全部合格」。改了格式要另走改稿工具。",
    category: "analyze",
    parameters: {
      file_path: {
        type: "string",
        description: "要体检的 .docx（工作区相对路径，或项目目录相对路径）",
        required: true,
      },
      mode: {
        type: "string",
        enum: [...MODES],
        description:
          "imported（默认，跟随原文）/ from-scratch（从零起草，国标草案）/ retemplate（律师要求整体套模板）",
      },
      lawmind_paragraphs: {
        type: "array",
        description:
          "仅 imported 用：本次 LawMind 新增/改写的段落序号（0 基，按阅读序）。传了就只核对这些段落有没有跟原文格式走。",
        items: { type: "number" },
      },
    },
    isConcurrencySafe: true,
    riskLevel: "low",
  },
  async execute(params, ctx) {
    const claimed = typeof params.file_path === "string" ? params.file_path.trim() : "";
    if (!claimed) {
      return { ok: false, error: "请提供要体检的 .docx 路径。" };
    }
    if (!/\.docx$/i.test(claimed)) {
      return {
        ok: false,
        error: "格式体检只认 .docx。.doc 请先转成 .docx（或另存为 .docx）再体检。",
      };
    }
    const located = resolveLawyerLocalFile({
      workspaceDir: ctx.workspaceDir,
      projectDir: ctx.projectDir,
      raw: claimed,
      pins: ctx.contextPins,
      wordOnly: true,
    });
    if (!located) {
      return {
        ok: false,
        error: `找不到 ${claimed}。请用工作区相对路径，或先用 list_dir / read_project_file 确认位置。`,
      };
    }

    let report: FormatAuditReport;
    let lawmindTextFormat: ReturnType<typeof formatForLawmindText>;
    try {
      const layout = await readDocxDocumentLayout(located.abs);
      const { page, blocks } = layout;
      const mode = asMode(params.mode);
      report = auditDocumentFormat({
        page,
        blocks,
        mode,
        ...(layout.hasTextBoxes ? { hasTextBoxes: true } : {}),
        ...(asParagraphList(params.lawmind_paragraphs)
          ? { lawmindParagraphs: asParagraphList(params.lawmind_paragraphs) }
          : {}),
      });
      // 之后往这份文件里写新内容时该用的格式：外来件跟随原文，从零起草才用国标。
      lawmindTextFormat = formatForLawmindText({ mode, blocks });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      if (/End of central directory|zip/i.test(reason)) {
        return {
          ok: false,
          error: `${located.rel} 不是有效的 .docx（可能是旧版 .doc 改了后缀，或文件损坏）。`,
        };
      }
      return { ok: false, error: `读不了 ${located.rel}：${reason}` };
    }

    // 明确回报：只出清单，不动文件。
    const bytes = await fs.stat(located.abs).then(
      (stat) => stat.size,
      () => 0,
    );

    return {
      ok: true,
      data: {
        path: located.rel,
        root: located.root,
        bytes,
        mode: report.mode,
        standard: report.standard,
        profile: report.profile,
        counts: report.counts,
        ok: report.ok,
        unchecked: report.unchecked,
        findings: report.findings,
        summaryZh: report.summaryZh,
        report: renderFormatAuditText(report),
        /** 往这份文件里写新内容时该用的格式（外来件=原文，从零起草=国标）。 */
        lawmindTextFormat,
        noteZh: "只读体检，未改动文件。格式要改，请另走改稿工具，并说明改哪些项。",
      },
    };
  },
};
