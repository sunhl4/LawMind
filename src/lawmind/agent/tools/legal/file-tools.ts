/** Document analyze and write tools. */
import fs from "node:fs/promises";
import path from "node:path";
import { buildHostAccessRuntime } from "../../../host-access/access-broker.js";
import { readBinaryWordDocText, isBinaryWordDocPath } from "../../../mail/read-word-binary.js";
import type { IngestSourceType, IngestStage } from "../../../platform/contracts.js";
import {
  ingestFailure,
  ingestSuccess,
  toolDataFromIngestSuccess,
  toolFailureFromIngest,
} from "../../../platform/ingest-helpers.js";
import {
  RESEARCH_WRITE_BYPASS_REFUSAL,
  shouldRefuseResearchWriteBypass,
} from "../../../research/research-write-bypass-gate.js";
import { isProtectedAnalysisScriptRel } from "../../../runtime/analysis-script-path.js";
import { resolveLawyerLocalFile } from "../../../runtime/lawyer-local-file.js";
import { directoryListingToolData, resolveAndListDirectory } from "../../../runtime/list-dir.js";
import {
  PROTECTED_WORKSPACE_WRITE_REFUSAL,
  isProtectedWorkspaceRel,
} from "../../../runtime/protected-workspace-rels.js";
import { fenceAgentFilePath } from "../../../runtime/workspace-io-fence.js";
import { resolveWorkspaceRelativePath } from "../../../runtime/workspace-path.js";
import { resolveDocumentPageChars } from "../../document-read-budget.js";
import type { AgentTool } from "../../types.js";
import {
  readSafe,
  readDocxText,
  readXlsxPlainText,
  readPdfText,
  readImageTextHybrid,
  readPdfTextByOcr,
  readPdfTextByVision,
  shouldUseVisionFallback,
  isPdfPath,
  isDocxPath,
  isXlsxPath,
  isOcrImagePath,
  unsupportedOfficeIngestReason,
  sliceDocumentPage,
  MAX_DOCX_READ_BYTES,
  MAX_WORKSPACE_PDF_READ_BYTES,
  MAX_IMAGE_OCR_READ_BYTES,
  MAX_XLSX_READ_BYTES,
} from "./ingest-helpers.js";

export const analyzeDocument: AgentTool = {
  definition: {
    name: "analyze_document",
    description:
      "读取律师本机文件并返回正文；若路径是目录则递归列举子目录与文件（有界），请再按返回的 path 阅读。路径可以是工作区相对路径，也可以是项目目录相对路径（文件页钉选的 Word 通常在项目根）。支持 Markdown/txt、PDF、.docx、二进制 .doc、.xlsx、常见图片 OCR。大文件请用 offset/limit 分页；hasMore=true 时用 nextOffset 续读。",
    category: "analyze",
    parameters: {
      file_path: {
        type: "string",
        description: "相对工作区或项目根的路径，或文件名（将在工作区/项目内定位）",
        required: true,
      },
      offset: {
        type: "number",
        description: "从提取文本的第几个字符开始（默认 0）。用于分页续读长合同。",
      },
      limit: {
        type: "number",
        description: "本页最多返回多少字符（默认约 40000，上限 120000）。",
      },
    },
  },
  async execute(params, ctx) {
    const claimed = typeof params.file_path === "string" ? params.file_path : "";
    if (!claimed.trim()) {
      return toolFailureFromIngest(
        ingestFailure(
          "INGEST_INVALID_PATH",
          "path_validation",
          "缺少文件路径。目录请用 list_dir。",
        ),
      );
    }
    const hostRuntime = buildHostAccessRuntime({
      workspaceDir: ctx.workspaceDir,
      sessionId: ctx.sessionId,
      matterId: ctx.matterId,
      projectDir: ctx.projectDir,
      hostMounts: ctx.hostMounts,
      hostGrants: ctx.hostGrants,
      hostAccessFile: ctx.hostAccessFile,
      hostSessionCommandAllowed: ctx.hostSessionCommandAllowed,
    });
    const mountDirs = hostRuntime.mounts.map((m) => m.absPath);
    const located = resolveLawyerLocalFile({
      workspaceDir: ctx.workspaceDir,
      projectDir: ctx.projectDir,
      mountDirs,
      raw: claimed,
      pins: ctx.contextPins,
    });
    if (!located) {
      const listing = resolveAndListDirectory(ctx, claimed, { recursive: true });
      if (listing.ok) {
        return { ok: true, data: directoryListingToolData(listing) };
      }
      const wsPath = resolveWorkspaceRelativePath(ctx.workspaceDir, claimed);
      const projPath = ctx.projectDir?.trim()
        ? resolveWorkspaceRelativePath(ctx.projectDir.trim(), claimed)
        : undefined;
      const escaped =
        !wsPath.ok &&
        wsPath.error === "escape" &&
        (projPath == null || (!projPath.ok && projPath.error === "escape"));
      return toolFailureFromIngest(
        ingestFailure(
          escaped ? "INGEST_INVALID_PATH" : "INGEST_NOT_FOUND",
          "path_validation",
          escaped
            ? "不允许读取工作区外的文件。"
            : `找不到文件：${claimed || "（空路径）"}。已查工作区与项目目录。目录请用 list_dir；项目内 Word 也可用 read_project_file（相对项目根）。`,
        ),
      );
    }
    const filePath = located.abs;
    const canonicalRel = located.rel;
    const toAnalyzeSuccess = (
      sourceType: IngestSourceType,
      content: string,
      bytes: number,
      stage: IngestStage,
    ) => {
      const page = sliceDocumentPage(content, params.offset, params.limit, {
        defaultLimit: resolveDocumentPageChars(ctx.chatModel?.contextTokens),
      });
      const result = ingestSuccess(sourceType, page.content, page.hasMore, bytes, stage);
      const locateHint =
        located.root === "project"
          ? `已定位到项目文件 \`${canonicalRel}\`，请将此路径作为 contract_edit_baseline_path。`
          : claimed !== canonicalRel
            ? `已定位到工作区文件 \`${canonicalRel}\`。`
            : undefined;
      return toolDataFromIngestSuccess(
        result,
        {
          filePath: canonicalRel,
          fileRoot: located.root,
          requestedPath: claimed !== canonicalRel ? claimed : undefined,
          totalChars: page.totalChars,
          offset: page.offset,
          limit: page.limit,
          hasMore: page.hasMore,
          nextOffset: page.nextOffset,
          hint: page.hasMore
            ? `文本未读完：请再用 analyze_document(file_path, offset=${page.nextOffset}) 续读。`
            : locateHint,
        },
        { contentTrust: "untrusted_user_document" },
      );
    };
    const st = await fs.stat(filePath).catch(() => null);
    if (st?.isDirectory()) {
      const listing = resolveAndListDirectory(ctx, claimed, { recursive: true });
      if (listing.ok) {
        return { ok: true, data: directoryListingToolData(listing) };
      }
    }
    if (!st?.isFile()) {
      return toolFailureFromIngest(
        ingestFailure(
          "INGEST_NOT_FOUND",
          "file_stat",
          `找不到文件：${claimed || "（空路径）"}。已查工作区与项目目录。目录请用 list_dir。`,
        ),
      );
    }
    if (isBinaryWordDocPath(filePath)) {
      if (st.size > MAX_DOCX_READ_BYTES) {
        return toolFailureFromIngest(
          ingestFailure(
            "INGEST_FILE_TOO_LARGE",
            "office_extract",
            `DOC 文件过大（>${MAX_DOCX_READ_BYTES} bytes）`,
          ),
        );
      }
      try {
        const content = await readBinaryWordDocText(filePath);
        if (!content) {
          return toolFailureFromIngest(
            ingestFailure(
              "INGEST_EMPTY_CONTENT",
              "office_extract",
              "DOC 无可提取文本",
              "请确认该文档不是纯图片或受保护文档。",
            ),
          );
        }
        return toAnalyzeSuccess("docx", content, st.size, "office_extract");
      } catch (err) {
        return toolFailureFromIngest(
          ingestFailure(
            "INGEST_PARSE_FAILED",
            "office_extract",
            `无法直接读取 .doc：${err instanceof Error ? err.message : String(err)}`,
            "可安装 LibreOffice，或另存为 .docx 后重试。",
          ),
        );
      }
    }
    const officeBlock = unsupportedOfficeIngestReason(filePath);
    if (officeBlock) {
      return toolFailureFromIngest(
        ingestFailure(
          "INGEST_UNSUPPORTED_FORMAT",
          "office_extract",
          officeBlock,
          "可改为 .docx/.xlsx 或纯文本后重试。",
        ),
      );
    }
    if (isDocxPath(filePath)) {
      if (st.size > MAX_DOCX_READ_BYTES) {
        return toolFailureFromIngest(
          ingestFailure(
            "INGEST_FILE_TOO_LARGE",
            "office_extract",
            `DOCX 文件过大（>${MAX_DOCX_READ_BYTES} bytes）`,
          ),
        );
      }
      const content = await readDocxText(filePath);
      if (!content) {
        return toolFailureFromIngest(
          ingestFailure(
            "INGEST_EMPTY_CONTENT",
            "office_extract",
            "DOCX 无可提取文本",
            "请确认该文档不是纯图片或受保护文档。",
          ),
        );
      }
      return toAnalyzeSuccess("docx", content, st.size, "office_extract");
    }
    if (isXlsxPath(filePath)) {
      if (st.size > MAX_XLSX_READ_BYTES) {
        return toolFailureFromIngest(
          ingestFailure(
            "INGEST_FILE_TOO_LARGE",
            "office_extract",
            `XLSX 文件过大（>${MAX_XLSX_READ_BYTES} bytes）`,
          ),
        );
      }
      let xlsxText: string;
      try {
        xlsxText = await readXlsxPlainText(filePath);
      } catch (err) {
        return toolFailureFromIngest(
          ingestFailure(
            "INGEST_PARSE_FAILED",
            "office_extract",
            `XLSX 解析失败: ${err instanceof Error ? err.message : String(err)}`,
          ),
        );
      }
      if (!xlsxText) {
        return toolFailureFromIngest(
          ingestFailure(
            "INGEST_EMPTY_CONTENT",
            "office_extract",
            "XLSX 无可提取文本（工作表可能为空）",
          ),
        );
      }
      return toAnalyzeSuccess("xlsx", xlsxText, st.size, "office_extract");
    }
    if (isOcrImagePath(filePath)) {
      if (st.size > MAX_IMAGE_OCR_READ_BYTES) {
        return toolFailureFromIngest(
          ingestFailure(
            "INGEST_FILE_TOO_LARGE",
            "image_ocr",
            `图片文件过大（>${MAX_IMAGE_OCR_READ_BYTES} bytes）`,
          ),
        );
      }
      const imageResult = await readImageTextHybrid(filePath);
      if (!imageResult) {
        return toolFailureFromIngest(
          ingestFailure(
            "INGEST_EMPTY_CONTENT",
            "image_vision",
            "图片 OCR 未识别到文本（视觉兜底后仍为空）",
          ),
        );
      }
      return toAnalyzeSuccess(
        imageResult.sourceType,
        imageResult.text,
        st.size,
        imageResult.sourceType === "image_ocr" ? "image_ocr" : "image_vision",
      );
    }
    if (isPdfPath(filePath)) {
      if (st.size > MAX_WORKSPACE_PDF_READ_BYTES) {
        return toolFailureFromIngest(
          ingestFailure(
            "INGEST_FILE_TOO_LARGE",
            "pdf_text",
            `PDF 文件过大（>${MAX_WORKSPACE_PDF_READ_BYTES} bytes）`,
          ),
        );
      }
      const content = await readPdfText(filePath);
      if (content) {
        return toAnalyzeSuccess("pdf", content, st.size, "pdf_text");
      }
      const ocrText = await readPdfTextByOcr(filePath);
      if (ocrText) {
        return toAnalyzeSuccess("pdf_ocr", ocrText, st.size, "pdf_ocr");
      }
      if (shouldUseVisionFallback()) {
        const visionText = await readPdfTextByVision(filePath);
        if (visionText) {
          return toAnalyzeSuccess("pdf_vision", visionText, st.size, "pdf_vision");
        }
      }
      return toolFailureFromIngest(
        ingestFailure(
          "INGEST_EMPTY_CONTENT",
          "pdf_vision",
          "PDF 无可提取文本（OCR/视觉兜底后仍为空）",
        ),
      );
    }
    const content = await readSafe(filePath);
    if (!content) {
      return toolFailureFromIngest(
        ingestFailure(
          "INGEST_EMPTY_CONTENT",
          "text_read",
          `文件不存在或为空：${String(params.file_path)}`,
        ),
      );
    }
    return toAnalyzeSuccess("text", content, st.size, "text_read");
  },
};

// ─────────────────────────────────────────────
// Draft Tools
// ─────────────────────────────────────────────

export const writeDocument: AgentTool = {
  definition: {
    name: "write_document",
    description:
      "将内容写入工作区的指定文件。用于保存分析结果、工作笔记等。研究类正文（合规卷宗/调研简报/培训课件）禁止用本工具写入 artifacts 旁路交付，须走 draft_document。参数须含 file_path（也可用 path）与 content。未指定路径时：已关联草稿写入 drafts/<taskId>.json，否则写入本案 notes/ 或工作区 notes/（标题_日期_01.md），不写 artifacts/。",
    category: "draft",
    parameters: {
      file_path: { type: "string", description: "相对于工作区的文件路径", required: true },
      content: { type: "string", description: "要写入的内容", required: true },
    },
    // Mid-work writes run without HITL; client-facing export still gated by 文书台签批 + render_document.
    riskLevel: "medium",
  },
  async execute(params, ctx) {
    const claimed =
      typeof params.file_path === "string"
        ? params.file_path
        : typeof params.path === "string"
          ? params.path
          : "";
    const resolved = resolveWorkspaceRelativePath(ctx.workspaceDir, claimed);
    if (!resolved.ok) {
      return { ok: false, error: "不允许写入工作区外的文件。" };
    }
    const relClaimed = resolved.rel;
    if (isProtectedAnalysisScriptRel(relClaimed)) {
      return {
        ok: false,
        error: "不能用写文书投放分析脚本。脚本须放在已签名技能或律师确认的分析脚本目录。",
      };
    }
    if (isProtectedWorkspaceRel(relClaimed)) {
      return { ok: false, error: PROTECTED_WORKSPACE_WRITE_REFUSAL };
    }
    const fenced = fenceAgentFilePath({ rootDir: ctx.workspaceDir, abs: resolved.abs });
    if (!fenced.ok) {
      return { ok: false, error: fenced.error };
    }
    const filePath = path.join(path.resolve(ctx.workspaceDir), fenced.rel);
    const rel = fenced.rel || relClaimed;
    if (isProtectedAnalysisScriptRel(rel) || isProtectedWorkspaceRel(rel)) {
      return {
        ok: false,
        error: isProtectedAnalysisScriptRel(rel)
          ? "不能用写文书投放分析脚本。脚本须放在已签名技能或律师确认的分析脚本目录。"
          : PROTECTED_WORKSPACE_WRITE_REFUSAL,
      };
    }
    const bypass = shouldRefuseResearchWriteBypass({
      workspaceDir: ctx.workspaceDir,
      filePath: rel,
      linkedTaskId: ctx.linkedTaskId,
    });
    if (bypass.refuse) {
      return {
        ok: false,
        error: bypass.reason ?? RESEARCH_WRITE_BYPASS_REFUSAL,
        data: {
          gateDecision: {
            gate: "research_write_bypass_gate",
            decision: "block",
            reason: bypass.reason ?? RESEARCH_WRITE_BYPASS_REFUSAL,
          },
          existingTaskId: bypass.taskId,
          hint: "请 draft_document（传入 task_id）经大纲确认与证据门禁后，再走审核台导出。",
        },
      };
    }
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, params.content as string, "utf8");
    return {
      ok: true,
      data: { filePath: rel, bytes: (params.content as string).length },
    };
  },
};

// ─────────────────────────────────────────────
// System / Status Tools
// ─────────────────────────────────────────────
