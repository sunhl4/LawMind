/**
 * Source annotations (OpenContracts-style): comments anchored to research sources.
 */

import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, appendFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { suggestMemoryAdoption } from "../memory/adoption-service.js";

export const SOURCE_ANNOTATION_KINDS = ["comment", "highlight", "issue"] as const;
export type SourceAnnotationKind = (typeof SOURCE_ANNOTATION_KINDS)[number];

const rangeSchema = z.object({
  start: z.number().int().nonnegative(),
  end: z.number().int().nonnegative(),
});

const annotationSchema = z.object({
  id: z.string(),
  sourceId: z.string(),
  taskId: z.string().optional(),
  matterId: z.string().optional(),
  range: rangeSchema.optional(),
  kind: z.enum(SOURCE_ANNOTATION_KINDS),
  comment: z.string(),
  createdBy: z.string().default("lawyer"),
  linkedDraftId: z.string().optional(),
  createdAt: z.string(),
});

export type SourceAnnotation = z.infer<typeof annotationSchema>;

export type CreateSourceAnnotationInput = {
  sourceId: string;
  taskId?: string;
  matterId?: string;
  range?: { start: number; end: number };
  kind?: SourceAnnotationKind;
  comment: string;
  createdBy?: string;
  linkedDraftId?: string;
  /** Mirror into memory-adoption pending queue */
  createLearning?: boolean;
};

function annotationsFile(workspaceDir: string): string {
  return path.join(workspaceDir, "source-annotations", "annotations.jsonl");
}

function readAll(workspaceDir: string): SourceAnnotation[] {
  const file = annotationsFile(workspaceDir);
  if (!existsSync(file)) {
    return [];
  }
  const raw = readFileSync(file, "utf8");
  const out: SourceAnnotation[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    try {
      const parsed = annotationSchema.safeParse(JSON.parse(trimmed));
      if (parsed.success) {
        out.push(parsed.data);
      }
    } catch {
      // skip
    }
  }
  return out;
}

export function listSourceAnnotations(
  workspaceDir: string,
  filter: { sourceId: string; taskId?: string; matterId?: string },
): SourceAnnotation[] {
  const sourceId = filter.sourceId.trim();
  const taskId = filter.taskId?.trim();
  const matterId = filter.matterId?.trim();
  return readAll(workspaceDir).filter((row) => {
    if (row.sourceId !== sourceId) {
      return false;
    }
    if (taskId && row.taskId && row.taskId !== taskId) {
      return false;
    }
    if (matterId && row.matterId && row.matterId !== matterId) {
      return false;
    }
    return true;
  });
}

export async function createSourceAnnotation(
  workspaceDir: string,
  auditDir: string,
  input: CreateSourceAnnotationInput,
): Promise<SourceAnnotation> {
  const file = annotationsFile(workspaceDir);
  mkdirSync(path.dirname(file), { recursive: true });
  const row: SourceAnnotation = {
    id: randomUUID(),
    sourceId: input.sourceId.trim(),
    taskId: input.taskId?.trim() || undefined,
    matterId: input.matterId?.trim() || undefined,
    range: input.range,
    kind: input.kind ?? "comment",
    comment: input.comment.trim(),
    createdBy: input.createdBy?.trim() || "lawyer",
    linkedDraftId: input.linkedDraftId?.trim() || undefined,
    createdAt: new Date().toISOString(),
  };
  const parsed = annotationSchema.parse(row);
  appendFileSync(file, `${JSON.stringify(parsed)}\n`, "utf8");

  if (input.createLearning && parsed.comment.length > 0) {
    await suggestMemoryAdoption(workspaceDir, auditDir, {
      scope: "matter",
      kind: "source.annotation",
      targetId: parsed.matterId ?? parsed.taskId,
      payload: `[来源 ${parsed.sourceId}] ${parsed.comment}`,
      sourceTaskId: parsed.taskId ?? parsed.linkedDraftId,
      origin: "lawyer",
    });
  }

  return parsed;
}
