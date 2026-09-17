/**
 * Read-only folder explorer. Parent writes a self-contained brief; this worker
 * does not see chat history. When chatModel is available, runs a bounded
 * readonly sidecar loop (not nested runTurn). Nested calls from draft_worker
 * stay deterministic to avoid recursive model loops.
 */

import fs from "node:fs";
import { namedBracketFolders } from "../intent/utterance-kind.js";
import { applyEnvelopeToAgentModelDefaults } from "../models/capability-envelope.js";
import { resolveLawyerLocalFile } from "../runtime/lawyer-local-file.js";
import {
  directoryListingToolData,
  resolveAndListDirectory,
  type ListDirContext,
  type ListDirEntry,
} from "../runtime/list-dir.js";
import { buildReadonlyToolRegistry, runReadonlyWorkerLoop } from "./readonly-worker-loop.js";
import { analyzeDocument } from "./tools/legal/file-tools.js";
import { readDocxText, readPdfText } from "./tools/legal/ingest-helpers.js";
import { listDirTool } from "./tools/legal/list-dir-tool.js";
import { readProjectFile, searchCaseLaw, searchStatute } from "./tools/legal/search-tools.js";
import type { AgentContext, AgentModelConfig, AgentTool } from "./types.js";
import { validateWorkerBrief } from "./worker-brief.js";

export const EXPLORE_FOLDER_TOOL_NAME = "explore_folder";

export const FOLDER_EXPLORER_DEVELOPER_INSTRUCTIONS = [
  "只读探查工：根据任务书看清目录、找出相关文件、摘录要点。",
  "禁止改稿，禁止 apply_surgical_edits / render_tracked_draft / draft_document / write_document。",
  "材料不够时先用只读工具：list_dir / analyze_document / read_project_file / search_statute / search_case_law。",
  "回报：目录树、候选文件、摘录。不要声称已完成律师的交件。",
].join("");

export const EXPLORE_FOLDER_READONLY_TOOL_NAMES = [
  "analyze_document",
  "list_dir",
  "read_project_file",
  "search_case_law",
  "search_statute",
] as const;

const PEEK_MAX_FILES = 4;
const PEEK_MAX_CHARS = 2_000;
const LETTER_NAME_RE = /函|催告|催款|通知函|回函/;
const CONTRACT_NAME_RE = /合同|协议|mou|nda/i;
const READABLE_RE = /\.(docx?|pdf|txt|md|csv)$/i;

export type ExploreFolderInput = {
  goal: string;
  notGoal?: string;
  path?: string;
  materials?: string;
};

export type ExploreFolderContext = ListDirContext &
  Partial<
    Pick<
      AgentContext,
      | "chatModel"
      | "abortSignal"
      | "inReadonlyWorkerLoop"
      | "actorId"
      | "matterId"
      | "hostMounts"
      | "hostGrants"
      | "hostAccessFile"
    >
  >;

function scoreCandidate(entry: ListDirEntry, notGoal: string, goal: string): number {
  if (entry.kind !== "file") {
    return 0;
  }
  const rejectContract = /合同审查|合同审核|审核合同|审阅痕迹/.test(notGoal);
  let score = 0;
  if (LETTER_NAME_RE.test(entry.name)) {
    score += 50;
  }
  for (const token of goalTokens(goal)) {
    if (token.length >= 2 && entry.name.includes(token)) {
      score += 18;
    }
  }
  if (CONTRACT_NAME_RE.test(entry.name)) {
    score += rejectContract ? 2 : 28;
  }
  if (READABLE_RE.test(entry.name)) {
    score += 6;
  }
  return score;
}

function goalTokens(goal: string): string[] {
  return goal
    .split(/[\s，,。；;：:、/]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2 && !/^(根据|文件夹|目录|是否|有误|核对我|帮我)$/.test(t));
}

export function rankExploreCandidates(
  entries: ListDirEntry[],
  notGoal = "",
  goal = "",
): ListDirEntry[] {
  const files = entries.filter((e) => e.kind === "file");
  const scored = files
    .map((entry) => ({ entry, score: scoreCandidate(entry, notGoal, goal) }))
    .toSorted((a, b) => b.score - a.score);
  const preferred = scored.filter((row) => row.score >= 6).map((row) => row.entry);
  if (preferred.length > 0) {
    return preferred.slice(0, PEEK_MAX_FILES);
  }
  return files.filter((e) => READABLE_RE.test(e.name)).slice(0, PEEK_MAX_FILES);
}

async function peekAbs(abs: string, rel: string): Promise<string> {
  try {
    if (/\.docx$/i.test(rel) || /\.docx$/i.test(abs)) {
      return (await readDocxText(abs)).slice(0, PEEK_MAX_CHARS);
    }
    if (/\.pdf$/i.test(rel) || /\.pdf$/i.test(abs)) {
      return (await readPdfText(abs)).slice(0, PEEK_MAX_CHARS);
    }
    if (/\.(txt|md|csv)$/i.test(rel) || /\.(txt|md|csv)$/i.test(abs)) {
      return fs.readFileSync(abs, "utf8").slice(0, PEEK_MAX_CHARS);
    }
  } catch {
    return "";
  }
  return "";
}

function cleanClaimedPath(raw: string): string {
  return raw
    .trim()
    .replace(/【|】/g, "")
    .replace(/：?\s*先\s*(explore_folder|list_dir).*$/i, "")
    .trim();
}

function inferPath(goal: string, materials: string, claimed: string): string {
  const cleaned = cleanClaimedPath(claimed);
  if (cleaned) {
    return cleaned;
  }
  const blob = `${goal} ${materials}`;
  const named = namedBracketFolders(blob)[0];
  if (named) {
    return named;
  }
  const folder = /([^\s【】]{2,40})文件夹/.exec(blob);
  const folderName = folder?.[1]?.trim() ?? "";
  if (folderName && !/^(根据|该|本|此|上述|相关)$/.test(folderName)) {
    return folderName;
  }
  return "";
}

type ExploreModelPayload = {
  candidates: string[];
  peeks: Array<{ path: string; excerpt: string }>;
  summary: string;
};

function stripMarkdownFence(raw: string): string {
  return raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

export function parseExploreModelText(raw: string): ExploreModelPayload | null {
  const text = stripMarkdownFence(raw).trim();
  if (!text) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const rec = parsed as Record<string, unknown>;
      const candidates = Array.isArray(rec.candidates)
        ? rec.candidates.filter((x): x is string => typeof x === "string" && x.trim().length > 0)
        : [];
      const peeks = Array.isArray(rec.peeks)
        ? rec.peeks
            .map((row) => {
              if (!row || typeof row !== "object") {
                return null;
              }
              const path =
                typeof (row as { path?: unknown }).path === "string"
                  ? (row as { path: string }).path.trim()
                  : "";
              const excerpt =
                typeof (row as { excerpt?: unknown }).excerpt === "string"
                  ? (row as { excerpt: string }).excerpt.trim()
                  : "";
              return path && excerpt ? { path, excerpt: excerpt.slice(0, PEEK_MAX_CHARS) } : null;
            })
            .filter((row): row is { path: string; excerpt: string } => Boolean(row))
        : [];
      const summary = typeof rec.summary === "string" ? rec.summary.trim() : "";
      if (candidates.length > 0 || peeks.length > 0 || summary) {
        return { candidates, peeks, summary };
      }
    }
  } catch {
    /* fall through to bracket parse */
  }
  const candidatesBlock = /【候选】\s*([\s\S]*?)(?=【摘录】|【摘要】|$)/.exec(text)?.[1] ?? "";
  const peekBlock = /【摘录】\s*([\s\S]*?)(?=【摘要】|$)/.exec(text)?.[1] ?? "";
  const summary = (/【摘要】\s*([\s\S]*)$/.exec(text)?.[1] ?? "").trim();
  const candidates = candidatesBlock
    .split(/\n+/)
    .map((line) => line.replace(/^[-*\d.、]+\s*/, "").trim())
    .filter(Boolean)
    .slice(0, 12);
  const peeks: Array<{ path: string; excerpt: string }> = [];
  for (const chunk of peekBlock.split(/\n{2,}/)) {
    const lines = chunk
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    if (lines.length < 2) {
      continue;
    }
    peeks.push({ path: lines[0], excerpt: lines.slice(1).join("\n").slice(0, PEEK_MAX_CHARS) });
  }
  if (candidates.length === 0 && peeks.length === 0 && !summary) {
    return null;
  }
  return { candidates, peeks, summary };
}

let cachedExploreRegistry: ReturnType<typeof buildReadonlyToolRegistry> | undefined;

function exploreReadonlyRegistry() {
  if (!cachedExploreRegistry) {
    cachedExploreRegistry = buildReadonlyToolRegistry([
      analyzeDocument,
      listDirTool,
      readProjectFile,
      searchCaseLaw,
      searchStatute,
    ] satisfies AgentTool[]);
  }
  return cachedExploreRegistry;
}

function resolveExploreModel(ctx: ExploreFolderContext | undefined): AgentModelConfig | undefined {
  const model = ctx?.chatModel;
  if (!model?.apiKey?.trim() || !model.baseUrl?.trim() || !model.model?.trim()) {
    return undefined;
  }
  return model;
}

function asExploreAgentContext(ctx: ExploreFolderContext): AgentContext {
  return {
    workspaceDir: ctx.workspaceDir,
    sessionId: ctx.sessionId || "explore-folder",
    actorId: ctx.actorId || "explore-folder",
    matterId: ctx.matterId,
    projectDir: ctx.projectDir,
    contextPins: ctx.contextPins,
    chatModel: ctx.chatModel,
    abortSignal: ctx.abortSignal,
    hostMounts: ctx.hostMounts,
    hostGrants: ctx.hostGrants,
    hostAccessFile: ctx.hostAccessFile,
    permissionMode: "readonly",
    inReadonlyWorkerLoop: true,
  };
}

async function bootstrapPeeks(
  ctx: ExploreFolderContext,
  candidates: ListDirEntry[],
): Promise<Array<{ path: string; excerpt: string }>> {
  const peeks: Array<{ path: string; excerpt: string }> = [];
  for (const entry of candidates) {
    const found = resolveLawyerLocalFile({
      workspaceDir: ctx.workspaceDir,
      projectDir: ctx.projectDir,
      raw: entry.path,
      pins: ctx.contextPins,
    });
    if (!found) {
      continue;
    }
    const excerpt = await peekAbs(found.abs, entry.path);
    if (excerpt.trim()) {
      peeks.push({ path: entry.path, excerpt: excerpt.trim() });
    }
  }
  return peeks;
}

function mergeExplorePayload(
  bootstrap: { candidates: string[]; peeks: Array<{ path: string; excerpt: string }> },
  model: ExploreModelPayload | null,
): { candidates: string[]; peeks: Array<{ path: string; excerpt: string }>; summary: string } {
  const candidates =
    model && model.candidates.length > 0 ? model.candidates.slice(0, 12) : bootstrap.candidates;
  const peeks =
    model && model.peeks.length > 0 ? model.peeks.slice(0, PEEK_MAX_FILES) : bootstrap.peeks;
  return {
    candidates,
    peeks,
    summary: model?.summary?.trim() || "",
  };
}

export async function runFolderExplorer(
  ctx: ExploreFolderContext,
  input: ExploreFolderInput,
): Promise<
  { ok: true; data: Record<string, unknown> } | { ok: false; error: string; aborted?: boolean }
> {
  const checked = validateWorkerBrief({
    goal: input.goal,
    notGoal: input.notGoal,
    materials: input.materials ?? input.path,
  });
  if (!checked.ok) {
    return checked;
  }
  const path = inferPath(input.goal, input.materials ?? "", input.path ?? "");
  const hasDirPin = (ctx.contextPins ?? []).some(
    (pin) => pin.pinKind === "file" && pin.kind === "directory",
  );
  if (!path && !hasDirPin) {
    return {
      ok: false,
      error: "请提供 path 或【文件夹名】。未指定目录时不会探查整个工作区。",
    };
  }
  const listing = resolveAndListDirectory(ctx, path, { recursive: true });
  if (!listing.ok) {
    return listing;
  }
  const ranked = rankExploreCandidates(listing.entries, input.notGoal ?? "", input.goal);
  const bootstrapPeeksList = await bootstrapPeeks(ctx, ranked);
  const bootstrap = {
    candidates: ranked.map((e) => e.path),
    peeks: bootstrapPeeksList,
  };

  const model = resolveExploreModel(ctx);
  const canRunSidecar = Boolean(model && !ctx.inReadonlyWorkerLoop);

  if (!canRunSidecar || !model) {
    return {
      ok: true,
      data: {
        role: "folder-explorer",
        instructions: FOLDER_EXPLORER_DEVELOPER_INSTRUCTIONS,
        brief: checked.brief,
        listing: directoryListingToolData(listing),
        candidates: bootstrap.candidates,
        peeks: bootstrap.peeks,
        toolsUsed: [] as string[],
        steps: [] as Array<{ tool: string; ok: boolean }>,
        hint: "以上是只读探查结果。未读完相关文件前不要改稿。",
      },
    };
  }

  const envelope = applyEnvelopeToAgentModelDefaults({
    contextTokens: model.contextTokens,
    temperature: model.temperature,
    taskKind: "plan",
  });
  const bootstrapBlock = [
    "【bootstrap 候选】",
    ...bootstrap.candidates.map((p) => `- ${p}`),
    "",
    "【bootstrap 摘录】",
    ...bootstrap.peeks.map((p) => `${p.path}\n${p.excerpt}`),
  ].join("\n");

  const loop = await runReadonlyWorkerLoop({
    model,
    maxTokens: envelope.maxTokens,
    timeoutMs: envelope.timeoutMs,
    temperature: envelope.temperature,
    messages: [
      {
        role: "system",
        content: `${FOLDER_EXPLORER_DEVELOPER_INSTRUCTIONS}优先输出 JSON：{ "candidates": ["相对路径"], "peeks": [{"path":"...","excerpt":"..."}], "summary":"一句摘要" }；也可用【候选】【摘录】【摘要】。`,
      },
      {
        role: "user",
        content: [
          "请按任务书探查目录。bootstrap 只是启发，可用只读工具补读后再定候选与摘录。",
          checked.brief,
          `目录：${path || "(钉选目录)"}`,
          "",
          bootstrapBlock,
        ].join("\n"),
      },
    ],
    ctx: asExploreAgentContext(ctx),
    allowlist: EXPLORE_FOLDER_READONLY_TOOL_NAMES,
    registry: exploreReadonlyRegistry(),
    roleLabel: "探查工",
    closePrompt:
      "只读工具轮次已用尽。请立刻输出候选与摘录（JSON 或【候选】【摘录】【摘要】）。不要再调用工具。",
    abortSignal: ctx.abortSignal,
  });

  if (loop.aborted) {
    return { ok: false, error: "已停止", aborted: true };
  }
  if (loop.error && !loop.text.trim()) {
    return { ok: false, error: `探查模型调用失败：${loop.error}` };
  }

  const parsed = parseExploreModelText(loop.text);
  const merged = mergeExplorePayload(bootstrap, parsed);
  if (merged.candidates.length === 0 && merged.peeks.length === 0 && !merged.summary) {
    // Model returned nothing useful — still deliver bootstrap (fail open on explore).
    return {
      ok: true,
      data: {
        role: "folder-explorer",
        instructions: FOLDER_EXPLORER_DEVELOPER_INSTRUCTIONS,
        brief: checked.brief,
        listing: directoryListingToolData(listing),
        candidates: bootstrap.candidates,
        peeks: bootstrap.peeks,
        toolsUsed: loop.toolsUsed,
        steps: loop.steps,
        hint: "模型未补充候选；已回退 bootstrap 摘录。未读完相关文件前不要改稿。",
      },
    };
  }

  return {
    ok: true,
    data: {
      role: "folder-explorer",
      instructions: FOLDER_EXPLORER_DEVELOPER_INSTRUCTIONS,
      brief: checked.brief,
      listing: directoryListingToolData(listing),
      candidates: merged.candidates,
      peeks: merged.peeks,
      summary: merged.summary || undefined,
      toolsUsed: loop.toolsUsed,
      steps: loop.steps,
      hint: "以上是只读探查结果。未读完相关文件前不要改稿。",
    },
  };
}
