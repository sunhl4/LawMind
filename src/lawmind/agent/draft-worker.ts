/**
 * Parallel draft worker (P4). Parent writes a self-contained brief; this worker
 * reads the named sources itself (Codex-style isolated worker) and drafts one
 * section. No nested runTurn: a bounded read-only tool loop, then the parent
 * assembles.
 */

import fs from "node:fs";
import {
  modelAttemptBudget,
  shouldRetryTransportFailure,
  waitModelRetry,
} from "../llm/http-retry.js";
import { applyEnvelopeToAgentModelDefaults } from "../models/capability-envelope.js";
import type { ComposeContextPin } from "../platform/compose-context-pin.js";
import { resolveLawyerLocalDir, resolveLawyerLocalFile } from "../runtime/lawyer-local-file.js";
import { resolveAndListDirectory, type ListDirContext } from "../runtime/list-dir.js";
import {
  assistantOutputLooksTruncated,
  extractAssistantText,
  shouldResampleSidecarJson,
} from "./assistant-text.js";
import {
  DRAFT_WORKER_READONLY_TOOL_NAMES,
  runDraftWorkerReadOnlyLoop,
} from "./draft-worker-loop.js";
import { rankExploreCandidates } from "./explore-folder-worker.js";
import { callModelWithRetry, ModelCallUserAbortError } from "./runtime-model-call.js";
import { readDocxText, readPdfText } from "./tools/legal/ingest-helpers.js";
import type { AgentContext, AgentModelConfig } from "./types.js";
import { validateWorkerBrief } from "./worker-brief.js";

export const DRAFT_WORKER_TOOL_NAME = "draft_worker";

export const DRAFT_WORKER_DEVELOPER_INSTRUCTIONS = [
  "并行写稿工：根据任务书与已读材料写一份文书片段。",
  "禁止改原件，禁止 apply_surgical_edits / render_tracked_draft / draft_document / write_document。",
  "只根据材料写；材料没有的事实标缺口，不要编造法条原文或对方未提供的数字。",
  "材料不够时先用只读工具：list_dir / explore_folder / analyze_document / search_statute / search_case_law。",
  "回报：草稿正文、引用的材料出处、待补缺口。不要声称已完成整份文书。",
].join("");

const MIN_DRAFT_CHARS = 40;
const MIN_SOURCE_CHARS = 40;
const MAX_SOURCE_CHARS = 24_000;
const MAX_FILE_CHARS = 12_000;
const MAX_FILES = 4;
const READABLE_RE = /\.(docx?|pdf|txt|md|csv)$/i;

export type DraftWorkerInput = {
  goal: string;
  notGoal?: string;
  materials?: string;
  excerpt?: string;
  path?: string;
  section?: string;
  style?: string;
};

export type DraftWorkerModelPayload = {
  draft: string;
  citations: string[];
  gaps: string[];
};

export type DraftWorkerContext = Partial<
  Pick<
    AgentContext,
    | "workspaceDir"
    | "sessionId"
    | "projectDir"
    | "contextPins"
    | "chatModel"
    | "reviewModel"
    | "webSearchModel"
    | "abortSignal"
    | "matterId"
    | "actorId"
    | "hostMounts"
    | "hostGrants"
    | "hostAccessFile"
    | "emitToolProgress"
  >
>;

export type DraftWorkerOutput =
  | {
      ok: true;
      data: {
        role: "draft-worker";
        instructions: string;
        brief: string;
        section: string;
        draft: string;
        citations: string[];
        gaps: string[];
        sources: string[];
        toolsUsed: string[];
        steps: Array<{ tool: string; ok: boolean }>;
      };
    }
  | {
      ok: false;
      error: string;
      aborted?: boolean;
    };

function clipExcerpt(raw: string | undefined, max = MAX_SOURCE_CHARS): string {
  const t = (raw ?? "").trim();
  if (!t) {
    return "";
  }
  if (t.length <= max) {
    return t;
  }
  return `${t.slice(0, max)}\n…[摘录截断]`;
}

function stripMarkdownFence(raw: string): string {
  return raw
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    .map((item) => item.trim())
    .slice(0, 24);
}

function tryParseJsonObject(raw: string): Record<string, unknown> | null {
  const candidates = [raw.trim(), stripMarkdownFence(raw)];
  const fence = candidates[1] ?? raw;
  const start = fence.indexOf("{");
  const end = fence.lastIndexOf("}");
  if (start >= 0 && end > start) {
    candidates.push(fence.slice(start, end + 1));
  }
  for (const candidate of candidates) {
    try {
      const parsed: unknown = JSON.parse(candidate);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      /* try next candidate */
    }
  }
  return null;
}

function sectionBetween(raw: string, start: string, ends: string[]): string {
  const from = raw.indexOf(start);
  if (from < 0) {
    return "";
  }
  const rest = raw.slice(from + start.length);
  let cut = rest.length;
  for (const end of ends) {
    const at = rest.indexOf(end);
    if (at >= 0 && at < cut) {
      cut = at;
    }
  }
  return rest.slice(0, cut).trim();
}

function parseDelimitedDraft(raw: string): DraftWorkerModelPayload | null {
  const text = stripMarkdownFence(raw);
  if (!text.includes("【正文】")) {
    return null;
  }
  const draft = sectionBetween(text, "【正文】", ["【出处】", "【缺口】"]);
  if (draft.length < MIN_DRAFT_CHARS) {
    return null;
  }
  const cites = sectionBetween(text, "【出处】", ["【缺口】", "【正文】"]);
  const gaps = sectionBetween(text, "【缺口】", ["【出处】", "【正文】"]);
  const list = (block: string) =>
    block
      .split(/\n+/)
      .map((line) => line.replace(/^[-*•]\s*/, "").trim())
      .filter((line) => line.length > 0 && line !== "无");
  return { draft, citations: list(cites), gaps: list(gaps) };
}

/** Parse JSON `{ draft, citations, gaps }`, delimited 正文/出处/缺口, or substantial prose. */
export function parseDraftWorkerModelText(raw: string): DraftWorkerModelPayload | null {
  const text = raw.trim();
  if (!text) {
    return null;
  }
  const rec = tryParseJsonObject(text);
  if (rec) {
    const draft = typeof rec.draft === "string" ? rec.draft.trim() : "";
    if (draft.length >= MIN_DRAFT_CHARS) {
      return {
        draft,
        citations: stringList(rec.citations),
        gaps: stringList(rec.gaps),
      };
    }
    return null;
  }
  const delimited = parseDelimitedDraft(text);
  if (delimited) {
    return delimited;
  }
  const prose = stripMarkdownFence(text);
  if (prose.startsWith("{") || prose.includes("【正文】")) {
    return null;
  }
  if (prose.length >= MIN_DRAFT_CHARS) {
    return {
      draft: prose,
      citations: [],
      gaps: ["模型未按约定格式返回，正文按散文收录"],
    };
  }
  return null;
}

/** Keep citations that actually appear in the source text; inventing 出处 goes to gaps. */
export function groundDraftCitations(
  citations: string[],
  source: string,
): { citations: string[]; dropped: string[] } {
  const compactSource = source.replace(/\s+/g, "");
  const kept: string[] = [];
  const dropped: string[] = [];
  for (const raw of citations) {
    const citation = raw.trim();
    if (!citation) {
      continue;
    }
    if (citationGrounded(citation, compactSource)) {
      kept.push(citation);
    } else {
      dropped.push(citation);
    }
  }
  return { citations: kept, dropped };
}

function citationGrounded(citation: string, compactSource: string): boolean {
  const compact = citation.replace(/\s+/g, "");
  if (compact.length === 0) {
    return false;
  }
  if (compactSource.includes(compact)) {
    return true;
  }
  if (compact.length < 4) {
    return compactSource.includes(compact);
  }
  for (let i = 0; i <= compact.length - 4; i += 1) {
    if (compactSource.includes(compact.slice(i, i + 4))) {
      return true;
    }
  }
  return false;
}

export function resolveDraftWorkerModel(
  ctx?: Pick<AgentContext, "chatModel" | "reviewModel" | "webSearchModel">,
): AgentModelConfig | undefined {
  const chat = ctx?.chatModel;
  if (chat?.apiKey && chat.baseUrl && chat.model) {
    return chat;
  }
  const review = ctx?.reviewModel;
  if (review?.apiKey && review.baseUrl && review.model) {
    return review;
  }
  const web = ctx?.webSearchModel;
  if (web?.apiKey && web.baseUrl && web.model) {
    return {
      provider: "openai-compatible",
      baseUrl: web.baseUrl,
      apiKey: web.apiKey,
      model: web.model,
      timeoutMs: web.timeoutMs,
    };
  }
  return undefined;
}

function looksLikePath(raw: string): boolean {
  const t = raw.trim();
  if (!t || t.includes("\n") || t.length > 240) {
    return false;
  }
  return READABLE_RE.test(t) || t.includes("/") || t.includes("\\");
}

function pathCandidates(input: DraftWorkerInput, pins: ComposeContextPin[] | undefined): string[] {
  const found: string[] = [];
  const push = (raw: string | undefined) => {
    const t = raw?.trim() ?? "";
    if (t) {
      found.push(t);
    }
  };
  push(input.path);
  if (looksLikePath(input.materials ?? "")) {
    push(input.materials);
  }
  for (const pin of pins ?? []) {
    if (pin.pinKind === "file" && pin.kind === "file") {
      push(pin.relPath);
    }
  }
  return [...new Set(found)];
}

async function readLocalFileText(abs: string, rel: string): Promise<string> {
  try {
    if (/\.docx$/i.test(rel) || /\.docx$/i.test(abs)) {
      return (await readDocxText(abs)).slice(0, MAX_FILE_CHARS);
    }
    if (/\.pdf$/i.test(rel) || /\.pdf$/i.test(abs)) {
      return (await readPdfText(abs)).slice(0, MAX_FILE_CHARS);
    }
    if (/\.(txt|md|csv|doc)$/i.test(rel) || /\.(txt|md|csv|doc)$/i.test(abs)) {
      return fs.readFileSync(abs, "utf8").slice(0, MAX_FILE_CHARS);
    }
  } catch {
    return "";
  }
  return "";
}

function asListDirContext(ctx: DraftWorkerContext): ListDirContext | undefined {
  if (!ctx.workspaceDir?.trim()) {
    return undefined;
  }
  return {
    workspaceDir: ctx.workspaceDir,
    sessionId: ctx.sessionId || "draft-worker",
    projectDir: ctx.projectDir,
    hostMounts: ctx.hostMounts,
    hostGrants: ctx.hostGrants,
    hostAccessFile: ctx.hostAccessFile,
    contextPins: ctx.contextPins,
  };
}

async function loadSourceMaterials(
  input: DraftWorkerInput,
  ctx: DraftWorkerContext | undefined,
): Promise<{ text: string; sources: string[] }> {
  const chunks: string[] = [];
  const sources: string[] = [];
  const excerpt = clipExcerpt(input.excerpt);
  if (excerpt) {
    chunks.push(excerpt);
    sources.push("excerpt");
  }
  const listCtx = ctx ? asListDirContext(ctx) : undefined;
  if (listCtx) {
    for (const raw of pathCandidates(input, ctx?.contextPins)) {
      if (sources.length >= MAX_FILES + 1) {
        break;
      }
      const file = resolveLawyerLocalFile({
        workspaceDir: listCtx.workspaceDir,
        projectDir: listCtx.projectDir,
        raw,
        pins: listCtx.contextPins,
      });
      if (file) {
        const body = await readLocalFileText(file.abs, file.rel);
        if (body.trim()) {
          chunks.push(`【${file.rel}】\n${body.trim()}`);
          sources.push(file.rel);
        }
        continue;
      }
      const dir = resolveLawyerLocalDir({
        workspaceDir: listCtx.workspaceDir,
        projectDir: listCtx.projectDir,
        raw,
        pins: listCtx.contextPins,
      });
      if (!dir) {
        continue;
      }
      const listing = resolveAndListDirectory(listCtx, dir.rel, { recursive: true });
      if (!listing.ok) {
        continue;
      }
      const ranked = rankExploreCandidates(listing.entries, input.notGoal ?? "", input.goal);
      for (const entry of ranked.slice(0, MAX_FILES)) {
        const nested = resolveLawyerLocalFile({
          workspaceDir: listCtx.workspaceDir,
          projectDir: listCtx.projectDir,
          raw: entry.path,
          pins: listCtx.contextPins,
        });
        if (!nested) {
          continue;
        }
        const body = await readLocalFileText(nested.abs, nested.rel);
        if (!body.trim()) {
          continue;
        }
        chunks.push(`【${nested.rel}】\n${body.trim()}`);
        sources.push(nested.rel);
      }
    }
  }
  return { text: clipExcerpt(chunks.join("\n\n")), sources };
}

function buildDraftUserPrompt(input: DraftWorkerInput, brief: string, source: string): string {
  const section = (input.section ?? "正文").trim() || "正文";
  const style = (input.style ?? "").trim();
  return [
    "请按任务书起草指定章节。优先输出 JSON；长文也可按【正文】【出处】【缺口】分段。",
    `JSON schema: { "draft": "string", "citations": ["材料出处"], "gaps": ["待补缺口"] }`,
    "",
    brief,
    `章节：${section}`,
    style ? `文风：${style}` : "",
    "",
    "【材料】",
    source,
  ]
    .filter((line) => line.length > 0)
    .join("\n");
}

function asWorkerAgentContext(ctx: DraftWorkerContext | undefined): AgentContext | undefined {
  if (!ctx?.workspaceDir?.trim()) {
    return undefined;
  }
  return {
    workspaceDir: ctx.workspaceDir,
    sessionId: ctx.sessionId || "draft-worker",
    actorId: ctx.actorId || "draft-worker",
    matterId: ctx.matterId,
    projectDir: ctx.projectDir,
    contextPins: ctx.contextPins,
    chatModel: ctx.chatModel,
    reviewModel: ctx.reviewModel,
    webSearchModel: ctx.webSearchModel,
    abortSignal: ctx.abortSignal,
    hostMounts: ctx.hostMounts,
    hostGrants: ctx.hostGrants,
    hostAccessFile: ctx.hostAccessFile,
    permissionMode: "readonly",
    inReadonlyWorkerLoop: true,
    emitToolProgress: ctx.emitToolProgress,
  };
}

export async function runDraftWorker(
  input: DraftWorkerInput,
  ctx?: DraftWorkerContext,
): Promise<DraftWorkerOutput> {
  const checked = validateWorkerBrief({
    goal: input.goal,
    notGoal: input.notGoal,
    materials: input.materials ?? input.path,
  });
  if (!checked.ok) {
    return checked;
  }

  const section = (input.section ?? "正文").trim() || "正文";
  const agentCtx = asWorkerAgentContext(ctx);
  const loaded = await loadSourceMaterials(input, ctx);
  const hasSource = loaded.text.replace(/\s+/g, "").length >= MIN_SOURCE_CHARS;
  if (!hasSource && !agentCtx) {
    return {
      ok: false,
      error:
        "没有可读材料。子会话不会猜文件内容：请传入 excerpt，或 path/materials 指向已存在的 .docx/.pdf/.txt，或钉选源文件。",
    };
  }

  const model = resolveDraftWorkerModel(ctx);
  if (!model) {
    return {
      ok: false,
      error: "未配置写稿模型。draft_worker 需要本轮对话模型凭据。",
    };
  }

  const envelope = applyEnvelopeToAgentModelDefaults({
    contextTokens: model.contextTokens,
    temperature: model.temperature,
    taskKind: "draft",
  });
  const sourceBlock = hasSource
    ? loaded.text
    : `材料尚未读到。请先用 ${DRAFT_WORKER_READONLY_TOOL_NAMES.join(" / ")} 读取后再起草。不要编造未读文件。`;
  const systemContent = `${DRAFT_WORKER_DEVELOPER_INSTRUCTIONS}出处必须来自材料或只读工具返回；材料没有的写进缺口。`;
  const userContent = buildDraftUserPrompt(input, checked.brief, sourceBlock);

  if (agentCtx) {
    const loop = await runDraftWorkerReadOnlyLoop({
      model,
      maxTokens: envelope.maxTokens,
      timeoutMs: envelope.timeoutMs,
      temperature: envelope.temperature,
      messages: [
        { role: "system", content: systemContent },
        { role: "user", content: userContent },
      ],
      ctx: agentCtx,
      abortSignal: ctx?.abortSignal,
    });
    if (loop.aborted) {
      return { ok: false, error: "已停止", aborted: true };
    }
    if (loop.error && !loop.text.trim()) {
      return { ok: false, error: `写稿模型调用失败：${loop.error}` };
    }
    if (!hasSource && loop.toolsUsed.length === 0) {
      return {
        ok: false,
        error:
          "没有可读材料。子会话不会猜文件内容：请传入 excerpt，或 path/materials 指向已存在的 .docx/.pdf/.txt，或钉选源文件。",
      };
    }
    let text = loop.text;
    let grounding = loop.grounding;
    const toolsUsed = loop.toolsUsed;
    const steps = [...loop.steps];
    let parsed = parseDraftWorkerModelText(text);
    if (parsed && needsDraftLightVerify(parsed, `${loaded.text}\n${grounding}`)) {
      try {
        const fix = await callModelWithRetry(
          {
            ...model,
            maxTokens: envelope.maxTokens,
            timeoutMs: envelope.timeoutMs,
            temperature: envelope.temperature,
            maxRetries: 0,
          },
          [
            { role: "system", content: systemContent },
            { role: "user", content: userContent },
            { role: "assistant", content: text },
            {
              role: "user",
              content:
                "上一稿未通过轻验收（正文过短或出处未落在材料/工具返回里）。请重写：出处必须可在材料中检索到；材料没有的写进缺口。只输出 JSON 或【正文】【出处】【缺口】。",
            },
          ],
          [],
          { signal: ctx?.abortSignal },
        );
        const fixedText = extractAssistantText(fix).text.trim();
        const fixedParsed = parseDraftWorkerModelText(fixedText);
        if (fixedParsed) {
          text = fixedText;
          parsed = fixedParsed;
          steps.push({ tool: "light_verify_resample", ok: true });
        }
      } catch (err) {
        if (err instanceof ModelCallUserAbortError || ctx?.abortSignal?.aborted) {
          return { ok: false, error: "已停止", aborted: true };
        }
        steps.push({ tool: "light_verify_resample", ok: false });
      }
    }
    if (!parsed) {
      return {
        ok: false,
        error: "写稿模型未返回可用正文。请父会话自行起草该节或重试。",
      };
    }
    return successResult(checked.brief, section, parsed, loaded, grounding, toolsUsed, steps);
  }

  const attempts = modelAttemptBudget();
  let lastText = "";
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await callModelWithRetry(
        {
          ...model,
          maxTokens: envelope.maxTokens,
          timeoutMs: envelope.timeoutMs,
          temperature: envelope.temperature,
          maxRetries: 0,
        },
        [
          { role: "system", content: systemContent },
          { role: "user", content: userContent },
        ],
        [],
        { signal: ctx?.abortSignal },
      );
      const view = extractAssistantText(response);
      lastText = view.text.trim();
      const parsed = parseDraftWorkerModelText(lastText);
      if (
        shouldResampleSidecarJson({
          parsed: parsed != null,
          truncated: assistantOutputLooksTruncated(view),
          attempt,
          attempts,
        })
      ) {
        await waitModelRetry(attempt);
        continue;
      }
      if (!parsed) {
        return {
          ok: false,
          error: "写稿模型未返回可用正文。请父会话自行起草该节或重试。",
        };
      }
      return successResult(checked.brief, section, parsed, loaded);
    } catch (err) {
      if (err instanceof ModelCallUserAbortError || ctx?.abortSignal?.aborted) {
        return { ok: false, error: "已停止", aborted: true };
      }
      if (
        attempt + 1 < attempts &&
        shouldRetryTransportFailure(err, { signal: ctx?.abortSignal })
      ) {
        await waitModelRetry(attempt);
        continue;
      }
      const message = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        error: `写稿模型调用失败：${message}`,
      };
    }
  }

  const lastParsed = parseDraftWorkerModelText(lastText);
  if (lastParsed) {
    return successResult(checked.brief, section, lastParsed, loaded);
  }
  return {
    ok: false,
    error: "写稿模型未返回可用正文。请父会话自行起草该节或重试。",
  };
}

function needsDraftLightVerify(parsed: DraftWorkerModelPayload, groundingCorpus: string): boolean {
  if (parsed.draft.replace(/\s+/g, "").length < MIN_DRAFT_CHARS) {
    return true;
  }
  if (parsed.citations.length === 0) {
    return false;
  }
  const grounded = groundDraftCitations(parsed.citations, groundingCorpus);
  return grounded.dropped.length > 0;
}

function successResult(
  brief: string,
  section: string,
  parsed: DraftWorkerModelPayload,
  loaded: { text: string; sources: string[] },
  extraGrounding = "",
  toolsUsed: string[] = [],
  steps: Array<{ tool: string; ok: boolean }> = [],
): DraftWorkerOutput {
  const grounded = groundDraftCitations(parsed.citations, `${loaded.text}\n${extraGrounding}`);
  const gaps = [...parsed.gaps];
  for (const dropped of grounded.dropped) {
    gaps.push(`出处未在材料中出现：${dropped}`);
  }
  return {
    ok: true,
    data: {
      role: "draft-worker",
      instructions: DRAFT_WORKER_DEVELOPER_INSTRUCTIONS,
      brief,
      section,
      draft: parsed.draft,
      citations: grounded.citations,
      gaps,
      sources: loaded.sources,
      toolsUsed,
      steps,
    },
  };
}
