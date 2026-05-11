/**
 * 合同修订积累包 — 将「初始稿 / 定稿 / 关键修改点」规范落盘，作为律师风格与任务经验的可审计数据资产。
 *
 * 目录：`{workspace}/learning/contract-revisions/<revisionId>/`
 */

import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { isValidMatterId } from "../cases/matter-id.js";
import { appendLawyerProfileLearning } from "../memory/lawyer-profile-learning.js";

const SCHEMA_VERSION = 1 as const;

export type ContractRevisionManifestV1 = {
  schemaVersion: typeof SCHEMA_VERSION;
  revisionId: string;
  createdAt: string;
  finalizedAt: string;
  matterId?: string;
  assistantId?: string;
  title: string;
  requirementsSummary: string;
  initial: {
    storedRelative: string;
    sourcePathAtCapture: string;
    byteSize: number;
    sha256: string;
  };
  final: {
    storedRelative: string;
    sourcePathAtCapture: string;
    byteSize: number;
    sha256: string;
  };
  keyModificationsRelative: string;
  /** 同一逻辑合同的稳定键（如主合同编号或业务键），便于后续修订更新索引 */
  stableDocumentKey?: string;
};

export function contractRevisionsRootDir(workspaceDir: string): string {
  return path.join(workspaceDir, "learning", "contract-revisions");
}

/**
 * 将用户给出的路径解析为绝对路径，且必须落在 `workspaceDir` 之下（防穿越）。
 */
export function resolvePathStrictlyUnderWorkspace(workspaceDir: string, userPath: string): string {
  const root = path.resolve(workspaceDir);
  const trimmed = userPath.trim();
  if (!trimmed) {
    throw new Error("path_empty");
  }
  const candidate = path.isAbsolute(trimmed) ? path.resolve(trimmed) : path.resolve(root, trimmed);
  const normRoot = root.endsWith(path.sep) ? root.slice(0, -1) : root;
  const norm = candidate.endsWith(path.sep) ? candidate.slice(0, -1) : candidate;
  if (norm !== normRoot && !norm.startsWith(`${normRoot}${path.sep}`)) {
    throw new Error("path_outside_workspace");
  }
  return candidate;
}

function newRevisionId(): string {
  const day = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const rnd = randomBytes(3).toString("hex");
  return `cr_${day}_${rnd}`;
}

async function sha256OfFile(absPath: string): Promise<{ byteSize: number; sha256: string }> {
  const buf = await fs.readFile(absPath);
  const sha256 = createHash("sha256").update(buf).digest("hex");
  return { byteSize: buf.length, sha256 };
}

function safeStableKeySlug(key: string): string {
  const t = key
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .slice(0, 120);
  return t || "document";
}

async function upsertRevisionKeyIndex(
  workspaceDir: string,
  stableDocumentKey: string,
  revisionId: string,
): Promise<void> {
  const idxDir = path.join(workspaceDir, "learning", "contract-revisions", "_index", "by-key");
  await fs.mkdir(idxDir, { recursive: true });
  const file = path.join(idxDir, `${safeStableKeySlug(stableDocumentKey)}.json`);
  type Row = {
    stableDocumentKey: string;
    latestRevisionId: string;
    updatedAt: string;
    history: string[];
  };
  const now = new Date().toISOString();
  let row: Row = {
    stableDocumentKey,
    latestRevisionId: revisionId,
    updatedAt: now,
    history: [revisionId],
  };
  try {
    const prev = JSON.parse(await fs.readFile(file, "utf8")) as Partial<Row>;
    const hist = Array.isArray(prev.history) ? [...prev.history] : [];
    if (!hist.includes(revisionId)) {
      hist.push(revisionId);
    }
    row = {
      stableDocumentKey,
      latestRevisionId: revisionId,
      updatedAt: now,
      history: hist.slice(-80),
    };
  } catch {
    /* first write */
  }
  await fs.writeFile(file, `${JSON.stringify(row, null, 2)}\n`, "utf8");
}

function buildKeyModificationsMarkdown(args: {
  revisionId: string;
  finalizedAt: string;
  title: string;
  requirementsSummary: string;
  bullets: string[];
  lawyerReviewNotes?: string;
}): string {
  const lines = [
    "# 关键修改点",
    "",
    `- **修订包 ID**：\`${args.revisionId}\``,
    `- **定稿时间**：${args.finalizedAt}`,
    `- **标题**：${args.title || "（未命名）"}`,
    "",
    "## 修改要求摘要",
    "",
    args.requirementsSummary.trim() || "_（未填写）_",
    "",
  ];
  if (args.lawyerReviewNotes?.trim()) {
    lines.push("## 律师批注（验收前）", "", args.lawyerReviewNotes.trim(), "", "## 要点列表", "");
  } else {
    lines.push("## 要点列表", "");
  }
  const bullets = args.bullets.map((b) => b.trim()).filter(Boolean);
  if (bullets.length === 0) {
    lines.push("_（未记录要点）_", "");
  } else {
    for (let i = 0; i < bullets.length; i++) {
      lines.push(`${i + 1}. ${bullets[i]}`);
    }
    lines.push("");
  }
  lines.push(
    "---",
    "",
    "_本文件与 `manifest.json`、初始/定稿副本共同构成一条「合同修订积累」记录，可用于助手个性化与合规审计。_",
    "",
  );
  return lines.join("\n");
}

export type FinalizeContractRevisionPackInput = {
  workspaceDir: string;
  initialSourcePath: string;
  finalSourcePath: string;
  /** 每条为一项「关键修改」叙述（将写入 KEY_MODIFICATIONS.md） */
  keyModifications: string[];
  title?: string;
  requirementsSummary?: string;
  matterId?: string;
  assistantId?: string;
  /** 为 true 时在 LAWYER_PROFILE「八、个人积累」追加一条指向本包的摘要 */
  appendLawyerProfileBullet?: boolean;
  auditDir?: string;
  /** 与历史修订关联的稳定键；写入 `_index/by-key/<slug>.json` 指向本 `revisionId` */
  stableDocumentKey?: string;
  /** 写入 KEY_MODIFICATIONS.md「律师批注」一节 */
  lawyerReviewNotes?: string;
};

export type FinalizeContractRevisionPackResult = {
  revisionId: string;
  packDir: string;
  manifest: ContractRevisionManifestV1;
};

/**
 * 创建修订包目录：复制初始稿与定稿、写入 manifest 与 KEY_MODIFICATIONS.md。
 */
export async function finalizeContractRevisionPack(
  input: FinalizeContractRevisionPackInput,
): Promise<FinalizeContractRevisionPackResult> {
  const matterId = input.matterId?.trim();
  if (matterId && !isValidMatterId(matterId)) {
    throw new Error("invalid_matter_id");
  }

  const initialAbs = resolvePathStrictlyUnderWorkspace(input.workspaceDir, input.initialSourcePath);
  const finalAbs = resolvePathStrictlyUnderWorkspace(input.workspaceDir, input.finalSourcePath);

  await fs.access(initialAbs).catch(() => {
    throw new Error("initial_file_not_found");
  });
  await fs.access(finalAbs).catch(() => {
    throw new Error("final_file_not_found");
  });

  const revisionId = newRevisionId();
  const root = contractRevisionsRootDir(input.workspaceDir);
  const packDir = path.join(root, revisionId);
  const initialDir = path.join(packDir, "initial");
  const finalDir = path.join(packDir, "final");
  await fs.mkdir(initialDir, { recursive: true });
  await fs.mkdir(finalDir, { recursive: true });

  const initialName = path.basename(initialAbs);
  const finalName = path.basename(finalAbs);
  const initialStored = path.join("initial", initialName);
  const finalStored = path.join("final", finalName);

  await fs.copyFile(initialAbs, path.join(packDir, initialStored));
  await fs.copyFile(finalAbs, path.join(packDir, finalStored));

  const initialMeta = await sha256OfFile(path.join(packDir, initialStored));
  const finalMeta = await sha256OfFile(path.join(packDir, finalStored));

  const finalizedAt = new Date().toISOString();
  const title = (input.title ?? "").trim() || initialName;
  const requirementsSummary = (input.requirementsSummary ?? "").trim();
  const keyRel = "KEY_MODIFICATIONS.md";
  const keyBody = buildKeyModificationsMarkdown({
    revisionId,
    finalizedAt,
    title,
    requirementsSummary,
    bullets: input.keyModifications ?? [],
    lawyerReviewNotes: input.lawyerReviewNotes,
  });
  await fs.writeFile(path.join(packDir, keyRel), keyBody, "utf8");

  const stableKey = input.stableDocumentKey?.trim();
  const manifest: ContractRevisionManifestV1 = {
    schemaVersion: SCHEMA_VERSION,
    revisionId,
    createdAt: finalizedAt,
    finalizedAt,
    ...(matterId ? { matterId } : {}),
    ...(input.assistantId?.trim() ? { assistantId: input.assistantId.trim() } : {}),
    ...(stableKey ? { stableDocumentKey: stableKey } : {}),
    title,
    requirementsSummary,
    initial: {
      storedRelative: initialStored.replace(/\\/g, "/"),
      sourcePathAtCapture:
        path.relative(input.workspaceDir, initialAbs).replace(/\\/g, "/") || initialName,
      byteSize: initialMeta.byteSize,
      sha256: initialMeta.sha256,
    },
    final: {
      storedRelative: finalStored.replace(/\\/g, "/"),
      sourcePathAtCapture:
        path.relative(input.workspaceDir, finalAbs).replace(/\\/g, "/") || finalName,
      byteSize: finalMeta.byteSize,
      sha256: finalMeta.sha256,
    },
    keyModificationsRelative: keyRel,
  };

  await fs.writeFile(
    path.join(packDir, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );

  if (stableKey) {
    await upsertRevisionKeyIndex(input.workspaceDir, stableKey, revisionId);
  }

  if (input.appendLawyerProfileBullet) {
    const n = (input.keyModifications ?? []).filter((s) => s.trim()).length;
    const bullet = `合同修订积累（${revisionId}，${title}）：要点 ${n} 条；见 learning/contract-revisions/${revisionId}/。`;
    await appendLawyerProfileLearning(input.workspaceDir, bullet, "manual", {
      auditDir: input.auditDir,
      auditTaskId: revisionId,
    });
  }

  return { revisionId, packDir, manifest };
}

export type ContractRevisionListItem = {
  revisionId: string;
  finalizedAt: string;
  title: string;
  matterId?: string;
};

/**
 * 列出已落盘的修订包（仅读取含合法 manifest 的目录，新到旧）。
 */
export async function listContractRevisionPacks(
  workspaceDir: string,
  limit = 50,
): Promise<ContractRevisionListItem[]> {
  const root = contractRevisionsRootDir(workspaceDir);
  let names: string[] = [];
  try {
    names = await fs.readdir(root);
  } catch {
    return [];
  }
  const out: ContractRevisionListItem[] = [];
  for (const name of names) {
    if (out.length >= limit) {
      break;
    }
    const manifestPath = path.join(root, name, "manifest.json");
    try {
      const raw = await fs.readFile(manifestPath, "utf8");
      const j = JSON.parse(raw) as Partial<ContractRevisionManifestV1>;
      if (j?.schemaVersion !== 1 || typeof j.revisionId !== "string") {
        continue;
      }
      out.push({
        revisionId: j.revisionId,
        finalizedAt: typeof j.finalizedAt === "string" ? j.finalizedAt : "",
        title: typeof j.title === "string" ? j.title : name,
        ...(typeof j.matterId === "string" && j.matterId ? { matterId: j.matterId } : {}),
      });
    } catch {
      continue;
    }
  }
  out.sort((a, b) => b.finalizedAt.localeCompare(a.finalizedAt));
  return out.slice(0, limit);
}
