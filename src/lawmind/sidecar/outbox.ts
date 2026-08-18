/**
 * Word / WPS 回写：把最新草稿的复核摘要写成可粘贴文本。
 * 不改 Word 原文；由侧车任务窗格插入选区或批注。
 */

import fs from "node:fs";
import path from "node:path";
import { describeDraftScaffold, type DraftScaffoldView } from "../deliverables/scaffold-status.js";
import type { ClauseGraph } from "../reasoning/clause-graph.js";
import { DRAFT_CRITIC_PREFIX } from "../reasoning/draft-critic.js";
import type { ArtifactDraft } from "../types.js";
import { findSidecarIngestPathForTask } from "./bindings.js";

export const SIDECAR_OUTBOX_REL = "lawmind/sidecar-outbox.json";

export type SidecarOutboxItem = {
  taskId: string;
  title: string;
  pasteText: string;
  criticNotes: string[];
  scaffoldDense: boolean;
  createdAt: string;
  ackedAt?: string;
  ingestRelativePath?: string;
};

export function sidecarOutboxPath(workspaceDir: string): string {
  return path.join(workspaceDir, ...SIDECAR_OUTBOX_REL.split("/"));
}

export function criticNotesFromDraft(draft: ArtifactDraft): string[] {
  return draft.reviewNotes.filter((note) => note.startsWith(DRAFT_CRITIC_PREFIX));
}

export function buildSidecarPasteText(
  draft: ArtifactDraft,
  graph: ClauseGraph,
  scaffold: DraftScaffoldView = describeDraftScaffold(draft),
): string {
  const critic = criticNotesFromDraft(draft);
  const clauseLines = graph.clauses.slice(0, 12).map((clause) => {
    const extras = [...clause.missing, ...clause.criticNotes].filter(Boolean);
    return extras.length > 0
      ? `- ${clause.heading}：${extras.join("；")}`
      : `- ${clause.heading}：未见规则缺项`;
  });
  return [
    `【LawMind 复核】${draft.title}`,
    scaffold.dense ? "本稿仍是骨架稿，不能当作成稿外发。" : "本稿不是骨架稿。",
    "",
    "复核备注：",
    ...(critic.length > 0 ? critic.map((note) => `- ${note}`) : ["- （无）"]),
    "",
    "条款图：",
    ...(clauseLines.length > 0 ? clauseLines : ["- （无条款）"]),
    "",
    "以上为粘贴用摘要，不会自动改 Word / WPS 原文。",
  ].join("\n");
}

export function persistSidecarOutboxFromDraft(
  workspaceDir: string,
  draft: ArtifactDraft,
  graph: ClauseGraph,
): SidecarOutboxItem {
  const scaffold = describeDraftScaffold(draft);
  const item: SidecarOutboxItem = {
    taskId: draft.taskId,
    title: draft.title,
    pasteText: buildSidecarPasteText(draft, graph, scaffold),
    criticNotes: criticNotesFromDraft(draft),
    scaffoldDense: scaffold.dense,
    createdAt: new Date().toISOString(),
    ingestRelativePath: findSidecarIngestPathForTask(workspaceDir, draft.taskId),
  };
  const file = sidecarOutboxPath(workspaceDir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(item, null, 2)}\n`, "utf8");
  return item;
}

export function readSidecarOutbox(workspaceDir: string): SidecarOutboxItem | undefined {
  try {
    const parsed = JSON.parse(
      fs.readFileSync(sidecarOutboxPath(workspaceDir), "utf8"),
    ) as Partial<SidecarOutboxItem>;
    if (typeof parsed.taskId !== "string" || typeof parsed.pasteText !== "string") {
      return undefined;
    }
    return {
      taskId: parsed.taskId,
      title: typeof parsed.title === "string" ? parsed.title : parsed.taskId,
      pasteText: parsed.pasteText,
      criticNotes: Array.isArray(parsed.criticNotes)
        ? parsed.criticNotes.filter((note): note is string => typeof note === "string")
        : [],
      scaffoldDense: parsed.scaffoldDense === true,
      createdAt: typeof parsed.createdAt === "string" ? parsed.createdAt : "",
      ackedAt: typeof parsed.ackedAt === "string" ? parsed.ackedAt : undefined,
      ingestRelativePath:
        typeof parsed.ingestRelativePath === "string" ? parsed.ingestRelativePath : undefined,
    };
  } catch {
    return undefined;
  }
}

export function acknowledgeSidecarOutbox(workspaceDir: string): SidecarOutboxItem | undefined {
  const current = readSidecarOutbox(workspaceDir);
  if (!current) {
    return undefined;
  }
  const next: SidecarOutboxItem = {
    ...current,
    ackedAt: new Date().toISOString(),
  };
  fs.writeFileSync(sidecarOutboxPath(workspaceDir), `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return next;
}
