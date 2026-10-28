/**
 * 剧本三色分流的「引用回读核对」。
 *
 * `playbook-triage.ts` 只能确认「有 quote + 有位置」；这里把 quote 拿回工作区里的
 * 来源文件重新找一遍，核不上的引用不许继续算 PASS/FAIL。
 *
 * 为什么不放进 `playbook-triage.ts`：那个模块被桌面渲染进程共享，
 * 这里依赖 `node:fs`（经 `drafts/evidence-support`），必须留在引擎侧。
 */

import path from "node:path";
import { checkEvidenceSupportAsync } from "../drafts/evidence-support.js";
import {
  triageAgainstPlaybook,
  type Playbook,
  type PlaybookEvidenceVerification,
  type PlaybookObservation,
  type PlaybookOverride,
  type PlaybookTriage,
} from "./playbook-triage.js";

export type PlaybookEvidenceCheckStatus = "verified" | "failed" | "unverifiable";

export type PlaybookEvidenceCheck = {
  criterionId: string;
  /** 材料相对路径；没有路径时为空串。 */
  filePath: string;
  status: PlaybookEvidenceCheckStatus;
  reasonZh: string;
};

export type VerifiedPlaybookObservations = {
  /** 回读后可能被降级为 FLAG 的观测。 */
  observations: PlaybookObservation[];
  /** 逐条核对记录；同一文件同一句只回读一次。 */
  checks: PlaybookEvidenceCheck[];
  summary: PlaybookEvidenceVerification;
};

const EMPTY_SUMMARY: PlaybookEvidenceVerification = {
  checked: 0,
  verified: 0,
  failed: 0,
  unverifiable: 0,
  uncheckedEvidence: 0,
};

function asFlag(observation: PlaybookObservation, reasonZh: string): PlaybookObservation {
  return { ...observation, result: "FLAG", reasonZh };
}

/**
 * 回读核对观测里的引用。
 *
 * 规则：
 * - PASS / FAIL 必须带 `filePath` 才能回读；没有路径按未核对降级（不影响 FLAG）。
 * - 原句在文件里找到 → 保留原结论；找不到 / 文件没了 / 版本变了 → 降级 FLAG。
 * - 格式读不了（扫描 PDF、加密文档）→ 降级 FLAG，理由照实说「无法核」。
 * - FLAG 本身不是通过，不回读也不改。
 */
export async function verifyPlaybookObservations(input: {
  workspaceDir: string;
  observations?: readonly PlaybookObservation[];
  /** 材料路径的解析基准；缺省 `workspaceDir`。 */
  rootDir?: string;
}): Promise<VerifiedPlaybookObservations> {
  const rootDir = path.resolve(input.rootDir?.trim() || input.workspaceDir);
  const cache = new Map<string, { status: PlaybookEvidenceCheckStatus; reasonZh: string }>();
  const observations: PlaybookObservation[] = [];
  const checks: PlaybookEvidenceCheck[] = [];
  const summary: PlaybookEvidenceVerification = { ...EMPTY_SUMMARY };

  for (const observation of input.observations ?? []) {
    if (observation.result === "FLAG") {
      observations.push(observation);
      continue;
    }

    const evidence = observation.evidence;
    const filePath = evidence?.filePath?.trim() ?? "";
    if (!filePath) {
      summary.uncheckedEvidence += 1;
      const reasonZh = "引用没有文件路径，无法回读核对；按未核对处理。";
      observations.push(asFlag(observation, reasonZh));
      checks.push({
        criterionId: observation.criterionId,
        filePath: "",
        status: "unverifiable",
        reasonZh,
      });
      continue;
    }

    const key = `${filePath}#${evidence?.locator?.trim() ?? ""}\u0000${evidence?.quote ?? ""}`;
    let cached = cache.get(key);
    if (!cached) {
      // 位置一并带上：能核到具体行/页/单元格，就不只核整份文件。
      const locator = evidence?.locator?.trim() ?? "";
      const relPath = locator && !filePath.includes("#") ? `${filePath}#${locator}` : filePath;
      const support = await checkEvidenceSupportAsync({
        rootDir,
        relPath,
        ...(evidence?.quote ? { quote: evidence.quote } : {}),
      });
      cached =
        support.status === "supported"
          ? { status: "verified", reasonZh: "原句已在来源文件里找到。" }
          : support.status === "unverifiable"
            ? { status: "unverifiable", reasonZh: support.reasonZh }
            : { status: "failed", reasonZh: support.reasonZh };
      cache.set(key, cached);
      summary.checked += 1;
      summary[cached.status] += 1;
    }

    checks.push({
      criterionId: observation.criterionId,
      filePath,
      status: cached.status,
      reasonZh: cached.reasonZh,
    });
    observations.push(
      cached.status === "verified"
        ? observation
        : asFlag(observation, `引用回读未通过：${cached.reasonZh}`),
    );
  }

  return { observations, checks, summary };
}

/**
 * 回读核对 + 三色分流。剧本或条件为空时直接返回默认口径，不做无意义的 IO。
 */
export async function triageWithVerifiedEvidence(input: {
  workspaceDir: string;
  playbook?: Playbook | null;
  observations?: readonly PlaybookObservation[];
  override?: PlaybookOverride | null;
  rootDir?: string;
}): Promise<PlaybookTriage> {
  const playbook = input.playbook ?? null;
  const observations = input.observations ?? [];

  if (!playbook || playbook.criteria.length === 0) {
    return {
      ...triageAgainstPlaybook({ playbook, observations, override: input.override ?? null }),
      evidenceVerification: { ...EMPTY_SUMMARY },
    };
  }

  const knownIds = new Set(playbook.criteria.map((criterion) => criterion.id));
  const relevant: PlaybookObservation[] = [];
  const unknown: PlaybookObservation[] = [];
  for (const observation of observations) {
    (knownIds.has(observation.criterionId.trim()) ? relevant : unknown).push(observation);
  }

  const verified = await verifyPlaybookObservations({
    workspaceDir: input.workspaceDir,
    observations: relevant,
    ...(input.rootDir ? { rootDir: input.rootDir } : {}),
  });
  const triage = triageAgainstPlaybook({
    playbook,
    observations: [...verified.observations, ...unknown],
    override: input.override ?? null,
  });
  return { ...triage, evidenceVerification: verified.summary };
}
