import { readWorkspacePolicyFile, type LawMindEdition } from "../policy/workspace-policy.js";
import type { HostAccessMode, HostCommandLevel, ResolvedHostAccessPolicy } from "./types.js";

const MODES = new Set<HostAccessMode>(["matter", "mounts", "locate", "command"]);
const LEVELS = new Set<HostCommandLevel>(["office", "workspace", "session"]);

export const DEFAULT_HOST_ACCESS_POLICY: ResolvedHostAccessPolicy = {
  mode: "mounts",
  maxMounts: 16,
  spotlightEnabled: true,
  fullDiskAccessOptIn: false,
  allowHostCommands: false,
  hostCommandLevel: "office",
  fileTaskReadBudget: 12,
  fileTaskReadHardCap: 32,
  denyPathPatterns: [],
  allowCrossMatterMounts: false,
  indexBodyInAppSupport: true,
  forceMatterMode: false,
  allowSessionCommands: true,
};

function asMode(raw: unknown, fallback: HostAccessMode): HostAccessMode {
  return typeof raw === "string" && MODES.has(raw as HostAccessMode)
    ? (raw as HostAccessMode)
    : fallback;
}

function asLevel(raw: unknown, fallback: HostCommandLevel): HostCommandLevel {
  return typeof raw === "string" && LEVELS.has(raw as HostCommandLevel)
    ? (raw as HostCommandLevel)
    : fallback;
}

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
  const policy = readWorkspacePolicyFile(workspaceDir);
  const host = policy?.hostAccess;
  const packaged = env.LAWMIND_PACKAGED === "1";
  const envMode = packaged ? undefined : env.LAWMIND_HOST_ACCESS_MODE?.trim();
  const envCommands = !packaged && env.LAWMIND_HOST_COMMANDS?.trim() === "1";

  const firm = edition === "firm" || policy?.edition === "firm";
  const resolved: ResolvedHostAccessPolicy = {
    mode: asMode(envMode || host?.mode, DEFAULT_HOST_ACCESS_POLICY.mode),
    maxMounts: asInt(host?.maxMounts, DEFAULT_HOST_ACCESS_POLICY.maxMounts, 1, 32),
    spotlightEnabled: host?.spotlightEnabled !== false,
    fullDiskAccessOptIn: host?.fullDiskAccessOptIn === true,
    allowHostCommands: envCommands || host?.allowHostCommands === true,
    hostCommandLevel: asLevel(host?.hostCommandLevel, DEFAULT_HOST_ACCESS_POLICY.hostCommandLevel),
    fileTaskReadBudget: asInt(
      host?.fileTaskReadBudget,
      DEFAULT_HOST_ACCESS_POLICY.fileTaskReadBudget,
      1,
      32,
    ),
    fileTaskReadHardCap: asInt(
      host?.fileTaskReadHardCap,
      DEFAULT_HOST_ACCESS_POLICY.fileTaskReadHardCap,
      4,
      48,
    ),
    denyPathPatterns: Array.isArray(host?.denyPathPatterns)
      ? host.denyPathPatterns.filter(
          (p): p is string => typeof p === "string" && p.trim().length > 0,
        )
      : [],
    allowCrossMatterMounts: host?.allowCrossMatterMounts === true,
    indexBodyInAppSupport: host?.indexBodyInAppSupport !== false,
    forceMatterMode: host?.forceMatterMode === true,
    allowSessionCommands: firm
      ? host?.allowSessionCommands === true
      : host?.allowSessionCommands !== false,
  };

  if (resolved.forceMatterMode) {
    resolved.mode = "matter";
    resolved.allowHostCommands = false;
  }
  if (firm && resolved.hostCommandLevel === "session" && !resolved.allowSessionCommands) {
    resolved.hostCommandLevel = "workspace";
  }
  if (resolved.fileTaskReadHardCap < resolved.fileTaskReadBudget) {
    resolved.fileTaskReadHardCap = resolved.fileTaskReadBudget;
  }
  return resolved;
}
