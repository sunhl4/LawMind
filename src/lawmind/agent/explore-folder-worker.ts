/**
 * Read-only folder explorer. Parent writes a self-contained brief; this worker
 * does not see chat history. No nested model loop (cassettes stay on the parent).
 */

import fs from "node:fs";
import { namedBracketFolders } from "../intent/utterance-kind.js";
import { resolveLawyerLocalFile } from "../runtime/lawyer-local-file.js";
import {
  directoryListingToolData,
  resolveAndListDirectory,
  type ListDirContext,
  type ListDirEntry,
} from "../runtime/list-dir.js";
import { readDocxText, readPdfText } from "./tools/legal/ingest-helpers.js";
import { validateWorkerBrief } from "./worker-brief.js";

export const EXPLORE_FOLDER_TOOL_NAME = "explore_folder";

export const FOLDER_EXPLORER_DEVELOPER_INSTRUCTIONS = [
  "只读探查工：根据任务书看清目录、找出相关文件、摘录要点。",
  "禁止改稿，禁止 apply_surgical_edits / render_tracked_draft / draft_document / write_document。",
  "回报：目录树、候选文件、摘录。不要声称已完成律师的交件。",
].join("");

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

export async function runFolderExplorer(
  ctx: ListDirContext,
  input: ExploreFolderInput,
): Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; error: string }> {
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
  const candidates = rankExploreCandidates(listing.entries, input.notGoal ?? "", input.goal);
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
  return {
    ok: true,
    data: {
      role: "folder-explorer",
      instructions: FOLDER_EXPLORER_DEVELOPER_INSTRUCTIONS,
      brief: checked.brief,
      listing: directoryListingToolData(listing),
      candidates: candidates.map((e) => e.path),
      peeks,
      hint: "以上是只读探查结果。未读完相关文件前不要改稿。",
    },
  };
}
