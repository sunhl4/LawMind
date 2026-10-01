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
import { isolationKey, takeIsolationBudget } from "./context-isolation-budget.js";
import {
  DRAFT_WORKER_READONLY_TOOL_NAMES,
  runDraftWorkerReadOnlyLoop,
} from "./draft-worker-loop.js";
import {
  continueFolderExplorer,
  rankExploreCandidates,
  runFolderExplorer,
} from "./explore-folder-worker.js";
import { callModelWithRetry, ModelCallUserAbortError } from "./runtime-model-call.js";
import {
  fitParentAdmission,
  loadSidecarResume,
  newSidecarResumeId,
  PARENT_ADMISSION_EXHAUSTED_CONCLUSION,
  saveSidecarResume,
} from "./sidecar-resume.js";
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

/** Codex reviewer: a finding for one issue, not a new clause. */
export const REVIEW_WORKER_CLOSE_PROMPT =
  "只读工具轮次已用尽。请立刻交回可落改的原句、改后句、待确认。原句必须出现在材料里。材料没有的数字和身份写入待确认，不要编造。不要改原件，不要导出，不要再调用工具。";

export const REVIEW_WORKER_DEVELOPER_INSTRUCTIONS = [
  "审查子工：只交回这一争点可落改的原句、改后句和待确认。",
  "不要起草合同条款或新文书，不要改原件，不要导出或外发。",
  "原句必须来自材料或只读工具返回；材料没有的数字和身份写入待确认，不要编造法条原文。",
  "材料不够时先用只读工具：list_dir / explore_folder / analyze_document / search_statute / search_case_law。",
  "回报：原句、改后句、待确认。不要声称已完成整份审查意见。",
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
  /** Continue this sidecar instead of starting another. */
  resumeId?: string;
  followUp?: string;
  /** Codex agent type. Parent sets this the way Cursor sets subagent_type. */
  role?: "review" | "draft" | "explore";
};

export type DraftWorkerModelPayload = {
  draft: string;
  citations: string[];
  gaps: string[];
  conclusion?: string;
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
    | "deliveryIntent"
    | "sidecarRole"
  >
>;

export function resolveSidecarTaskRole(
  requested: string | undefined,
  fallback?: "review" | "draft",
): "review" | "draft" | "explore" {
  if (requested === "review" || requested === "draft" || requested === "explore") {
    return requested;
  }
  return fallback === "review" ? "review" : "draft";
}
export function draftWorkerSidecarConstraint(
  intent?: import("../intent/delivery-intent.js").DeliveryIntent,
): string {
  if (intent?.artifactShape === "opinion_memo" || intent?.mutateSource === "forbid") {
    return "本轮只交回意见片段。不要改原件、不要导出、不要外发。";
  }
  return "";
}

export type DraftWorkerOutput =
  | {
      ok: true;
      data: {
        role: "draft-worker";
        taskRole?: "review" | "draft" | "explore";
        instructions: string;
        brief: string;
        section: string;
        draft: string;
        conclusion: string;
        /** Set when draft was shortened for the parent context. */
        draftClipped?: boolean;
        /** Present when the sidecar transcript was stored for resume. */
        workerId?: string;
        /** One message for the parent, the way a Cursor subagent returns its result. */
        result: string;
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

function oneLine(raw: unknown): string | undefined {
  if (typeof raw !== "string") {
    return undefined;
  }
  const line = raw.replace(/\s+/g, " ").trim();
  return line ? line.slice(0, 120) : undefined;
}

function firstSentence(draft: string): string {
  const line = draft.replace(/\s+/g, " ").trim();
  const cut = line.split(/[。！？]/)[0] ?? line;
  return cut.slice(0, 120);
}

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
  const conclusion = sectionBetween(text, "【结论】", ["【正文】", "【出处】", "【缺口】"]);
  return { draft, citations: list(cites), gaps: list(gaps), conclusion: oneLine(conclusion) };
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
        conclusion: oneLine(rec.conclusion),
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

function buildDraftUserPrompt(
  input: DraftWorkerInput,
  brief: string,
  source: string,
  review: boolean,
): string {
  const section = (input.section ?? "正文").trim() || "正文";
  const style = (input.style ?? "").trim();
  const ask = review
    ? "请按任务书审查指定争点。draft 写依据说明，不要写新条款。优先输出 JSON；也可用【结论】【正文】【出处】【缺口】。"
    : "请按任务书起草指定章节。优先输出 JSON；长文也可按【正文】【结论】【出处】【缺口】分段。";
  return [
    ask,
    `JSON schema: { "draft": "string", "conclusion": "一句结论", "citations": ["材料出处"], "gaps": ["待补缺口"] }`,
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
    sidecarRole: ctx.sidecarRole,
    emitToolProgress: ctx.emitToolProgress,
  };
}

async function runExploreSubagent(
  input: DraftWorkerInput,
  ctx?: DraftWorkerContext,
): Promise<DraftWorkerOutput> {
  const agentCtx = asWorkerAgentContext(ctx);
  if (!agentCtx) {
    return { ok: false, error: "无法探查。请在本轮对话里提供工作区后再派探查子工。" };
  }
  const section = (input.section ?? "探查").trim() || "探查";
  let transcript: import("./readonly-worker-loop.js").WorkerLoopMessage[] | undefined;
  const explored = await runFolderExplorer(
    {
      ...agentCtx,
      // This call is the explorer sidecar. The flag stays on for tools it calls,
      // so a nested explore_folder does not start a second loop.
      inReadonlyWorkerLoop: false,
      captureSidecarTranscript: (messages) => {
        transcript = messages;
      },
      emitToolProgress: agentCtx.emitToolProgress
        ? (label) => agentCtx.emitToolProgress?.(`${section} · ${label}`)
        : undefined,
    },
    {
      goal: input.goal,
      notGoal: input.notGoal,
      path: input.path,
      materials: input.materials,
    },
  );
  if (!explored.ok) {
    return explored;
  }
  const summary = typeof explored.data.summary === "string" ? explored.data.summary.trim() : "";
  const messages =
    transcript && transcript.length > 0
      ? transcript
      : [{ role: "assistant" as const, content: summary || "已探查目录。" }];
  return exploreParentOutput(
    input.goal,
    section,
    explored.data,
    ctx,
    persistSidecar(ctx, section, "explore", messages),
  );
}

export async function runDraftWorker(
  input: DraftWorkerInput,
  ctx?: DraftWorkerContext,
): Promise<DraftWorkerOutput> {
  if (input.resumeId?.trim()) {
    return resumeDraftWorker(input, ctx);
  }
  const taskRole = resolveSidecarTaskRole(input.role, ctx?.sidecarRole);
  if (taskRole === "explore") {
    return runExploreSubagent(input, ctx);
  }
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
  if (agentCtx?.emitToolProgress) {
    const inner = agentCtx.emitToolProgress;
    agentCtx.emitToolProgress = (label) => {
      inner(section ? `${section} · ${label}` : label);
    };
  }
  const review = taskRole === "review";
  const sidecarConstraint = draftWorkerSidecarConstraint(ctx?.deliveryIntent);
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
  const instructions = review
    ? REVIEW_WORKER_DEVELOPER_INSTRUCTIONS
    : DRAFT_WORKER_DEVELOPER_INSTRUCTIONS;
  const { buildSubagentMemoryPack } = await import("../core/work-style-pack.js");
  const workStyleBlock = buildSubagentMemoryPack({
    subagentRole: review ? "review" : "draft",
    deliveryHint: [input.goal, input.section, input.style].filter(Boolean).join(" "),
  });
  const packSuffix = workStyleBlock ? `\n\n${workStyleBlock}` : "";
  const systemContent = `${instructions}${sidecarConstraint}${packSuffix}\n出处必须来自材料或只读工具返回；材料没有的写进缺口。`;
  const userContent = buildDraftUserPrompt(input, checked.brief, sourceBlock, review);

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
      roleLabel: review ? "审查工" : "写稿工",
      closePrompt: review ? REVIEW_WORKER_CLOSE_PROMPT : undefined,
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
    return successResult(
      checked.brief,
      section,
      parsed,
      loaded,
      grounding,
      toolsUsed,
      steps,
      instructions,
      persistSidecar(
        ctx,
        section,
        review ? "review" : "draft",
        withFinalAssistant(loop.messages, text),
      ),
      isolationKey(ctx.workspaceDir ?? "", ctx.sessionId || "draft-worker"),
      review ? "review" : "draft",
    );
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
      return successResult(checked.brief, section, parsed, loaded, "", [], [], instructions);
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
    return successResult(checked.brief, section, lastParsed, loaded, "", [], [], instructions);
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

function admitParentText(
  text: string,
  sessionKey: string | undefined,
  opts?: { note?: string; exhausted?: string },
): string {
  const raw = text.trim();
  const ask = Math.min(raw.length, 1_600);
  const granted = sessionKey ? takeIsolationBudget(sessionKey, ask) : ask;
  return fitParentAdmission(raw, sessionKey && granted === 0 ? 0 : granted, opts);
}

function withFinalAssistant(
  messages: import("./readonly-worker-loop.js").WorkerLoopMessage[],
  text: string,
): import("./readonly-worker-loop.js").WorkerLoopMessage[] {
  const trimmed = text.trim();
  if (!trimmed) {
    return messages;
  }
  const next = [...messages];
  const last = next.at(-1);
  if (last?.role === "assistant") {
    next[next.length - 1] = { ...last, content: trimmed };
    return next;
  }
  next.push({ role: "assistant", content: trimmed });
  return next;
}

function successResult(
  brief: string,
  section: string,
  parsed: DraftWorkerModelPayload,
  loaded: { text: string; sources: string[] },
  extraGrounding = "",
  toolsUsed: string[] = [],
  steps: Array<{ tool: string; ok: boolean }> = [],
  instructions: string = DRAFT_WORKER_DEVELOPER_INSTRUCTIONS,
  workerId?: string,
  sessionKey?: string,
  taskRole: "review" | "draft" = "draft",
): DraftWorkerOutput {
  const grounded = groundDraftCitations(parsed.citations, `${loaded.text}\n${extraGrounding}`);
  const gaps = [...parsed.gaps];
  for (const dropped of grounded.dropped) {
    gaps.push(`出处未在材料中出现：${dropped}`);
  }
  const headline = parsed.conclusion?.trim() ?? "";
  const body = parsed.draft.trim();
  const combined = headline && !body.includes(headline) ? `${headline}\n${body}` : body;
  const visible = admitParentText(combined, sessionKey);
  const exhausted = visible.includes("并行上下文配额已用完");
  const clipped = visible.length < combined.length || exhausted;
  return {
    ok: true,
    data: {
      role: "draft-worker",
      taskRole,
      instructions,
      brief,
      section,
      draft: visible,
      ...(clipped ? { draftClipped: true } : {}),
      ...(workerId ? { workerId } : {}),
      result: visible,
      citations: grounded.citations,
      conclusion: exhausted
        ? PARENT_ADMISSION_EXHAUSTED_CONCLUSION
        : headline || firstSentence(visible),
      gaps,
      sources: loaded.sources,
      toolsUsed,
      steps,
    },
  };
}

function exploreParentOutput(
  goal: string,
  section: string,
  data: Record<string, unknown>,
  ctx: DraftWorkerContext | undefined,
  workerId?: string,
): DraftWorkerOutput {
  const summary = typeof data.summary === "string" ? data.summary.trim() : "";
  const hint = typeof data.hint === "string" ? data.hint.trim() : "";
  const candidates = Array.isArray(data.candidates)
    ? data.candidates.filter((item): item is string => typeof item === "string").slice(0, 12)
    : [];
  const peeks = Array.isArray(data.peeks) ? data.peeks.slice(0, 2) : [];
  const peekLines = peeks
    .map((peek) => {
      if (!peek || typeof peek !== "object") {
        return "";
      }
      const row = peek as { path?: unknown; excerpt?: unknown };
      const file = typeof row.path === "string" ? row.path.trim() : "";
      const excerpt =
        typeof row.excerpt === "string" ? row.excerpt.replace(/\s+/g, " ").trim() : "";
      if (!file && !excerpt) {
        return "";
      }
      return `${file}${excerpt ? `：${excerpt.slice(0, 400)}` : ""}`;
    })
    .filter(Boolean);
  const composed = [
    summary,
    candidates.length > 0 ? `候选：${candidates.join("、")}` : "",
    peekLines.length > 0 ? `摘录：\n${peekLines.join("\n")}` : "",
    hint,
  ]
    .filter(Boolean)
    .join("\n");
  const sessionKey = isolationKey(ctx?.workspaceDir ?? "", ctx?.sessionId || "draft-worker");
  const text = admitParentText(composed || "已探查目录。", sessionKey, {
    exhausted:
      "本轮并行上下文配额已用完。用 resume_id 读续跑记录里的最后一条答复，更早的步骤可能只留了结尾。不要把没贴上的内容当成没有探查结论。",
    note: "…（续跑记录留有最后一条完整答复，用 resume_id）",
  });
  const exhausted = text.includes("并行上下文配额已用完");
  const toolsUsed = Array.isArray(data.toolsUsed)
    ? data.toolsUsed.filter((item): item is string => typeof item === "string")
    : [];
  return {
    ok: true,
    data: {
      role: "draft-worker",
      taskRole: "explore",
      instructions: "探查子工：只读看清目录，交回候选和摘录。不要改稿。",
      brief: goal,
      section,
      draft: text,
      ...(workerId ? { workerId } : {}),
      conclusion: exhausted
        ? PARENT_ADMISSION_EXHAUSTED_CONCLUSION
        : summary.slice(0, 120) || "已探查目录",
      result: text,
      citations: [],
      gaps: [],
      sources: candidates,
      toolsUsed,
      steps: [],
    },
  };
}

function persistSidecar(
  ctx: DraftWorkerContext | undefined,
  section: string,
  role: "review" | "draft" | "explore",
  messages: import("./readonly-worker-loop.js").WorkerLoopMessage[] | undefined,
): string | undefined {
  const workspaceDir = ctx?.workspaceDir?.trim();
  const sessionId = ctx?.sessionId?.trim();
  if (!workspaceDir || !sessionId || !messages || messages.length === 0) {
    return undefined;
  }
  const id = newSidecarResumeId();
  const saved = saveSidecarResume(workspaceDir, {
    id,
    sessionId,
    section,
    role,
    messages,
    updatedAt: new Date().toISOString(),
  });
  return saved?.id;
}

async function resumeDraftWorker(
  input: DraftWorkerInput,
  ctx?: DraftWorkerContext,
): Promise<DraftWorkerOutput> {
  const workspaceDir = ctx?.workspaceDir?.trim();
  const sessionId = ctx?.sessionId?.trim();
  const resumeId = input.resumeId?.trim() ?? "";
  if (!workspaceDir || !sessionId) {
    return { ok: false, error: "无法续跑。这支子工没有可恢复的会话记录。" };
  }
  const prior = loadSidecarResume(workspaceDir, sessionId, resumeId);
  if (!prior) {
    return { ok: false, error: "没有这支子工可续。请使用上一支返回的 workerId 作为 resume_id。" };
  }
  const follow = (input.followUp ?? input.goal).trim();
  if (prior.role === "explore") {
    return resumeExploreWorker(input, ctx, prior, workspaceDir, follow);
  }
  if (!follow) {
    return { ok: false, error: "续跑要写 follow_up，说明这支还要改什么。" };
  }
  const model = resolveDraftWorkerModel(ctx);
  if (!model) {
    return { ok: false, error: "未配置写稿模型。draft_worker 需要本轮对话模型凭据。" };
  }
  const agentCtx = asWorkerAgentContext(ctx);
  if (!agentCtx) {
    return { ok: false, error: "无法续跑。这支子工没有可恢复的会话记录。" };
  }
  const review = prior.role === "review";
  const section = (input.section ?? prior.section).trim() || prior.section || "正文";
  const envelope = applyEnvelopeToAgentModelDefaults({
    contextTokens: model.contextTokens,
    temperature: model.temperature,
    taskKind: "draft",
  });
  const loop = await runDraftWorkerReadOnlyLoop({
    model,
    maxTokens: envelope.maxTokens,
    timeoutMs: envelope.timeoutMs,
    temperature: envelope.temperature,
    maxToolRounds: 3,
    messages: [...prior.messages, { role: "user", content: `【续跑】${follow}` }],
    ctx: agentCtx,
    abortSignal: ctx?.abortSignal,
    roleLabel: review ? "审查工" : "写稿工",
    closePrompt: review
      ? "请按续跑指示改这一争点的原句、改后句和待确认。原句必须出现在材料里。不要改原件，不要导出，不要再调用工具。"
      : "请按续跑指示改这一节草稿。不要再调用工具。",
  });
  if (loop.aborted) {
    return { ok: false, error: "已停止", aborted: true };
  }
  if (loop.error && !loop.text.trim()) {
    return { ok: false, error: `写稿模型调用失败：${loop.error}` };
  }
  const parsed = parseDraftWorkerModelText(loop.text);
  if (!parsed) {
    return { ok: false, error: "续跑未返回可用正文。请父会话自行修改该节或重试。" };
  }
  const saved = saveSidecarResume(workspaceDir, {
    ...prior,
    section,
    messages: loop.messages.length > 0 ? loop.messages : prior.messages,
    updatedAt: new Date().toISOString(),
  });
  const instructions = review
    ? REVIEW_WORKER_DEVELOPER_INSTRUCTIONS
    : DRAFT_WORKER_DEVELOPER_INSTRUCTIONS;
  return successResult(
    follow,
    section,
    parsed,
    { text: "", sources: [] },
    loop.grounding,
    loop.toolsUsed,
    loop.steps,
    instructions,
    saved?.id ?? prior.id,
    isolationKey(workspaceDir, sessionId),
    review ? "review" : "draft",
  );
}

async function resumeExploreWorker(
  input: DraftWorkerInput,
  ctx: DraftWorkerContext | undefined,
  prior: NonNullable<ReturnType<typeof loadSidecarResume>>,
  workspaceDir: string,
  follow: string,
): Promise<DraftWorkerOutput> {
  if (!follow) {
    return { ok: false, error: "续跑要写 follow_up，说明这支还要改什么。" };
  }
  const agentCtx = asWorkerAgentContext(ctx);
  if (!agentCtx) {
    return { ok: false, error: "无法续跑。这支子工没有可恢复的会话记录。" };
  }
  const section = (input.section ?? prior.section).trim() || prior.section || "探查";
  let transcript: import("./readonly-worker-loop.js").WorkerLoopMessage[] | undefined;
  const explored = await continueFolderExplorer(
    {
      ...agentCtx,
      inReadonlyWorkerLoop: false,
      captureSidecarTranscript: (messages) => {
        transcript = messages;
      },
      emitToolProgress: agentCtx.emitToolProgress
        ? (label) => agentCtx.emitToolProgress?.(`${section} · ${label}`)
        : undefined,
    },
    prior.messages,
    follow,
  );
  if (!explored.ok) {
    return explored;
  }
  const saved = saveSidecarResume(workspaceDir, {
    ...prior,
    section,
    role: "explore",
    messages: transcript && transcript.length > 0 ? transcript : prior.messages,
    updatedAt: new Date().toISOString(),
  });
  return exploreParentOutput(follow, section, explored.data, ctx, saved?.id ?? prior.id);
}
