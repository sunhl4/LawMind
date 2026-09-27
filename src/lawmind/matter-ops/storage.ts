import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import {
  appendJsonl,
  readJsonl,
  withExclusiveFileLock,
  writeJsonAtomic,
} from "../adapters/matter-storage/io.js";
import { assertSafeMatterId, matterDir } from "../adapters/matter-storage/paths.js";
import type {
  MatterOpsPlan,
  MatterOpsScope,
  MatterOpsSummary,
  MatterRaidEntry,
  MatterTheoryLite,
} from "./types.js";

const scopeSchema = z.object({
  matterId: z.string().min(1),
  baseline: z.string(),
  updatedAt: z.string().min(1),
  changes: z.array(z.object({ at: z.string(), note: z.string() })).optional(),
});

const planSchema = z.object({
  matterId: z.string().min(1),
  phases: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      owner: z.string().optional(),
      dueAt: z.string().optional(),
    }),
  ),
  milestones: z.array(
    z.object({ id: z.string(), title: z.string(), dueAt: z.string().optional() }),
  ),
  updatedAt: z.string().min(1),
});

const theorySchema = z.object({
  matterId: z.string().min(1),
  issues: z.string(),
  authorities: z.string(),
  openQuestions: z.string(),
  updatedAt: z.string().min(1),
  anchored: z.boolean(),
});

const raidEntrySchema = z.object({
  id: z.string().min(1),
  kind: z.enum(["risk", "assumption", "issue", "decision"]),
  text: z.string(),
  status: z.enum(["open", "closed"]).optional(),
  createdAt: z.string().min(1),
});

function withOpsFileLock<T>(filePath: string, fn: () => T): T {
  return withExclusiveFileLock(`${filePath}.lock`, fn);
}

function opsDir(workspaceDir: string, matterId: string): string {
  return path.join(matterDir(workspaceDir, assertSafeMatterId(matterId)), "ops");
}

function readJsonFile(file: string): unknown {
  try {
    if (!fs.existsSync(file)) {
      return null;
    }
    return JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
  } catch {
    return null;
  }
}

/** Writes must not replace a torn file with a fresh object and drop history. */
function readJsonFileForWrite(file: string): unknown {
  if (!fs.existsSync(file)) {
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
  } catch {
    throw new Error(`matter_ops_corrupt:${path.basename(file)}`);
  }
}

function isOpenRisk(row: MatterRaidEntry): boolean {
  return row.kind === "risk" && (row.status ?? "open") === "open";
}

export function readMatterOpsSummary(workspaceDir: string, matterId: string): MatterOpsSummary {
  const mid = assertSafeMatterId(matterId);
  const dir = opsDir(workspaceDir, mid);
  const scope = readJsonFile(path.join(dir, "scope.json")) as MatterOpsScope | null;
  const plan = readJsonFile(path.join(dir, "plan.json")) as MatterOpsPlan | null;
  const raidAll = readJsonl(path.join(dir, "raid.jsonl"), raidEntrySchema);
  const openRiskCount = raidAll.filter(isOpenRisk).length;
  const newestFirst = raidAll.slice().toReversed();
  const raidRecent: MatterRaidEntry[] = [];
  const seenRaid = new Set<string>();
  for (const row of [
    ...newestFirst.filter(isOpenRisk),
    ...newestFirst.filter((row) => !isOpenRisk(row)),
  ]) {
    if (seenRaid.has(row.id)) {
      continue;
    }
    seenRaid.add(row.id);
    raidRecent.push(row);
    if (raidRecent.length >= 12) {
      break;
    }
  }
  const nextMilestone =
    plan?.milestones
      ?.slice()
      .toSorted((a, b) => (a.dueAt ?? "").localeCompare(b.dueAt ?? ""))
      .find((m) => Boolean(m.dueAt)) ??
    plan?.milestones?.[0] ??
    null;
  return {
    matterId: mid,
    scope,
    plan,
    raidRecent,
    openRiskCount,
    nextMilestone,
  };
}

export function writeMatterOpsScope(
  workspaceDir: string,
  matterId: string,
  baseline: string,
): MatterOpsScope {
  const mid = assertSafeMatterId(matterId);
  const dir = opsDir(workspaceDir, mid);
  const filePath = path.join(dir, "scope.json");
  return withOpsFileLock(filePath, () => {
    const prev = readJsonFileForWrite(filePath) as MatterOpsScope | null;
    const now = new Date().toISOString();
    const scope: MatterOpsScope = {
      matterId: mid,
      baseline: baseline.trim(),
      updatedAt: now,
      changes: [
        ...(prev?.changes ?? []),
        ...(prev?.baseline && prev.baseline !== baseline.trim()
          ? [{ at: now, note: `基线更新：${prev.baseline.slice(0, 80)}` }]
          : []),
      ].slice(-20),
    };
    writeJsonAtomic(filePath, scopeSchema.parse(scope));
    return scope;
  });
}

export function writeMatterOpsPlan(
  workspaceDir: string,
  matterId: string,
  plan: Omit<MatterOpsPlan, "matterId" | "updatedAt">,
): MatterOpsPlan {
  const mid = assertSafeMatterId(matterId);
  const filePath = path.join(opsDir(workspaceDir, mid), "plan.json");
  const next: MatterOpsPlan = {
    matterId: mid,
    phases: plan.phases ?? [],
    milestones: plan.milestones ?? [],
    updatedAt: new Date().toISOString(),
  };
  withOpsFileLock(filePath, () => {
    writeJsonAtomic(filePath, planSchema.parse(next));
  });
  return next;
}

export function appendMatterRaid(
  workspaceDir: string,
  matterId: string,
  entry: Omit<MatterRaidEntry, "id" | "createdAt"> & { id?: string; createdAt?: string },
): MatterRaidEntry {
  const mid = assertSafeMatterId(matterId);
  const filePath = path.join(opsDir(workspaceDir, mid), "raid.jsonl");
  const row: MatterRaidEntry = {
    id: entry.id ?? `raid_${randomUUID().replace(/-/g, "").slice(0, 12)}`,
    kind: entry.kind,
    text: entry.text.trim(),
    status: entry.status ?? "open",
    createdAt: entry.createdAt ?? new Date().toISOString(),
  };
  withOpsFileLock(filePath, () => {
    appendJsonl(filePath, raidEntrySchema, row);
  });
  return row;
}

export function theoryLitePath(workspaceDir: string, matterId: string): string {
  return path.join(opsDir(workspaceDir, assertSafeMatterId(matterId)), "theory-lite.json");
}

export function readMatterTheoryLite(
  workspaceDir: string,
  matterId: string,
): MatterTheoryLite | null {
  return readJsonFile(theoryLitePath(workspaceDir, matterId)) as MatterTheoryLite | null;
}

export function writeMatterTheoryLite(
  workspaceDir: string,
  matterId: string,
  body: Pick<MatterTheoryLite, "issues" | "authorities" | "openQuestions" | "anchored">,
): MatterTheoryLite {
  const mid = assertSafeMatterId(matterId);
  const filePath = theoryLitePath(workspaceDir, mid);
  const next: MatterTheoryLite = {
    matterId: mid,
    issues: body.issues ?? "",
    authorities: body.authorities ?? "",
    openQuestions: body.openQuestions ?? "",
    anchored: body.anchored,
    updatedAt: new Date().toISOString(),
  };
  withOpsFileLock(filePath, () => {
    writeJsonAtomic(filePath, theorySchema.parse(next));
  });
  return next;
}

/** High-risk strict render: need matter theory anchored when theory required. */
export function matterTheoryBlocksStrictExport(
  workspaceDir: string,
  matterId: string | null | undefined,
  opts?: { requireAnchor?: boolean },
): boolean {
  if (!opts?.requireAnchor) {
    return false;
  }
  if (!matterId?.trim()) {
    return true;
  }
  const t = readMatterTheoryLite(workspaceDir, matterId);
  if (!t?.anchored) {
    return true;
  }
  if (!t.issues.trim() && !t.authorities.trim()) {
    return true;
  }
  return false;
}
