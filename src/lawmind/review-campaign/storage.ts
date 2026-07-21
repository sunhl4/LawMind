/**
 * ReviewCampaign persistence — Skills E2 / W20.
 */

import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { assertSafeMatterId, matterDir } from "../adapters/matter-storage/paths.js";
import { isFeatureEnabled } from "../policy/edition.js";
import { readWorkspacePolicyFile } from "../policy/workspace-policy.js";
// FleetPlaybook used by playbookForFastMode
import { getFleetPlaybook, resolveDefaultPlaybookId } from "./playbooks.js";
import {
  runCampaignRolesParallel,
  runCampaignRolesSerial,
  rerunCampaignRole,
} from "./serial-runner.js";
import type { FleetPlaybook, ReviewCampaign, ReviewCampaignRoleResult } from "./types.js";

const SAFE_ID = /^[a-zA-Z0-9_-]{1,128}$/;

export function campaignDir(workspaceDir: string, matterId: string): string {
  return path.join(matterDir(workspaceDir, matterId), "campaigns");
}

export function orphanCampaignDir(workspaceDir: string): string {
  return path.join(workspaceDir, "lawmind", "campaigns");
}

function campaignPath(workspaceDir: string, matterId: string | null, campaignId: string): string {
  const safe = campaignId.trim();
  if (!SAFE_ID.test(safe)) {
    throw new Error(`unsafe campaign id: ${campaignId}`);
  }
  if (matterId) {
    return path.join(campaignDir(workspaceDir, assertSafeMatterId(matterId)), `${safe}.json`);
  }
  return path.join(orphanCampaignDir(workspaceDir), `${safe}.json`);
}

export function persistReviewCampaign(workspaceDir: string, campaign: ReviewCampaign): void {
  const file = campaignPath(workspaceDir, campaign.matterId, campaign.id);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(campaign, null, 2)}\n`, "utf8");
}

export function readReviewCampaign(
  workspaceDir: string,
  campaignId: string,
  matterId?: string | null,
): ReviewCampaign | null {
  const candidates: string[] = [];
  if (matterId) {
    candidates.push(campaignPath(workspaceDir, matterId, campaignId));
  }
  candidates.push(campaignPath(workspaceDir, null, campaignId));
  for (const file of candidates) {
    try {
      if (!fs.existsSync(file)) {
        continue;
      }
      return JSON.parse(fs.readFileSync(file, "utf8")) as ReviewCampaign;
    } catch {
      continue;
    }
  }
  // Fallback: scan matters/<id>/campaigns/<campaignId>.json when matterId omitted.
  const mattersRoot = path.join(workspaceDir, "matters");
  if (!fs.existsSync(mattersRoot)) {
    return null;
  }
  try {
    for (const name of fs.readdirSync(mattersRoot)) {
      const file = path.join(mattersRoot, name, "campaigns", `${campaignId.trim()}.json`);
      if (!fs.existsSync(file)) {
        continue;
      }
      try {
        return JSON.parse(fs.readFileSync(file, "utf8")) as ReviewCampaign;
      } catch {
        continue;
      }
    }
  } catch {
    return null;
  }
  return null;
}

/** Latest campaign for a task (by updatedAt). */
export function findCampaignByTaskId(
  workspaceDir: string,
  taskId: string,
  matterId?: string | null,
): ReviewCampaign | null {
  const tid = taskId.trim();
  if (!tid) {
    return null;
  }
  const dirs: string[] = [orphanCampaignDir(workspaceDir)];
  if (matterId) {
    dirs.unshift(campaignDir(workspaceDir, assertSafeMatterId(matterId)));
  } else {
    const mattersRoot = path.join(workspaceDir, "matters");
    if (fs.existsSync(mattersRoot)) {
      for (const name of fs.readdirSync(mattersRoot)) {
        dirs.push(path.join(mattersRoot, name, "campaigns"));
      }
    }
  }
  let best: ReviewCampaign | null = null;
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) {
      continue;
    }
    for (const name of fs.readdirSync(dir)) {
      if (!name.endsWith(".json")) {
        continue;
      }
      try {
        const c = JSON.parse(fs.readFileSync(path.join(dir, name), "utf8")) as ReviewCampaign;
        if (c.taskId !== tid) {
          continue;
        }
        if (!best || (c.updatedAt ?? "") > (best.updatedAt ?? "")) {
          best = c;
        }
      } catch {
        /* skip */
      }
    }
  }
  return best;
}

/** Scan orphan + optional matter dir for idempotency key match. */
export function findCampaignByIdempotencyKey(
  workspaceDir: string,
  idempotencyKey: string,
  matterId?: string | null,
): ReviewCampaign | null {
  const key = idempotencyKey.trim();
  if (!key) {
    return null;
  }
  const dirs: string[] = [orphanCampaignDir(workspaceDir)];
  if (matterId) {
    dirs.unshift(campaignDir(workspaceDir, assertSafeMatterId(matterId)));
  }
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) {
      continue;
    }
    for (const name of fs.readdirSync(dir)) {
      if (!name.endsWith(".json")) {
        continue;
      }
      try {
        const c = JSON.parse(fs.readFileSync(path.join(dir, name), "utf8")) as ReviewCampaign;
        if (c.idempotencyKey === key) {
          return c;
        }
      } catch {
        /* skip */
      }
    }
  }
  return null;
}

function rolesFromPlaybook(playbook: FleetPlaybook): ReviewCampaignRoleResult[] {
  return playbook.roles.map((r) => ({
    roleId: r.id,
    label: r.label,
    status: "pending" as const,
    weight: r.weight,
    findings: [],
  }));
}

export type CreateReviewCampaignInput = {
  matterId?: string | null;
  taskId?: string | null;
  playbookId?: string;
  deliverableTypeHint?: string;
  sourceText?: string;
  idempotencyKey?: string;
  /** When true, run Solo serial heuristics immediately */
  runNow?: boolean;
  /** Request parallel execution (Firm/Private only; Solo forced serial) */
  preferParallel?: boolean;
  /** Drop roles with weight &lt; 0.18 for faster Solo runs (keep ≥4 when possible) */
  preferFast?: boolean;
};

export function createReviewCampaign(
  workspaceDir: string,
  input: CreateReviewCampaignInput,
): ReviewCampaign {
  if (input.idempotencyKey?.trim()) {
    const existing = findCampaignByIdempotencyKey(
      workspaceDir,
      input.idempotencyKey,
      input.matterId,
    );
    if (existing) {
      return existing;
    }
  }

  const playbookId =
    input.playbookId?.trim() || resolveDefaultPlaybookId(input.deliverableTypeHint);
  const playbook = getFleetPlaybook(workspaceDir, playbookId);
  if (!playbook) {
    throw new Error(`unknown_playbook:${playbookId}`);
  }
  const effective = input.preferFast ? playbookForFastMode(playbook) : playbook;

  const now = new Date().toISOString();
  const id = `campaign_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
  let campaign: ReviewCampaign = {
    id,
    matterId: input.matterId?.trim() || null,
    taskId: input.taskId?.trim() || null,
    playbookId: playbook.id,
    playbookLabel: playbook.label,
    status: "draft",
    createdAt: now,
    updatedAt: now,
    roles: rolesFromPlaybook(effective),
    sourceText: (input.sourceText ?? "").slice(0, 200_000),
    ...(input.preferFast ? { preferFast: true } : {}),
    ...(input.idempotencyKey?.trim() ? { idempotencyKey: input.idempotencyKey.trim() } : {}),
  };

  if (input.runNow !== false) {
    campaign = executeCampaign(workspaceDir, campaign, {
      preferParallel: input.preferParallel === true || playbook.executionMode === "parallel",
      preferFast: input.preferFast === true,
    });
  } else {
    campaign.status = "queued";
    persistReviewCampaign(workspaceDir, campaign);
  }
  return campaign;
}

function playbookForFastMode(playbook: FleetPlaybook): FleetPlaybook {
  const kept = playbook.roles.filter((r) => r.weight >= 0.18);
  const roles =
    kept.length >= 4
      ? kept
      : [...playbook.roles].toSorted((a, b) => b.weight - a.weight).slice(0, 4);
  return { ...playbook, roles };
}

function resolveCampaignParallelAllowed(workspaceDir: string): boolean {
  try {
    const policy = readWorkspacePolicyFile(workspaceDir);
    return isFeatureEnabled("reviewCampaignParallel", { policy });
  } catch {
    return false;
  }
}

/** Solo serial or Firm parallel (edition-gated). */
export function executeCampaign(
  workspaceDir: string,
  campaign: ReviewCampaign,
  opts?: { preferParallel?: boolean; preferFast?: boolean },
): ReviewCampaign {
  const playbook = getFleetPlaybook(workspaceDir, campaign.playbookId);
  if (!playbook) {
    const failed: ReviewCampaign = {
      ...campaign,
      status: "failed",
      error: `unknown_playbook:${campaign.playbookId}`,
      updatedAt: new Date().toISOString(),
    };
    persistReviewCampaign(workspaceDir, failed);
    return failed;
  }
  const effective =
    opts?.preferFast || campaign.preferFast ? playbookForFastMode(playbook) : playbook;
  const wantParallel = opts?.preferParallel === true || playbook.executionMode === "parallel";
  const parallel = wantParallel && resolveCampaignParallelAllowed(workspaceDir);
  const running: ReviewCampaign = {
    ...campaign,
    status: "running",
    updatedAt: new Date().toISOString(),
  };
  persistReviewCampaign(workspaceDir, running);

  try {
    const { roles, safetyScore } = parallel
      ? runCampaignRolesParallel(effective, campaign.sourceText ?? "")
      : runCampaignRolesSerial(effective, campaign.sourceText ?? "");
    const done: ReviewCampaign = {
      ...running,
      status: "completed",
      roles,
      safetyScore,
      updatedAt: new Date().toISOString(),
      error: undefined,
      executionModeUsed: parallel ? "parallel" : "serial",
    };
    persistReviewCampaign(workspaceDir, done);
    return done;
  } catch (e) {
    const failed: ReviewCampaign = {
      ...running,
      status: "failed",
      error: e instanceof Error ? e.message : String(e),
      updatedAt: new Date().toISOString(),
    };
    persistReviewCampaign(workspaceDir, failed);
    return failed;
  }
}

/** @deprecated Prefer executeCampaign — kept for call sites / tests. */
export function executeCampaignSerial(
  workspaceDir: string,
  campaign: ReviewCampaign,
): ReviewCampaign {
  return executeCampaign(workspaceDir, campaign, { preferParallel: false });
}

export function cancelReviewCampaign(
  workspaceDir: string,
  campaign: ReviewCampaign,
): ReviewCampaign {
  if (campaign.status === "completed" || campaign.status === "cancelled") {
    return campaign;
  }
  const next: ReviewCampaign = {
    ...campaign,
    status: "cancelled",
    updatedAt: new Date().toISOString(),
    roles: campaign.roles.map((r) =>
      r.status === "pending" || r.status === "running" ? { ...r, status: "skipped" as const } : r,
    ),
  };
  persistReviewCampaign(workspaceDir, next);
  return next;
}

export function rerunReviewCampaignRole(
  workspaceDir: string,
  campaign: ReviewCampaign,
  roleId: string,
): ReviewCampaign {
  const playbook = getFleetPlaybook(workspaceDir, campaign.playbookId);
  if (!playbook) {
    throw new Error(`unknown_playbook:${campaign.playbookId}`);
  }
  const { roles, safetyScore } = rerunCampaignRole(
    playbook,
    campaign.roles,
    roleId as ReviewCampaign["roles"][number]["roleId"],
    campaign.sourceText ?? "",
  );
  const next: ReviewCampaign = {
    ...campaign,
    status: "completed",
    roles,
    safetyScore,
    updatedAt: new Date().toISOString(),
    error: undefined,
  };
  persistReviewCampaign(workspaceDir, next);
  return next;
}

export function renderCampaignReportMarkdown(campaign: ReviewCampaign): string {
  const score = campaign.safetyScore;
  const lines = [
    `# 审查专案组报告`,
    ``,
    `- 专案组：${campaign.playbookLabel}（\`${campaign.id}\`）`,
    `- 状态：${campaign.status}`,
    `- Safety Score：${score?.score ?? "—"} / 100`,
    `- 风险计数：高 ${score?.high ?? 0} · 中 ${score?.medium ?? 0} · 低 ${score?.low ?? 0}`,
    ``,
    `## 角色结论`,
    ``,
  ];
  for (const r of campaign.roles) {
    lines.push(`### ${r.label}（${r.roleId}）`);
    lines.push(`- 状态：${r.status}${typeof r.score === "number" ? ` · 分 ${r.score}` : ""}`);
    if (r.summary) {
      lines.push(`- 摘要：${r.summary}`);
    }
    for (const f of r.findings) {
      lines.push(`- [${f.severity}] ${f.title}：${f.detail}`);
    }
    lines.push("");
  }
  if (score?.negotiatePriority?.length) {
    lines.push(`## 谈判优先级`);
    lines.push("");
    for (const n of score.negotiatePriority.slice(0, 12)) {
      lines.push(`${n.priority}. [${n.severity}] ${n.title}（${n.roleId}）`);
    }
    lines.push("");
  }
  lines.push(`_生成于 ${score?.computedAt ?? campaign.updatedAt}_`);
  lines.push("");
  return lines.join("\n");
}
