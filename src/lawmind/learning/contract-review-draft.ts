/**
 * 合同修订「待验收」草稿：律师批注与定稿路径在写入私有积累库之前落盘。
 * 目录：`workspace/learning/contract-reviews/drafts/`
 */

import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

export type ContractReviewDraftStatus = "open" | "accepted" | "withdrawn";

export type ContractReviewDraftV1 = {
  schemaVersion: 1;
  draftId: string;
  createdAt: string;
  updatedAt: string;
  status: ContractReviewDraftStatus;
  /** 工作区相对路径 */
  initialPath: string;
  /** 工作区相对路径（律师改后候选稿） */
  revisedPath: string;
  lawyerAnnotations: string;
  /** 律师拟写入积累库的要点草稿 */
  keyModificationsDraft: string[];
  matterId?: string;
  assistantId?: string;
};

const ROOT = path.join("learning", "contract-reviews", "drafts");

function draftsRoot(workspaceDir: string): string {
  return path.join(workspaceDir, ROOT);
}

function newDraftId(): string {
  return `crd_${Date.now().toString(36)}_${randomBytes(3).toString("hex")}`;
}

export async function saveContractReviewDraft(
  workspaceDir: string,
  input: Omit<
    ContractReviewDraftV1,
    "schemaVersion" | "draftId" | "createdAt" | "updatedAt" | "status"
  > & {
    draftId?: string;
    status?: ContractReviewDraftStatus;
  },
): Promise<ContractReviewDraftV1> {
  const now = new Date().toISOString();
  const draftId = input.draftId?.trim() || newDraftId();
  const base = draftsRoot(workspaceDir);
  await fs.mkdir(base, { recursive: true });
  const p = path.join(base, `${draftId}.json`);
  let createdAt = now;
  try {
    const prev = JSON.parse(await fs.readFile(p, "utf8")) as ContractReviewDraftV1;
    if (typeof prev.createdAt === "string") {
      createdAt = prev.createdAt;
    }
  } catch {
    /* new */
  }
  const doc: ContractReviewDraftV1 = {
    schemaVersion: 1,
    draftId,
    createdAt,
    updatedAt: now,
    status: input.status ?? "open",
    initialPath: input.initialPath.trim(),
    revisedPath: input.revisedPath.trim(),
    lawyerAnnotations: input.lawyerAnnotations.trim(),
    keyModificationsDraft: Array.isArray(input.keyModificationsDraft)
      ? input.keyModificationsDraft.filter((x) => typeof x === "string" && x.trim())
      : [],
    ...(input.matterId?.trim() ? { matterId: input.matterId.trim() } : {}),
    ...(input.assistantId?.trim() ? { assistantId: input.assistantId.trim() } : {}),
  };
  await fs.writeFile(p, `${JSON.stringify(doc, null, 2)}\n`, "utf8");
  return doc;
}

export async function listOpenContractReviewDrafts(
  workspaceDir: string,
  limit = 30,
): Promise<ContractReviewDraftV1[]> {
  const base = draftsRoot(workspaceDir);
  let names: string[] = [];
  try {
    names = await fs.readdir(base);
  } catch {
    return [];
  }
  const out: ContractReviewDraftV1[] = [];
  for (const name of names) {
    if (!name.endsWith(".json")) {
      continue;
    }
    try {
      const raw = await fs.readFile(path.join(base, name), "utf8");
      const j = JSON.parse(raw) as ContractReviewDraftV1;
      if (j.schemaVersion !== 1 || j.status !== "open") {
        continue;
      }
      out.push(j);
    } catch {
      continue;
    }
  }
  out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return out.slice(0, limit);
}

export async function readContractReviewDraft(
  workspaceDir: string,
  draftId: string,
): Promise<ContractReviewDraftV1 | null> {
  const p = path.join(draftsRoot(workspaceDir), `${draftId.trim()}.json`);
  try {
    const raw = await fs.readFile(p, "utf8");
    const j = JSON.parse(raw) as ContractReviewDraftV1;
    if (j.schemaVersion !== 1) {
      return null;
    }
    return j;
  } catch {
    return null;
  }
}

export async function markContractReviewDraftAccepted(
  workspaceDir: string,
  draftId: string,
): Promise<void> {
  const d = await readContractReviewDraft(workspaceDir, draftId);
  if (!d) {
    throw new Error("draft_not_found");
  }
  const now = new Date().toISOString();
  const next: ContractReviewDraftV1 = { ...d, status: "accepted", updatedAt: now };
  await fs.writeFile(
    path.join(draftsRoot(workspaceDir), `${draftId}.json`),
    `${JSON.stringify(next, null, 2)}\n`,
    "utf8",
  );
}
