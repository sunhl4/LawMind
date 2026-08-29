/**
 * Auto-surface recent contract revision packs into the agent prompt when the
 * lawyer is doing contract / review work — so experience is used, not only stored.
 */

import fs from "node:fs/promises";
import path from "node:path";
import {
  contractRevisionsRootDir,
  listContractRevisionPacks,
  type ContractRevisionListItem,
} from "./contract-revision-pack.js";

const CONTRACTISH_RE = /(合同|协议|审查|修订|改稿|红线|NDA|保密协议|租赁)/i;

export function instructionSuggestsContractExperience(instruction: string): boolean {
  return CONTRACTISH_RE.test(instruction);
}

async function readKeyModificationsSnippet(
  workspaceDir: string,
  revisionId: string,
  maxChars = 600,
): Promise<string | undefined> {
  const p = path.join(contractRevisionsRootDir(workspaceDir), revisionId, "KEY_MODIFICATIONS.md");
  try {
    const raw = await fs.readFile(p, "utf8");
    return raw.trim().slice(0, maxChars);
  } catch {
    return undefined;
  }
}

/**
 * Build a prompt block with recent revision titles + KEY_MODIFICATIONS snippets.
 */
export async function buildContractRevisionRecallBlock(opts: {
  workspaceDir: string;
  instruction: string;
  matterId?: string;
  limit?: number;
}): Promise<string | undefined> {
  if (!instructionSuggestsContractExperience(opts.instruction)) {
    return undefined;
  }
  const limit = opts.limit ?? 3;
  let items: ContractRevisionListItem[] = [];
  try {
    items = await listContractRevisionPacks(opts.workspaceDir, 24);
  } catch {
    return undefined;
  }
  if (items.length === 0) {
    return undefined;
  }
  // Prefer same-matter packs, then newest overall.
  const matterId = opts.matterId?.trim();
  const ranked = [
    ...items.filter((it) => matterId && it.matterId === matterId),
    ...items.filter((it) => !matterId || it.matterId !== matterId),
  ].slice(0, limit);

  const blocks: string[] = [
    "## 相关合同改稿经验（自动召回）",
    "以下为本机过往定稿与关键修改点摘要。起草/审查时应对照律师历史口径，勿无视已沉淀偏好。",
  ];
  for (const it of ranked) {
    const day =
      typeof it.finalizedAt === "string" && it.finalizedAt.length >= 10
        ? it.finalizedAt.slice(0, 10)
        : "";
    const matter = it.matterId ? ` · 案件 ${it.matterId}` : "";
    blocks.push(`### ${it.title}（${it.revisionId}${day ? ` · ${day}` : ""}${matter}）`);
    const snippet = await readKeyModificationsSnippet(opts.workspaceDir, it.revisionId);
    if (snippet) {
      blocks.push(snippet);
    } else {
      blocks.push("（无 KEY_MODIFICATIONS 摘要；可工具读取 learning/contract-revisions/）");
    }
  }
  return blocks.join("\n\n");
}
