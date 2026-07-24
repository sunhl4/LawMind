/** Matter, workspace, statute, case-law, and project file search tools. */
import fs from "node:fs/promises";
import path from "node:path";
import { loadMatter } from "../../../adapters/matter-storage/index.js";
import { buildMatterIndex, listMatterIds, searchMatterIndex } from "../../../cases/index.js";
import { searchPersonalKnowledge } from "../../../indexing/knowledge-search.js";
import { loadMemoryContext } from "../../../memory/index.js";
import type { IngestSourceType, IngestStage } from "../../../platform/contracts.js";
import {
  ingestFailure,
  ingestSuccess,
  toolDataFromIngestSuccess,
  toolFailureFromIngest,
} from "../../../platform/ingest-helpers.js";
import type { AgentTool } from "../../types.js";
import { matterRequiredResult } from "../matter-required.js";
import {
  isPathInsideRoot,
  isPdfPath,
  isDocxPath,
  isXlsxPath,
  isOcrImagePath,
  normalizeRelPath,
  readDocxText,
  readXlsxPlainText,
  readPdfText,
  readImageTextHybrid,
  readPdfTextByOcr,
  readPdfTextByVision,
  shouldUseVisionFallback,
  unsupportedOfficeIngestReason,
  searchProjectTextFiles,
  sliceDocumentPage,
  MAX_PROJECT_READ_BYTES,
  MAX_PROJECT_PDF_READ_BYTES,
  MAX_DOCX_READ_BYTES,
  MAX_IMAGE_OCR_READ_BYTES,
  MAX_XLSX_READ_BYTES,
} from "./ingest-helpers.js";

export const searchMatter: AgentTool = {
  definition: {
    name: "search_matter",
    description: "在当前案件的所有记录中搜索关键词，包括争点、风险、任务、草稿、审计事件。",
    category: "search",
    parameters: {
      query: { type: "string", description: "搜索关键词", required: true },
      matter_id: { type: "string", description: "案件 ID（默认使用当前案件）" },
    },
  },
  async execute(params, ctx) {
    const matterId = (params.matter_id as string) || ctx.matterId;
    if (!matterId) {
      return matterRequiredResult(ctx.workspaceDir);
    }
    const index = await buildMatterIndex(ctx.workspaceDir, matterId);
    const hits = searchMatterIndex(index, params.query as string);
    return {
      ok: true,
      data: { matterId, query: params.query, hits: hits.slice(0, 20), total: hits.length },
    };
  },
};

export const searchWorkspace: AgentTool = {
  definition: {
    name: "search_workspace",
    description:
      "搜索个人知识库与工作区材料（FTS hybrid：CASE/记忆/playbook/golden 等）。默认压低日记假命中；跨受限案件仍受策略限制。若用户关联了桌面「项目目录」，会额外扫描有限数量的纯文本文件。",
    category: "search",
    parameters: {
      query: { type: "string", description: "搜索关键词", required: true },
    },
  },
  async execute(params, ctx) {
    const queryRaw = typeof params.query === "string" ? params.query : "";
    const query = queryRaw.toLowerCase();
    const results: Array<{
      source: string;
      snippet: string;
      docKind?: string;
      path?: string;
      score?: number;
    }> = [];

    try {
      const knowledge = await searchPersonalKnowledge(ctx.workspaceDir, {
        q: queryRaw,
        matterId: ctx.matterId,
        limit: 24,
      });
      for (const hit of knowledge.hits) {
        results.push({
          source: hit.path,
          path: hit.path,
          docKind: hit.docKind,
          snippet: hit.snippet,
          score: hit.score,
        });
      }
    } catch {
      // fall through to lexical memory scan
    }

    // Lexical fallback / supplement for hot memory surfaces (small-file bias).
    const memory = await loadMemoryContext(ctx.workspaceDir, { matterId: ctx.matterId });
    for (const [source, content] of Object.entries({
      "MEMORY.md": memory.general,
      "LAWYER_PROFILE.md": memory.profile,
      "CASE.md": memory.caseMemory,
      "today-log": memory.todayLog,
    })) {
      if (!content) {
        continue;
      }
      const lines = content.split("\n");
      for (const line of lines) {
        if (line.toLowerCase().includes(query)) {
          results.push({ source, snippet: line.trim().slice(0, 200) });
        }
      }
    }

    let projectHits: Array<{ source: string; snippet: string }> = [];
    if (ctx.projectDir?.trim()) {
      try {
        projectHits = await searchProjectTextFiles(ctx.projectDir.trim(), queryRaw);
      } catch {
        projectHits = [];
      }
    }

    const crossMatterAllowed = process.env.LAWMIND_ALLOW_CROSS_MATTER_SEARCH === "1";
    if (crossMatterAllowed) {
      try {
        const matterIds = await listMatterIds(ctx.workspaceDir);
        for (const mid of matterIds.slice(0, 20)) {
          if (ctx.matterId && mid === ctx.matterId) {
            continue;
          }
          const record = loadMatter(ctx.workspaceDir, mid);
          if (record?.sensitivity === "restricted") {
            continue;
          }
          const index = await buildMatterIndex(ctx.workspaceDir, mid);
          if (!index.caseMemory) {
            continue;
          }
          for (const line of index.caseMemory.split("\n")) {
            if (line.toLowerCase().includes(query)) {
              results.push({
                source: `CASE:${mid}`,
                path: `cases/${mid}/CASE.md`,
                docKind: "case",
                snippet: line.trim().slice(0, 200),
              });
            }
          }
        }
      } catch {
        // best-effort
      }
    }

    const merged = [...results, ...projectHits].slice(0, 60);

    return {
      ok: true,
      data: {
        query: params.query,
        results: merged,
        total: merged.length,
        projectScanned: Boolean(ctx.projectDir?.trim()),
        crossMatterScanned: crossMatterAllowed,
        knowledgeHybrid: true,
      },
    };
  },
};

export const readProjectFile: AgentTool = {
  definition: {
    name: "read_project_file",
    description:
      "读取律师在桌面端关联的「项目目录」下的文本文件、PDF、.docx、.xlsx（表格转 TSV 纯文本，有界）、常见图片（OCR，可选视觉兜底）（相对路径）。不支持旧式 .doc/.xls/.ppt 与 .pptx。用于合同、证据清单、说明等本地材料；未关联项目时不可用。大文件请用 offset/limit（字符）分页；hasMore=true 时用 nextOffset 续读。",
    category: "search",
    parameters: {
      relative_path: {
        type: "string",
        description: '相对项目根的路径，如 "合同/补充协议.md" 或 "notes.txt"',
        required: true,
      },
      offset: {
        type: "number",
        description: "从提取文本的第几个字符开始（默认 0）。",
      },
      limit: {
        type: "number",
        description: "本页最多返回多少字符（默认约 40000，上限 120000）。",
      },
    },
  },
  async execute(params, ctx) {
    const root = ctx.projectDir?.trim();
    if (!root) {
      return toolFailureFromIngest(
        ingestFailure(
          "INGEST_INVALID_PATH",
          "path_validation",
          "未关联项目目录：请在 LawMind 桌面端选择项目文件夹后再试。",
        ),
      );
    }
    const rel = normalizeRelPath(params.relative_path as string);
    const toProjectSuccess = (
      sourceType: IngestSourceType,
      content: string,
      bytes: number,
      stage: IngestStage,
    ) => {
      const page = sliceDocumentPage(content, params.offset, params.limit);
      const result = ingestSuccess(sourceType, page.content, page.hasMore, bytes, stage);
      return toolDataFromIngestSuccess(
        result,
        {
          path: rel,
          size: result.bytes,
          totalChars: page.totalChars,
          offset: page.offset,
          limit: page.limit,
          hasMore: page.hasMore,
          nextOffset: page.nextOffset,
          hint: page.hasMore
            ? `文本未读完：请再用 read_project_file(relative_path, offset=${page.nextOffset}) 续读。`
            : undefined,
        },
        { contentTrust: "untrusted_user_document" },
      );
    };
    if (!rel || rel.includes("..")) {
      return toolFailureFromIngest(
        ingestFailure("INGEST_INVALID_PATH", "path_validation", "非法路径"),
      );
    }
    const full = path.resolve(root, rel);
    if (!isPathInsideRoot(root, full)) {
      return toolFailureFromIngest(
        ingestFailure("INGEST_INVALID_PATH", "path_validation", "路径越界"),
      );
    }
    const st = await fs.stat(full).catch(() => null);
    if (!st?.isFile()) {
      return toolFailureFromIngest(
        ingestFailure("INGEST_NOT_FOUND", "file_stat", "文件不存在或不是普通文件"),
      );
    }
    const projectOfficeBlock = unsupportedOfficeIngestReason(full);
    if (projectOfficeBlock) {
      return toolFailureFromIngest(
        ingestFailure(
          "INGEST_UNSUPPORTED_FORMAT",
          "office_extract",
          projectOfficeBlock,
          "可改为 .docx/.xlsx 或纯文本后重试。",
        ),
      );
    }
    if (isDocxPath(full)) {
      if (st.size > MAX_DOCX_READ_BYTES) {
        return toolFailureFromIngest(
          ingestFailure(
            "INGEST_FILE_TOO_LARGE",
            "office_extract",
            `DOCX 文件过大（>${MAX_DOCX_READ_BYTES} bytes）`,
          ),
        );
      }
      const text = await readDocxText(full);
      if (!text) {
        return toolFailureFromIngest(
          ingestFailure(
            "INGEST_EMPTY_CONTENT",
            "office_extract",
            "DOCX 无可提取文本",
            "请确认该文档不是纯图片或受保护文档。",
          ),
        );
      }
      return toProjectSuccess("docx", text, st.size, "office_extract");
    }
    if (isXlsxPath(full)) {
      if (st.size > MAX_XLSX_READ_BYTES) {
        return toolFailureFromIngest(
          ingestFailure(
            "INGEST_FILE_TOO_LARGE",
            "office_extract",
            `XLSX 文件过大（>${MAX_XLSX_READ_BYTES} bytes）`,
          ),
        );
      }
      let text: string;
      try {
        text = await readXlsxPlainText(full);
      } catch (err) {
        return toolFailureFromIngest(
          ingestFailure(
            "INGEST_PARSE_FAILED",
            "office_extract",
            `XLSX 解析失败: ${err instanceof Error ? err.message : String(err)}`,
          ),
        );
      }
      if (!text) {
        return toolFailureFromIngest(
          ingestFailure(
            "INGEST_EMPTY_CONTENT",
            "office_extract",
            "XLSX 无可提取文本（工作表可能为空）",
          ),
        );
      }
      return toProjectSuccess("xlsx", text, st.size, "office_extract");
    }
    if (isOcrImagePath(full)) {
      if (st.size > MAX_IMAGE_OCR_READ_BYTES) {
        return toolFailureFromIngest(
          ingestFailure(
            "INGEST_FILE_TOO_LARGE",
            "image_ocr",
            `图片文件过大（>${MAX_IMAGE_OCR_READ_BYTES} bytes）`,
          ),
        );
      }
      const imageResult = await readImageTextHybrid(full);
      if (!imageResult) {
        return toolFailureFromIngest(
          ingestFailure(
            "INGEST_EMPTY_CONTENT",
            "image_vision",
            "图片 OCR 未识别到文本（视觉兜底后仍为空）",
          ),
        );
      }
      return toProjectSuccess(
        imageResult.sourceType,
        imageResult.text,
        st.size,
        imageResult.sourceType === "image_ocr" ? "image_ocr" : "image_vision",
      );
    }
    if (isPdfPath(full)) {
      if (st.size > MAX_PROJECT_PDF_READ_BYTES) {
        return toolFailureFromIngest(
          ingestFailure(
            "INGEST_FILE_TOO_LARGE",
            "pdf_text",
            `PDF 文件过大（>${MAX_PROJECT_PDF_READ_BYTES} bytes）`,
          ),
        );
      }
      const text = await readPdfText(full);
      if (text) {
        return toProjectSuccess("pdf", text, st.size, "pdf_text");
      }
      const ocrText = await readPdfTextByOcr(full);
      if (ocrText) {
        return toProjectSuccess("pdf_ocr", ocrText, st.size, "pdf_ocr");
      }
      if (shouldUseVisionFallback()) {
        const visionText = await readPdfTextByVision(full);
        if (visionText) {
          return toProjectSuccess("pdf_vision", visionText, st.size, "pdf_vision");
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
    if (st.size > MAX_PROJECT_READ_BYTES) {
      return toolFailureFromIngest(
        ingestFailure(
          "INGEST_FILE_TOO_LARGE",
          "text_read",
          `文件过大（>${MAX_PROJECT_READ_BYTES} bytes）`,
        ),
      );
    }
    const buf = await fs.readFile(full);
    for (let i = 0; i < Math.min(buf.length, 4096); i++) {
      if (buf[i] === 0) {
        return toolFailureFromIngest(
          ingestFailure("INGEST_BINARY_UNSUPPORTED", "text_read", "二进制文件不支持"),
        );
      }
    }
    const text = buf.toString("utf8");
    return toProjectSuccess("text", text, st.size, "text_read");
  },
};

const STATUTE_LINE =
  /《[^》]+》|法典|法律适用|第\s*[零一二三四五六七八九十百千0-9]+条|法规|条例|司法解释|刑法|民法|行政诉讼法|公司法|劳动合同法/i;

export const searchStatute: AgentTool = {
  definition: {
    name: "search_statute",
    description:
      "在工作区记忆与案件摘要中检索与法律法规、条文编号相关的内容（启发式：法条、法规名称等）。不替代正式法规库。",
    category: "search",
    parameters: {
      query: { type: "string", description: "关键词（如法律名称、条款主题）", required: true },
      matter_id: { type: "string", description: "可选：限定某案件的 CASE 与索引" },
    },
  },
  async execute(params, ctx) {
    const query = ((params.query as string) ?? "").trim().toLowerCase();
    if (!query) {
      return { ok: false, error: "query 不能为空" };
    }
    const matterId = (params.matter_id as string | undefined) || ctx.matterId;
    const results: Array<{ source: string; snippet: string }> = [];

    const pushIfStatute = (source: string, line: string) => {
      const t = line.trim();
      if (!t) {
        return;
      }
      const hitQuery = t.toLowerCase().includes(query);
      const hitStatute = STATUTE_LINE.test(t);
      if (!hitQuery && !hitStatute) {
        return;
      }
      results.push({ source, snippet: t.slice(0, 240) });
    };

    if (matterId) {
      const index = await buildMatterIndex(ctx.workspaceDir, matterId);
      for (const line of index.caseMemory.split("\n")) {
        pushIfStatute(`CASE:${matterId}`, line);
      }
      for (const arr of [
        index.coreIssues,
        index.taskGoals,
        index.riskNotes,
        index.progressEntries,
      ] as const) {
        for (const entry of arr) {
          for (const line of entry.split("\n")) {
            pushIfStatute(`index:${matterId}`, line);
          }
        }
      }
    } else {
      const memory = await loadMemoryContext(ctx.workspaceDir, { matterId: ctx.matterId });
      for (const [source, content] of Object.entries({
        "MEMORY.md": memory.general,
        "LAWYER_PROFILE.md": memory.profile,
        "today-log": memory.todayLog,
      })) {
        if (!content) {
          continue;
        }
        for (const line of content.split("\n")) {
          pushIfStatute(source, line);
        }
      }
    }

    const hits = results.slice(0, 25);
    const empty = hits.length === 0;
    return {
      ok: true,
      data: {
        query: params.query,
        matterId: matterId ?? null,
        hits,
        total: results.length,
        ...(empty
          ? {
              refusalRequired: true,
              authority: "none" as const,
              note: "未检索到相关法条线索。模型不得编造法规条文或条文编号；如可用，请改用 search_statute_web 或请律师提供权威文本。",
            }
          : {
              note: "结果为工作区启发式检索，引用前请核对官方法规文本。",
            }),
      },
    };
  },
};

const CASE_LINE =
  /案号|判决书|裁定书|人民法院|高院|中院|最高人民法院|仲裁委|\(\s*20\d{2}\s*\)|民终|民初|刑终|执异|行诉/i;

export const searchCaseLaw: AgentTool = {
  definition: {
    name: "search_case_law",
    description:
      "在工作区案件摘要与记忆中检索裁判文书、案号、法院名称等案例线索（启发式）。不替代裁判文书网等专业库。",
    category: "search",
    parameters: {
      query: {
        type: "string",
        description: "关键词（案号片段、对方名称、法院名等）",
        required: true,
      },
      matter_id: { type: "string", description: "可选：限定案件" },
    },
  },
  async execute(params, ctx) {
    const query = ((params.query as string) ?? "").trim().toLowerCase();
    if (!query) {
      return { ok: false, error: "query 不能为空" };
    }
    const matterId = (params.matter_id as string | undefined) || ctx.matterId;
    const results: Array<{ source: string; snippet: string }> = [];

    const pushIfCase = (source: string, line: string) => {
      const t = line.trim();
      if (!t) {
        return;
      }
      const hitQuery = t.toLowerCase().includes(query);
      const hitCase = CASE_LINE.test(t);
      if (!hitQuery && !hitCase) {
        return;
      }
      results.push({ source, snippet: t.slice(0, 240) });
    };

    if (matterId) {
      const index = await buildMatterIndex(ctx.workspaceDir, matterId);
      for (const line of index.caseMemory.split("\n")) {
        pushIfCase(`CASE:${matterId}`, line);
      }
      for (const draft of index.drafts) {
        const blob = `${draft.title}\n${draft.sections.map((s) => s.body).join("\n")}`;
        for (const line of blob.split("\n")) {
          pushIfCase(`draft:${draft.taskId}`, line);
        }
      }
    } else {
      const ids = await listMatterIds(ctx.workspaceDir);
      for (const mid of ids.slice(0, 20)) {
        const index = await buildMatterIndex(ctx.workspaceDir, mid);
        for (const line of index.caseMemory.split("\n")) {
          pushIfCase(`CASE:${mid}`, line);
        }
      }
    }

    const hits = results.slice(0, 25);
    const empty = hits.length === 0;
    return {
      ok: true,
      data: {
        query: params.query,
        matterId: matterId ?? null,
        hits,
        total: results.length,
        ...(empty
          ? {
              refusalRequired: true,
              authority: "none" as const,
              note: "未检索到相关案例线索。模型不得编造案号、裁判要旨或判决原文；请使用专业案例库或请律师提供权威文书，勿凭空杜撰。",
            }
          : {
              note: "结果为工作区线索汇总，正式引用请核实原始裁判文书。",
            }),
      },
    };
  },
};

export const checkConflictOfInterest: AgentTool = {
  definition: {
    name: "check_conflict_of_interest",
    description:
      "根据当事人/实体名称在工作区已有案件中做字符串命中筛查，提示可能的多案并存或利益冲突风险（需律师最终判断）。",
    category: "matter",
    parameters: {
      parties: {
        type: "string",
        description: "待核查的当事人或实体名称，逗号/顿号分隔",
        required: true,
      },
    },
  },
  async execute(params, ctx) {
    const raw = (params.parties as string) ?? "";
    const parties = raw
      .split(/[,，、;；]+/)
      .map((s) => s.trim())
      .filter((s) => s.length >= 2);
    if (parties.length === 0) {
      return { ok: false, error: "请提供至少 2 个字符以上的当事人名称。" };
    }

    const ids = await listMatterIds(ctx.workspaceDir);
    const partyToMatters = new Map<string, string[]>();

    for (const party of parties) {
      const hits: string[] = [];
      const pl = party.toLowerCase();
      for (const matterId of ids) {
        const index = await buildMatterIndex(ctx.workspaceDir, matterId);
        const blob = [
          index.caseMemory,
          ...index.coreIssues,
          ...index.taskGoals,
          ...index.riskNotes,
          ...index.progressEntries,
        ]
          .join("\n")
          .toLowerCase();
        if (blob.includes(pl)) {
          hits.push(matterId);
        }
      }
      const memory = await loadMemoryContext(ctx.workspaceDir, {});
      const memBlob = [memory.general, memory.profile].join("\n").toLowerCase();
      if (memBlob.includes(pl)) {
        hits.push("(workspace-memory)");
      }
      if (hits.length > 0) {
        partyToMatters.set(party, [...new Set(hits)]);
      }
    }

    const flags: string[] = [];
    for (const [party, matters] of partyToMatters) {
      if (matters.length > 1) {
        flags.push(
          `「${party}」在多个来源中出现：${matters.join("、")} — 请核对是否构成利益冲突。`,
        );
      }
    }

    return {
      ok: true,
      data: {
        parties,
        matches: Object.fromEntries(partyToMatters),
        conflictFlags: flags,
        matterScanned: ids.length,
        note:
          flags.length === 0
            ? "未发现明显的跨案件同名命中，但仍需结合所知客户关系人工确认。"
            : "发现跨来源命中，建议按事务所利益冲突规程复核。",
      },
    };
  },
};

// ─────────────────────────────────────────────
// Matter Management Tools
// ─────────────────────────────────────────────
