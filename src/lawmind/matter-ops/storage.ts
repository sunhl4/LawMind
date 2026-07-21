import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { assertSafeMatterId, matterDir } from "../adapters/matter-storage/paths.js";
import type {
  MatterOpsPlan,
  MatterOpsScope,
  MatterOpsSummary,
  MatterRaidEntry,
  MatterTheoryLite,
} from "./types.js";

function opsDir(workspaceDir: string, matterId: string): string {
  return path.join(matterDir(workspaceDir, assertSafeMatterId(matterId)), "ops");
}

function readJsonFile<T>(file: string): T | null {
  try {
    if (!fs.existsSync(file)) {
      return null;
    }
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return null;
  }
}

export function readMatterOpsSummary(workspaceDir: string, matterId: string): MatterOpsSummary {
  const mid = assertSafeMatterId(matterId);
  const dir = opsDir(workspaceDir, mid);
  const scope = readJsonFile<MatterOpsScope>(path.join(dir, "scope.json"));
  const plan = readJsonFile<MatterOpsPlan>(path.join(dir, "plan.json"));
  const raidPath = path.join(dir, "raid.jsonl");
  const raidRecent: MatterRaidEntry[] = [];
  if (fs.existsSync(raidPath)) {
    const lines = fs.readFileSync(raidPath, "utf8").split("\n").filter(Boolean);
    for (const line of lines.slice(-40)) {
      try {
        raidRecent.push(JSON.parse(line) as MatterRaidEntry);
      } catch {
        /* skip */
      }
    }
  }
  const openRiskCount = raidRecent.filter(
    (r) => r.kind === "risk" && (r.status ?? "open") === "open",
  ).length;
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
    raidRecent: raidRecent.slice(-12).toReversed(),
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
  fs.mkdirSync(dir, { recursive: true });
  const prev = readJsonFile<MatterOpsScope>(path.join(dir, "scope.json"));
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
  fs.writeFileSync(path.join(dir, "scope.json"), `${JSON.stringify(scope, null, 2)}\n`, "utf8");
  return scope;
}

export function writeMatterOpsPlan(
  workspaceDir: string,
  matterId: string,
  plan: Omit<MatterOpsPlan, "matterId" | "updatedAt">,
): MatterOpsPlan {
  const mid = assertSafeMatterId(matterId);
  const dir = opsDir(workspaceDir, mid);
  fs.mkdirSync(dir, { recursive: true });
  const next: MatterOpsPlan = {
    matterId: mid,
    phases: plan.phases ?? [],
    milestones: plan.milestones ?? [],
    updatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(dir, "plan.json"), `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return next;
}

export function appendMatterRaid(
  workspaceDir: string,
  matterId: string,
  entry: Omit<MatterRaidEntry, "id" | "createdAt"> & { id?: string; createdAt?: string },
): MatterRaidEntry {
  const mid = assertSafeMatterId(matterId);
  const dir = opsDir(workspaceDir, mid);
  fs.mkdirSync(dir, { recursive: true });
  const row: MatterRaidEntry = {
    id: entry.id ?? `raid_${randomUUID().replace(/-/g, "").slice(0, 12)}`,
    kind: entry.kind,
    text: entry.text.trim(),
    status: entry.status ?? "open",
    createdAt: entry.createdAt ?? new Date().toISOString(),
  };
  fs.appendFileSync(path.join(dir, "raid.jsonl"), `${JSON.stringify(row)}\n`, "utf8");
  return row;
}

export function theoryLitePath(workspaceDir: string, matterId: string): string {
  return path.join(opsDir(workspaceDir, assertSafeMatterId(matterId)), "theory-lite.json");
}

export function readMatterTheoryLite(
  workspaceDir: string,
  matterId: string,
): MatterTheoryLite | null {
  return readJsonFile<MatterTheoryLite>(theoryLitePath(workspaceDir, matterId));
}

export function writeMatterTheoryLite(
  workspaceDir: string,
  matterId: string,
  body: Pick<MatterTheoryLite, "issues" | "authorities" | "openQuestions" | "anchored">,
): MatterTheoryLite {
  const mid = assertSafeMatterId(matterId);
  const dir = opsDir(workspaceDir, mid);
  fs.mkdirSync(dir, { recursive: true });
  const next: MatterTheoryLite = {
    matterId: mid,
    issues: body.issues ?? "",
    authorities: body.authorities ?? "",
    openQuestions: body.openQuestions ?? "",
    anchored: Boolean(body.anchored),
    updatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(theoryLitePath(workspaceDir, mid), `${JSON.stringify(next, null, 2)}\n`, "utf8");
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
