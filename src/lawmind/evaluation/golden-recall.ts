/**
 * Load promoted golden examples for drafting / agent prompt injection.
 *
 * Scoring (P1-1): deliverableType boost + title/heading hits + body excerpt weight.
 */

import fs from "node:fs";
import path from "node:path";
import type { ArtifactDraft } from "../types.js";
import type { GoldenExampleEntry } from "./golden.js";

export type GoldenDraftHint = {
  taskId: string;
  title: string;
  deliverableType?: string;
  templateId?: string;
  sectionHeadings: string[];
  excerpt: string;
  /** Internal score when loaded (optional for callers). */
  score?: number;
};

function goldenDir(workspaceDir: string): string {
  return path.join(workspaceDir, "golden");
}

function readGoldenEntry(workspaceDir: string, taskId: string): GoldenExampleEntry | undefined {
  const p = path.join(goldenDir(workspaceDir), `${taskId}.golden.json`);
  try {
    const raw = fs.readFileSync(p, "utf8");
    return JSON.parse(raw) as GoldenExampleEntry;
  } catch {
    return undefined;
  }
}

function listJournalTaskIds(workspaceDir: string, limit = 24): string[] {
  const journal = path.join(goldenDir(workspaceDir), "golden.jsonl");
  try {
    const lines = fs.readFileSync(journal, "utf8").split("\n").filter(Boolean);
    const ids: string[] = [];
    for (let i = lines.length - 1; i >= 0 && ids.length < limit; i--) {
      try {
        const row = JSON.parse(lines[i]) as { taskId?: string };
        if (typeof row.taskId === "string" && row.taskId.trim()) {
          ids.push(row.taskId.trim());
        }
      } catch {
        /* skip */
      }
    }
    return [...new Set(ids)];
  } catch {
    return [];
  }
}

function draftExcerpt(draft: ArtifactDraft, max = 900): string {
  const parts: string[] = [];
  for (const sec of draft.sections ?? []) {
    const h = sec.heading?.trim();
    const b = sec.body?.trim() ?? "";
    if (h) {
      parts.push(`## ${h}`);
    }
    if (b) {
      parts.push(b.slice(0, 280));
    }
    if (parts.join("\n").length >= max) {
      break;
    }
  }
  return parts.join("\n").slice(0, max);
}

function queryTokens(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length >= 2)
    .slice(0, 24);
}

/**
 * Weighted golden score. Body matches outweigh title-only noise.
 */
export function scoreGoldenAgainstQuery(
  entry: GoldenExampleEntry,
  query: string,
  deliverableType?: string,
): number {
  let score = 0;
  const tokens = queryTokens(query);
  const dt = entry.draft.deliverableType ?? "";
  if (deliverableType && dt && deliverableType === dt) {
    score += 4;
  } else if (deliverableType && dt && deliverableType !== dt) {
    score -= 1;
  }

  const titleHay = `${entry.draft.title}\n${entry.draft.templateId ?? ""}\n${dt}`.toLowerCase();
  const headingHay = (entry.draft.sections ?? [])
    .map((s) => s.heading ?? "")
    .join(" ")
    .toLowerCase();
  // 正文匹配必须是子串匹配：new Set(string) 只会得到字符集，对长度 ≥2 的 token 恒为 false。
  // oxlint-disable-next-line prefer-set-has -- bodyText 是字符串做子串匹配；Set 化正是被修掉的 bug。
  const bodyText = (entry.draft.sections ?? [])
    .map((s) => s.body ?? "")
    .join("\n")
    .toLowerCase()
    .slice(0, 4000);

  for (const tok of tokens) {
    if (bodyText.includes(tok)) {
      score += 2;
    } else if (headingHay.includes(tok)) {
      score += 1.5;
    } else if (titleHay.includes(tok)) {
      score += 1;
    }
  }
  return score;
}

/** @deprecated alias */
export function scoreAgainstQuery(
  entry: GoldenExampleEntry,
  query: string,
  deliverableType?: string,
): number {
  return scoreGoldenAgainstQuery(entry, query, deliverableType);
}

/**
 * Pick recent golden drafts relevant to the current instruction / deliverable type.
 */
export function loadGoldenExamplesForDrafting(opts: {
  workspaceDir: string;
  instruction: string;
  deliverableType?: string;
  limit?: number;
}): GoldenDraftHint[] {
  const ids = listJournalTaskIds(opts.workspaceDir, 30);
  const scored: Array<{ score: number; hint: GoldenDraftHint }> = [];
  for (const taskId of ids) {
    const entry = readGoldenEntry(opts.workspaceDir, taskId);
    if (!entry?.draft) {
      continue;
    }
    const score = scoreGoldenAgainstQuery(entry, opts.instruction, opts.deliverableType);
    if (score <= 0 && !opts.deliverableType) {
      continue;
    }
    if (
      score <= 0 &&
      opts.deliverableType &&
      entry.draft.deliverableType !== opts.deliverableType
    ) {
      continue;
    }
    scored.push({
      score: score || 0.5,
      hint: {
        taskId,
        title: entry.draft.title || taskId,
        deliverableType: entry.draft.deliverableType,
        templateId: entry.draft.templateId,
        sectionHeadings: (entry.draft.sections ?? [])
          .map((s) => s.heading?.trim())
          .filter((h): h is string => Boolean(h)),
        excerpt: draftExcerpt(entry.draft),
        score: score || 0.5,
      },
    });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, opts.limit ?? 2).map((s) => s.hint);
}

export function formatGoldenExamplesPromptBlock(hints: GoldenDraftHint[]): string | undefined {
  if (hints.length === 0) {
    return undefined;
  }
  const blocks: string[] = [
    "## 质量范例（本所黄金样例）",
    "以下为律师标记的优质交付结构参考。对齐章节与表述习惯，勿照抄事实。",
  ];
  for (const h of hints) {
    const heads =
      h.sectionHeadings.length > 0 ? `章节：${h.sectionHeadings.slice(0, 8).join("、")}` : "";
    blocks.push(
      `### ${h.title}（task ${h.taskId}${h.deliverableType ? ` · ${h.deliverableType}` : ""}）\n${heads}\n${h.excerpt}`,
    );
  }
  return blocks.join("\n\n");
}
