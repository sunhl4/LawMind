/**
 * 格式自动修（A 层）：把格式统一写成 Word 格式修订，落到一份副本上。
 *
 * 只做「无判断空间」的四项：正文字体、字号、固定行距、首行缩进。
 * 标题层级、编号重排、页边距、成文日期位置需要先判断，不在这里动。
 * 永远写副本，不改原文件；原有修订逐条对账，丢一条就失败。
 */

import path from "node:path";
import {
  applyFormatFixesToDocxFile,
  planFormatFixes,
  type FormatFixKind,
} from "../../../drafts/format-fix.js";
import { readDocxDocumentLayout } from "../../../drafts/word-surface.js";
import { resolveWordRevisionAuthor } from "../../../policy/word-revision-author.js";
import { readWorkspacePolicyFile } from "../../../policy/workspace-policy.js";
import { resolveLawyerLocalFile } from "../../../runtime/lawyer-local-file.js";
import { resolveWorkspaceRelativePath } from "../../../runtime/workspace-path.js";
import type { AgentTool } from "../../types.js";

const MODES = ["imported", "from-scratch", "retemplate"] as const;

function asMode(value: unknown): (typeof MODES)[number] {
  return typeof value === "string" && (MODES as readonly string[]).includes(value)
    ? (value as (typeof MODES)[number])
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

/** 默认副本名：原名_格式修订.docx，不覆盖原文件。 */
export function siblingFormatFixPath(relPath: string): string {
  const posix = relPath.replace(/\\/g, "/");
  const dir = path.posix.dirname(posix);
  const stem = path.posix.basename(posix).replace(/\.docx$/i, "");
  const name = `${stem}_格式修订.docx`;
  return dir === "." ? name : path.posix.join(dir, name);
}

export const fixDocumentFormat: AgentTool = {
  definition: {
    name: "fix_document_format",
    description:
      "格式自动修（A 层）：把正文的字体、字号、固定行距、首行缩进统一成目标格式，" +
      "以 Word 格式修订（rPrChange/pPrChange）写进一份**副本**，原文件不动。" +
      "mode=imported（默认）跟随原文主流格式，只改 lawmind_paragraphs 里点名的段落；" +
      "mode=from-scratch 按 GB/T 9704 草案改正文；mode=retemplate 只在律师明确要求整体调整时用。" +
      "标题层级、编号重排、页边距、成文日期位置属于「要先判断」，本工具不改，会在返回里列出。" +
      "原有修订（对方/前手留下的 w:ins、w:del）逐条对账，丢一条就整体失败，不出副本。",
    category: "draft",
    parameters: {
      file_path: {
        type: "string",
        description: "要修的 .docx（工作区或项目目录相对路径）",
        required: true,
      },
      mode: {
        type: "string",
        enum: [...MODES],
        description:
          "imported（跟随原文）/ from-scratch（国标草案）/ retemplate（律师要求整体套模板）",
      },
      lawmind_paragraphs: {
        type: "array",
        description: "仅 imported 用：LawMind 新增/改写的段落序号（0 基）。不传则不动整篇。",
        items: { type: "number" },
      },
      output_path: {
        type: "string",
        description: "副本路径（相对工作区，必须以 .docx 结尾）。默认 原名_格式修订.docx。",
      },
    },
    riskLevel: "low",
  },
  async execute(params, ctx) {
    const claimed = typeof params.file_path === "string" ? params.file_path.trim() : "";
    if (!claimed) {
      return { ok: false, error: "请提供要修的 .docx 路径。" };
    }
    if (!/\.docx$/i.test(claimed)) {
      return { ok: false, error: "格式自动修只认 .docx。.doc 请先另存为 .docx。" };
    }
    if (claimed.includes("_格式修订")) {
      return {
        ok: false,
        error: "这份已经是格式修订副本。请在原件上调用，或换一个 output_path。",
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
        error: `找不到 ${claimed}。请用工作区相对路径，或先用 list_dir 确认位置。`,
      };
    }

    const mode = asMode(params.mode);
    const paragraphs = asParagraphList(params.lawmind_paragraphs);
    const outRel =
      typeof params.output_path === "string" && params.output_path.trim()
        ? params.output_path.trim()
        : siblingFormatFixPath(located.rel);
    if (!/\.docx$/i.test(outRel)) {
      return { ok: false, error: "副本路径必须以 .docx 结尾。" };
    }
    if (outRel === located.rel) {
      return { ok: false, error: "副本不能覆盖原文件。请换一个 output_path。" };
    }
    // 与所有写入路径同一套围栏：绝对路径、`..`、越出工作区一律拒。
    // 项目目录里的原件，副本也落在项目目录，不要悄悄写进工作区。
    const outRootDir =
      located.root === "project" && ctx.projectDir ? ctx.projectDir : ctx.workspaceDir;
    const resolvedOut = resolveWorkspaceRelativePath(outRootDir, outRel);
    if (!resolvedOut.ok) {
      return { ok: false, error: "副本必须写在工作区里，且不能含 .." };
    }
    const outAbs = resolvedOut.abs;
    if (outAbs === located.abs) {
      return { ok: false, error: "副本不能覆盖原文件。请换一个 output_path。" };
    }

    // 先给一份计划，让律师/模型知道会改哪几段、哪几项。
    try {
      const layout = await readDocxDocumentLayout(located.abs);
      const plan = planFormatFixes({
        mode,
        page: layout.page,
        blocks: layout.blocks,
        ...(layout.hasTextBoxes ? { hasTextBoxes: true } : {}),
        ...(paragraphs ? { lawmindParagraphs: paragraphs } : {}),
      });
      if (plan.fixes.length === 0) {
        return {
          ok: false,
          error:
            mode === "imported"
              ? "没有点名任何 LawMind 段落，或这些段落本来就跟随原文，不需要改。整篇套模板须律师明确要求。"
              : "体检没有发现 A 层可自动改的正文段落。",
          data: { plan },
        };
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      if (/End of central directory|zip/i.test(reason)) {
        return { ok: false, error: "这不是有效的 .docx（可能是旧版 .doc 改了后缀）。" };
      }
      return { ok: false, error: `读不了 ${located.rel}：${reason}` };
    }

    const author =
      resolveWordRevisionAuthor(readWorkspacePolicyFile(ctx.workspaceDir)?.wordRevisionAuthor) ||
      "LawMind";

    const result = await applyFormatFixesToDocxFile({
      inputAbs: located.abs,
      outputAbs: outAbs,
      mode,
      author,
      ...(paragraphs ? { lawmindParagraphs: paragraphs } : {}),
    });
    if (!result.ok) {
      return {
        ok: false,
        error: result.error ?? "格式自动修失败。",
        data: { code: result.code, plan: result.plan },
      };
    }
    if ((result.appliedParagraphs ?? 0) === 0) {
      // 体检有问题但一段都没定位到：没有副本可交，不能报成已写出。
      return {
        ok: false,
        error:
          result.warning ??
          "体检指出了问题，但每一段都没能安全定位，没有写副本（不改总比改错强）。",
        data: { plan: result.plan, appliedParagraphs: 0 },
      };
    }

    const kinds: FormatFixKind[] = ["body.font", "body.size", "body.line", "body.indent"];
    return {
      ok: true,
      data: {
        sourcePath: located.rel,
        outputPath: resolvedOut.rel,
        mode,
        author,
        appliedParagraphs: result.appliedParagraphs ?? 0,
        appliedRuns: result.appliedRuns ?? 0,
        appliedKinds: kinds,
        skippedKinds: result.plan?.skippedKinds ?? [],
        revisions: result.revisions,
        ...(result.warning ? { warning: result.warning } : {}),
        noteZh:
          "已写副本，原文件未改。格式改动是 Word 格式修订，可在 Word 里逐条接受/拒绝；" +
          "原有修订已逐条对账。" +
          (result.revisions?.verified === false
            ? "但原件读不出来，原有修订无法核验，请人工确认后使用。"
            : ""),
      },
    };
  },
};
