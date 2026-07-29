/**
 * Doctor / health 扩展字段（纯函数，便于单测；由 lawmind-local-server 组装进 /api/health）。
 */

import fs from "node:fs";
import path from "node:path";
import {
  SUBPROCESS_SANDBOX_TOOL_NAMES,
  describeToolSandboxStatus,
} from "../../../src/lawmind/agent/dangerous-tool-policy.js";
import { getDeliverableSpec } from "../../../src/lawmind/deliverables/registry.js";
import { specRequiresReasoningGraphAtDraft } from "../../../src/lawmind/deliverables/reasoning-validator.js";
import { listDrafts } from "../../../src/lawmind/drafts/index.js";
import { readReasoningSnapshot } from "../../../src/lawmind/drafts/reasoning-snapshot.js";
import { evaluateTeamMemorySyncGate } from "../../../src/lawmind/memory/team-memory-sync.js";
import { buildMultitaskObservabilityReport } from "../../../src/lawmind/ops/multitask-observability.js";
import { checkTaskDraftConsistency } from "../../../src/lawmind/application/task-draft-consistency.js";
import {
  buildAuthorityCorpusSummary,
  type AuthorityCorpusSummary,
} from "../../../src/lawmind/retrieval/authority-health.js";
import { listTaskRecords } from "../../../src/lawmind/tasks/index.js";

export type { AuthorityCorpusSummary };

/** Sync authority endpoint contract for Doctor (no network). */
export function buildAuthorityCorpusHealthSummary(opts?: {
  endpoint?: string;
}): AuthorityCorpusSummary {
  return buildAuthorityCorpusSummary(opts);
}

export function countAuditJsonlFiles(workspaceDir: string): number {
  const dir = path.join(workspaceDir, "audit");
  try {
    return fs.readdirSync(dir).filter((n) => n.endsWith(".jsonl")).length;
  } catch {
    return 0;
  }
}

/** Persisted `ResearchBundle` sidecars next to draft JSON (`*.research.json`). */
export function countResearchSnapshots(workspaceDir: string): number {
  const dir = path.join(workspaceDir, "drafts");
  try {
    return fs.readdirSync(dir).filter((n) => n.endsWith(".research.json")).length;
  } catch {
    return 0;
  }
}

export type ReasoningGraphCoverage = {
  /** 需要 reasoning graph 侧车的草稿总数 */
  requiredDraftCount: number;
  /** 已写入 reasoning graph 侧车的草稿数 */
  withSnapshotCount: number;
  /** withSnapshotCount / requiredDraftCount；无样本时为 null */
  ratio: number | null;
};

/** P1-A：高风控（requiresReasoningGraphAtDraft）草稿的 reasoning graph 覆盖率。 */
export function buildReasoningGraphCoverage(workspaceDir: string): ReasoningGraphCoverage {
  const drafts = listDrafts(workspaceDir);
  let requiredDraftCount = 0;
  let withSnapshotCount = 0;
  for (const draft of drafts) {
    const spec = getDeliverableSpec(draft.deliverableType);
    if (!specRequiresReasoningGraphAtDraft(spec)) {
      continue;
    }
    requiredDraftCount += 1;
    const graph = readReasoningSnapshot(workspaceDir, draft.taskId);
    if (graph || draft.hasLegalReasoningSnapshot === true) {
      withSnapshotCount += 1;
    }
  }
  return {
    requiredDraftCount,
    withSnapshotCount,
    ratio: requiredDraftCount === 0 ? null : withSnapshotCount / requiredDraftCount,
  };
}

export type LawMindDoctorStats = {
  auditJsonlFileCount: number;
  researchSnapshotCount: number;
  taskCount: number;
  draftCount: number;
  reasoningGraphCoverage: ReasoningGraphCoverage;
};

export function buildDoctorStats(workspaceDir: string): LawMindDoctorStats {
  return {
    auditJsonlFileCount: countAuditJsonlFiles(workspaceDir),
    researchSnapshotCount: countResearchSnapshots(workspaceDir),
    taskCount: listTaskRecords(workspaceDir).length,
    draftCount: listDrafts(workspaceDir).length,
    reasoningGraphCoverage: buildReasoningGraphCoverage(workspaceDir),
  };
}

/** How many `clients/<id>/CLIENT_PROFILE.md` files exist (capped walk). */
export function countClientProfileFilesUnderClients(workspaceDir: string, maxScan = 200): number {
  const clientsDir = path.join(path.resolve(workspaceDir), "clients");
  if (!fs.existsSync(clientsDir) || !fs.statSync(clientsDir).isDirectory()) {
    return 0;
  }
  let n = 0;
  let scanned = 0;
  for (const name of fs.readdirSync(clientsDir)) {
    if (scanned++ >= maxScan) {
      break;
    }
    const p = path.join(clientsDir, name, "CLIENT_PROFILE.md");
    try {
      if (fs.existsSync(p) && fs.statSync(p).isFile()) {
        n += 1;
      }
    } catch {
      // ignore
    }
  }
  return n;
}

export type MemoryTruthSourceFlags = {
  memoryMd: boolean;
  lawyerProfile: boolean;
  firmProfile: boolean;
  /** Optional workspace-root file (rare; primary client profiles live under `clients/`). */
  clientProfileRoot: boolean;
  clientProfileFilesUnderClients: number;
};

/**
 * O(1) file probes for /api/health (sync; no content read). Paths align with
 * `loadMemoryContext` / `buildAgentMemorySourceReport`.
 */
export function buildMemoryTruthSourceFlags(workspaceDir: string): MemoryTruthSourceFlags {
  const root = path.resolve(workspaceDir);
  const f = (rel: string) => {
    const p = path.join(root, rel);
    try {
      return fs.existsSync(p) && fs.statSync(p).isFile();
    } catch {
      return false;
    }
  };
  return {
    memoryMd: f("MEMORY.md"),
    lawyerProfile: f("LAWYER_PROFILE.md"),
    firmProfile: f("FIRM_PROFILE.md"),
    clientProfileRoot: f("CLIENT_PROFILE.md"),
    clientProfileFilesUnderClients: countClientProfileFilesUnderClients(root),
  };
}

/** 读取 monorepo 根 package.json 的 version（桌面 dev 传 LAWMIND_REPO_ROOT；打包后可能不可用）。 */
export type WorkspaceStandardCheck = {
  id: string;
  label: string;
  state: "ok" | "warn" | "missing";
  hint: string;
};

export type WorkspaceStandardReport = {
  ok: boolean;
  checks: WorkspaceStandardCheck[];
};

export function buildWorkspaceStandardReport(workspaceDir: string): WorkspaceStandardReport {
  const root = path.resolve(workspaceDir);
  const checks: WorkspaceStandardCheck[] = [];

  const fileCheck = (id: string, label: string, rel: string, hint: string): void => {
    const p = path.join(root, rel);
    let exists = false;
    try {
      exists = fs.existsSync(p) && fs.statSync(p).isFile();
    } catch {
      exists = false;
    }
    checks.push({
      id,
      label,
      state: exists ? "ok" : "missing",
      hint: exists ? "已就绪" : hint,
    });
  };

  const dirHasJson = (rel: string): boolean => {
    const d = path.join(root, rel);
    try {
      return (
        fs.existsSync(d) &&
        fs.statSync(d).isDirectory() &&
        fs.readdirSync(d).some((n) => n.endsWith(".json"))
      );
    } catch {
      return false;
    }
  };

  fileCheck("memory_md", "通用记忆 MEMORY.md", "MEMORY.md", "建议保留 workspace/MEMORY.md 作为长期规则。");
  fileCheck(
    "lawyer_profile",
    "律师偏好 LAWYER_PROFILE.md",
    "LAWYER_PROFILE.md",
    "可在首跑向导中生成律师偏好文件。",
  );

  const policyPath = path.join(root, "lawmind", "policy.json");
  let policyOk = false;
  try {
    policyOk = fs.existsSync(policyPath) && fs.statSync(policyPath).isFile();
  } catch {
    policyOk = false;
  }
  if (!policyOk) {
    const alt = path.join(root, "lawmind.policy.json");
    try {
      policyOk = fs.existsSync(alt) && fs.statSync(alt).isFile();
    } catch {
      policyOk = false;
    }
  }
  checks.push({
    id: "policy",
    label: "工作区策略",
    state: policyOk ? "ok" : "warn",
    hint: policyOk ? "已就绪" : "可选：添加 lawmind/policy.json 或 lawmind.policy.json。",
  });

  const wfOk = dirHasJson("lawmind/workflows");
  checks.push({
    id: "workflows",
    label: "工作流模板",
    state: wfOk ? "ok" : "warn",
    hint: wfOk ? "已就绪" : "建议添加 lawmind/workflows/*.json（仓库已含示例）。",
  });

  const tplOk = (() => {
    const d = path.join(root, "templates", "word");
    try {
      return fs.existsSync(d) && fs.statSync(d).isDirectory();
    } catch {
      return false;
    }
  })();
  checks.push({
    id: "word_templates",
    label: "Word 模板目录",
    state: tplOk ? "ok" : "warn",
    hint: tplOk ? "已就绪" : "建议准备 templates/word/ 以便渲染 docx。",
  });

  const ok = checks.every((c) => c.state === "ok");
  return { ok, checks };
}

export type P2DoctorReport = {
  toolSandbox: {
    enabled: boolean;
    source: "env" | "policy" | "off";
    sandboxedToolNames: string[];
  };
  teamMemorySync: {
    allowed: boolean;
    reason: string;
  };
};

/** P2 Doctor: subprocess tool sandbox + firm-only team memory sync gate (no network). */
export function buildP2DoctorReport(workspaceDir: string): P2DoctorReport {
  const sandbox = describeToolSandboxStatus(workspaceDir);
  const gate = evaluateTeamMemorySyncGate(workspaceDir);
  return {
    toolSandbox: {
      enabled: sandbox.enabled,
      source: sandbox.source,
      sandboxedToolNames: [...SUBPROCESS_SANDBOX_TOOL_NAMES],
    },
    teamMemorySync: {
      allowed: gate.allowed,
      reason: gate.reason,
    },
  };
}

export function tryReadWorkspacePackageVersion(repoRoot: string | undefined): string | null {
  const raw = repoRoot?.trim();
  if (!raw) {
    return null;
  }
  try {
    const pkgPath = path.join(path.resolve(raw), "package.json");
    const j = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as { version?: string };
    return typeof j.version === "string" ? j.version : null;
  } catch {
    return null;
  }
}

export type MatterConsistencySummary = {
  ok: boolean;
  issueCount: number;
  issues: Array<{ matterId: string; code: string; message: string }>;
};

export type TaskDraftConsistencySummary = {
  ok: boolean;
  issueCount: number;
  issues: Array<{ taskId: string; code: string; message: string }>;
};

export type MultitaskObservabilitySummary = {
  windowDays: number;
  jobsTotal: number;
  jobsInWindow: number;
  leadTimeP50Ms: number | null;
  leadTimeP90Ms: number | null;
  retryRate: number;
  cancelRate: number;
  failureRate: number;
  conflictRate: number;
  notes: string[];
};

const MATTER_CONSISTENCY_HEALTH_LIMIT = 12;

/** Async matter JSON ↔ CASE.md summary for /api/health (capped issue list). */
export async function buildMatterConsistencySummary(
  workspaceDir: string,
): Promise<MatterConsistencySummary> {
  const { checkMatterConsistency } = await import(
    "../../../src/lawmind/application/matter-consistency.js"
  );
  const all = await checkMatterConsistency(workspaceDir);
  return {
    ok: all.length === 0,
    issueCount: all.length,
    issues: all.slice(0, MATTER_CONSISTENCY_HEALTH_LIMIT).map((i) => ({
      matterId: i.matterId,
      code: i.code,
      message: i.message,
    })),
  };
}

/** Sync task ↔ draft consistency for /api/health. */
export function buildTaskDraftConsistencySummary(
  workspaceDir: string,
): TaskDraftConsistencySummary {
  const all = checkTaskDraftConsistency(workspaceDir);
  return {
    ok: all.length === 0,
    issueCount: all.length,
    issues: all.slice(0, MATTER_CONSISTENCY_HEALTH_LIMIT).map((i) => ({
      taskId: i.taskId,
      code: i.code,
      message: i.message,
    })),
  };
}

/** Jobs window metrics for Doctor (read-only). */
export function buildMultitaskObservabilitySummary(
  workspaceDir: string,
  windowDays = 14,
): MultitaskObservabilitySummary {
  const report = buildMultitaskObservabilityReport({ workspaceDir, windowDays });
  return {
    windowDays: report.windowDays,
    jobsTotal: report.sample.jobsTotal,
    jobsInWindow: report.sample.jobsInWindow,
    leadTimeP50Ms: report.metrics.leadTimeP50Ms,
    leadTimeP90Ms: report.metrics.leadTimeP90Ms,
    retryRate: report.metrics.retryRate,
    cancelRate: report.metrics.cancelRate,
    failureRate: report.metrics.failureRate,
    conflictRate: report.metrics.conflictRate,
    notes: report.notes.slice(0, 4),
  };
}
