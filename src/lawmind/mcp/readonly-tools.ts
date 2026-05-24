/**
 * Read-only MCP tool implementations (shared by scripts/lawmind/mcp-readonly-server.ts).
 */

import fs from "node:fs";
import path from "node:path";
import { listMatterIds } from "../cases/index.js";
import { buildDraftAcceptancePackMarkdown } from "../delivery/draft-acceptance-pack.js";
import { readDraft } from "../drafts/index.js";
import { searchWorkspaceIndex } from "../indexing/index.js";
import { buildMatterReviewMatrix } from "../matter/review-matrix.js";
import { listSourceAnnotations } from "../sources/source-annotation.js";
import { listTaskRecords } from "../tasks/index.js";

export type McpToolResult = { ok: boolean; text?: string; error?: string; data?: unknown };

function resolveRoot(workspaceDir: string): string {
  return path.resolve(workspaceDir);
}

export async function mcpListMatters(workspaceDir: string): Promise<McpToolResult> {
  const ids = await listMatterIds(resolveRoot(workspaceDir));
  return { ok: true, data: { matters: ids } };
}

export function mcpListDrafts(workspaceDir: string): McpToolResult {
  const root = resolveRoot(workspaceDir);
  const draftsDir = path.join(root, "drafts");
  let files: string[] = [];
  try {
    files = fs
      .readdirSync(draftsDir)
      .filter((n) => n.endsWith(".json") && !n.includes(".research"));
  } catch {
    return { ok: true, data: { drafts: [] } };
  }
  const tasks = new Map(listTaskRecords(root).map((t) => [t.taskId, t]));
  const drafts: Array<{ taskId: string; title: string; matterId?: string }> = [];
  for (const file of files) {
    try {
      const raw = fs.readFileSync(path.join(draftsDir, file), "utf8");
      const d = JSON.parse(raw) as { taskId?: string; title?: string };
      const taskId = d.taskId ?? file.replace(/\.json$/, "");
      const tr = tasks.get(taskId);
      drafts.push({
        taskId,
        title: typeof d.title === "string" ? d.title : taskId,
        matterId: tr?.matterId,
      });
    } catch {
      /* skip */
    }
  }
  drafts.sort((a, b) => a.taskId.localeCompare(b.taskId));
  return { ok: true, data: { drafts } };
}

export function mcpGetSourcePreview(
  workspaceDir: string,
  sourceId: string,
  taskId: string,
): McpToolResult {
  const root = resolveRoot(workspaceDir);
  const snap = path.join(root, "drafts", `${taskId}.research.json`);
  if (!fs.existsSync(snap)) {
    return { ok: false, error: "research_snapshot_missing" };
  }
  try {
    const bundle = JSON.parse(fs.readFileSync(snap, "utf8")) as {
      sources?: Array<{ id: string; title?: string; excerpt?: string; citation?: string }>;
    };
    const src = bundle.sources?.find((s) => s.id === sourceId);
    if (!src) {
      return { ok: false, error: "source_not_found" };
    }
    return {
      ok: true,
      data: {
        sourceId,
        taskId,
        title: src.title,
        citation: src.citation,
        excerpt: src.excerpt,
      },
      text: `${src.title ?? sourceId}\n\n${src.excerpt ?? ""}`.trim(),
    };
  } catch {
    return { ok: false, error: "read_failed" };
  }
}

export function mcpListSourceAnnotations(
  workspaceDir: string,
  sourceId: string,
  taskId?: string,
  matterId?: string,
): McpToolResult {
  const items = listSourceAnnotations(resolveRoot(workspaceDir), {
    sourceId,
    taskId,
    matterId,
  });
  return { ok: true, data: { sourceId, taskId, matterId, annotations: items } };
}

export function mcpGetReviewMatrix(workspaceDir: string, matterId: string): McpToolResult {
  const matrix = buildMatterReviewMatrix(resolveRoot(workspaceDir), matterId.trim());
  return { ok: true, data: { matrix } };
}

export function mcpSearchWorkspaceIndex(
  workspaceDir: string,
  query: string,
  matterId?: string,
): McpToolResult {
  const result = searchWorkspaceIndex(resolveRoot(workspaceDir), {
    q: query,
    matterId: matterId?.trim() || undefined,
    limit: 20,
  });
  return { ok: true, data: result };
}

export async function mcpGetDraftAcceptancePack(
  workspaceDir: string,
  taskId: string,
): Promise<McpToolResult> {
  const root = resolveRoot(workspaceDir);
  const draft = readDraft(root, taskId.trim());
  if (!draft) {
    return { ok: false, error: "draft_not_found" };
  }
  try {
    const markdown = await buildDraftAcceptancePackMarkdown(root, draft);
    return { ok: true, data: { taskId: draft.taskId, title: draft.title }, text: markdown };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
