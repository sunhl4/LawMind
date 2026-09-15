/**
 * Guardian sidecar — audit only. Never injected into the writer session.
 */

import fs from "node:fs";
import path from "node:path";
import { writeJsonAtomic } from "../adapters/matter-storage/io.js";
import { slimGuardianView } from "./legal-guardian.js";
import { LEGAL_GUARDIAN_MAX_ROUNDS, type GuardianRecord } from "./types.js";

const MAX_STORED_ROUNDS = 6;
const MAX_REVIEWER_RAW = 4_000;

export type GuardianSidecar = {
  taskId: string;
  latest: GuardianRecord;
  rounds: GuardianRecord[];
};

export function guardianSidecarPath(workspaceDir: string, taskId: string): string {
  return path.join(path.resolve(workspaceDir), "drafts", `${taskId}.guardian.json`);
}

function stripRaw(record: GuardianRecord): GuardianRecord {
  const slim = slimGuardianView(record);
  return {
    ...slim,
    taskId: record.taskId,
    at: record.at,
    ...(record.reviewerRaw ? { reviewerRaw: record.reviewerRaw.slice(0, MAX_REVIEWER_RAW) } : {}),
    ...(record.evidencePackHash ? { evidencePackHash: record.evidencePackHash } : {}),
  };
}

export function readGuardianSidecar(
  workspaceDir: string,
  taskId: string,
): GuardianSidecar | undefined {
  try {
    const raw = fs.readFileSync(guardianSidecarPath(workspaceDir, taskId), "utf8");
    const parsed = JSON.parse(raw) as GuardianSidecar;
    if (!parsed?.latest || !Array.isArray(parsed.rounds)) {
      return undefined;
    }
    return parsed;
  } catch {
    return undefined;
  }
}

export function readLatestGuardian(
  workspaceDir: string,
  taskId: string,
): GuardianRecord | undefined {
  return readGuardianSidecar(workspaceDir, taskId)?.latest;
}

export function persistGuardianRecord(
  workspaceDir: string,
  record: GuardianRecord,
): GuardianSidecar {
  const existing = readGuardianSidecar(workspaceDir, record.taskId);
  const nextRecord = stripRaw(record);
  const rounds = [...(existing?.rounds ?? []), nextRecord].slice(-MAX_STORED_ROUNDS);
  const sidecar: GuardianSidecar = {
    taskId: record.taskId,
    latest: nextRecord,
    rounds,
  };
  writeJsonAtomic(guardianSidecarPath(workspaceDir, record.taskId), sidecar);
  return sidecar;
}

export function lawyerGuardianViewFromSidecar(
  workspaceDir: string,
  taskId: string,
): ReturnType<typeof slimGuardianView> | undefined {
  const latest = readLatestGuardian(workspaceDir, taskId);
  if (!latest) {
    return undefined;
  }
  return slimGuardianView({
    ...latest,
    maxRounds: latest.maxRounds || LEGAL_GUARDIAN_MAX_ROUNDS,
  });
}
