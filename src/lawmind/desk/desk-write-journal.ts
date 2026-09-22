/**
 * Journal of chat/workbench desk writes so revert_desk_write can undo one batch.
 */

import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { appendJsonl, matterDir, readJsonl } from "../adapters/matter-storage/io.js";
import type { IntakeBrief } from "./intake-brief.js";
import type { MatterDocket, MatterKind } from "./matter-kind.js";

export const DESK_WRITE_KINDS = [
  "legal_events",
  "intake_brief",
  "matter_profile",
  "create_matter",
  "organize_files",
  "file_ops",
] as const;

export type DeskWriteKind = (typeof DESK_WRITE_KINDS)[number];

/** One applied file op inside an organize_files batch (materials 围栏内). */
export type OrganizeFileOp = {
  from: string;
  to: string;
  reason?: string;
};

/**
 * One applied file op inside a `file_ops` batch：**工作区相对路径**的搬移/复制。
 *
 * 路径基准与 `OrganizeFileOp` 不同——整理计划锁死在本案 `materials/` 之内，
 * 而「归位 / 一般文件操作」是工作区级的（可能跨案，也可能在 notes/ 等其它目录），
 * 所以存工作区相对路径，撤销时按工作区根反向回放。
 *
 * `copied: true` 表示复制而非移动，撤销时删掉复制件（律师改过则不删，见 desk-apply）。
 */
export type WorkspaceFileOp = {
  from: string;
  to: string;
  copied?: boolean;
  /** 复制件的字节数；撤销时对不上就跳过（律师改过的东西不静默删）。 */
  bytes?: number;
  reason?: string;
};

export type MatterProfileSnapshot = {
  title?: string;
  clientId?: string;
  matterKind?: MatterKind;
  docket?: MatterDocket;
};

export type DeskWriteRecord = {
  writeId: string;
  matterId: string;
  kind: DeskWriteKind;
  createdAt: string;
  deadlineIds?: string[];
  previousHearingAt?: string | null;
  previousProfile?: MatterProfileSnapshot;
  previousIntake?: IntakeBrief | null;
  /** organize_files：已执行的移动/重命名（撤销时反向回放）。 */
  organizeOps?: OrganizeFileOp[];
  /** file_ops：工作区级的搬移/复制（工作区相对路径，撤销时反向回放）。 */
  fileOps?: WorkspaceFileOp[];
};

const intakeCandidateSchema = z.object({
  label: z.string(),
  reason: z.string(),
});

const intakeBriefSchema = z.object({
  matterId: z.string(),
  clientNeeds: z.array(z.string()),
  coreFacts: z.array(z.string()),
  issues: z.array(z.string()),
  causeCandidates: z.array(intakeCandidateSchema),
  evidenceGaps: z.array(z.string()),
  nextActions: z.array(z.string()),
  source: z.enum(["talk", "materials", "mixed"]),
  transcriptExcerpt: z.string().optional(),
  updatedAt: z.string(),
  confirmedAt: z.string().optional(),
});

const docketSchema = z
  .object({
    caseNo: z.string().optional(),
    court: z.string().optional(),
    instance: z.string().optional(),
    standing: z.string().optional(),
    hearingAt: z.string().optional(),
  })
  .optional();

const deskWriteSchema: z.ZodType<DeskWriteRecord> = z.object({
  writeId: z.string().min(1),
  matterId: z.string().min(1),
  kind: z.enum(DESK_WRITE_KINDS),
  createdAt: z.string(),
  deadlineIds: z.array(z.string()).optional(),
  previousHearingAt: z.string().nullable().optional(),
  previousProfile: z
    .object({
      title: z.string().optional(),
      clientId: z.string().optional(),
      matterKind: z.enum(["contract", "litigation", "general"]).optional(),
      docket: docketSchema,
    })
    .optional(),
  previousIntake: intakeBriefSchema.nullable().optional(),
  organizeOps: z
    .array(
      z.object({
        from: z.string().min(1),
        to: z.string().min(1),
        reason: z.string().optional(),
      }),
    )
    .optional(),
  fileOps: z
    .array(
      z.object({
        from: z.string().min(1),
        to: z.string().min(1),
        copied: z.boolean().optional(),
        bytes: z.number().nonnegative().optional(),
        reason: z.string().optional(),
      }),
    )
    .optional(),
});

function journalPath(workspaceDir: string, matterId: string): string {
  return path.join(matterDir(workspaceDir, matterId), "desk-writes.jsonl");
}

export function newDeskWriteId(): string {
  return `dw-${randomUUID()}`;
}

export function appendDeskWrite(workspaceDir: string, record: DeskWriteRecord): DeskWriteRecord {
  fs.mkdirSync(matterDir(workspaceDir, record.matterId), { recursive: true });
  appendJsonl(journalPath(workspaceDir, record.matterId), deskWriteSchema, record);
  return record;
}

export function loadDeskWrite(
  workspaceDir: string,
  matterId: string,
  writeId: string,
): DeskWriteRecord | undefined {
  const rows = readJsonl(journalPath(workspaceDir, matterId), deskWriteSchema);
  return rows.find((row) => row.writeId === writeId);
}

export function listDeskWrites(workspaceDir: string, matterId: string): DeskWriteRecord[] {
  return readJsonl(journalPath(workspaceDir, matterId), deskWriteSchema);
}
