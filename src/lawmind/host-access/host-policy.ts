import { readWorkspacePolicyFile, type LawMindEdition } from "../policy/workspace-policy.js";
import type { ResolvedHostAccessPolicy } from "./types.js";

export const DEFAULT_HOST_ACCESS_POLICY: ResolvedHostAccessPolicy = {
  mode: "command",
  maxMounts: 16,
  spotlightEnabled: true,
  fullDiskAccessOptIn: false,
  allowHostCommands: true,
  hostCommandLevel: "session",
  fileTaskReadBudget: 16,
  fileTaskReadHardCap: 48,
  denyPathPatterns: [],
  allowCrossMatterMounts: true,
  indexBodyInAppSupport: true,
  forceMatterMode: false,
  allowSessionCommands: true,
};

function asInt(raw: unknown, fallback: number, min: number, max: number): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.floor(raw)));
}

export function resolveHostAccessPolicy(
  workspaceDir: string,
  env: NodeJS.ProcessEnv = process.env,
  edition?: LawMindEdition,
): ResolvedHostAccessPolicy {
  void env;
  void edition;
  const policy = readWorkspacePolicyFile(workspaceDir);
  const host = policy?.hostAccess;

  const resolved: ResolvedHostAccessPolicy = {
    // 范围、命令、跨案读取默认放开。策略文件里旧的档位和开关不再把任务链路卡死。
    mode: DEFAULT_HOST_ACCESS_POLICY.mode,
    maxMounts: asInt(host?.maxMounts, DEFAULT_HOST_ACCESS_POLICY.maxMounts, 1, 32),
    spotlightEnabled: true,
    fullDiskAccessOptIn: host?.fullDiskAccessOptIn === true,
    allowHostCommands: true,
    hostCommandLevel: DEFAULT_HOST_ACCESS_POLICY.hostCommandLevel,
    fileTaskReadBudget: asInt(
      host?.fileTaskReadBudget,
      DEFAULT_HOST_ACCESS_POLICY.fileTaskReadBudget,
      1,
      64,
    ),
    fileTaskReadHardCap: asInt(
      host?.fileTaskReadHardCap,
      DEFAULT_HOST_ACCESS_POLICY.fileTaskReadHardCap,
      4,
      128,
    ),
    denyPathPatterns: Array.isArray(host?.denyPathPatterns)
      ? host.denyPathPatterns.filter(
          (p): p is string => typeof p === "string" && p.trim().length > 0,
        )
      : [],
    allowCrossMatterMounts: true,
    indexBodyInAppSupport: host?.indexBodyInAppSupport !== false,
    forceMatterMode: false,
    allowSessionCommands: true,
  };

  if (resolved.fileTaskReadHardCap < resolved.fileTaskReadBudget) {
    resolved.fileTaskReadHardCap = resolved.fileTaskReadBudget;
  }
  return resolved;
}
