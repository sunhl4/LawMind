import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { denyListMessage, isDeniedHostPath } from "./deny-list.js";
import { resolveHostAccessPolicy } from "./host-policy.js";
import {
  defaultHostAccessFilePath,
  isSessionCommandAllowed,
  listSessionGrants,
  migrateProjectDirToMounts,
  readHostAccessFile,
} from "./host-store.js";
import { activeMountsForSession, workspaceOtherMatterDenied } from "./matter-fence.js";
import { isUnderRoot, realpathOrResolve, toPosixRel } from "./paths.js";
export { redactHostPath } from "./paths.js";
import type { HostAccessRuntime, HostGrant, HostMount, ResolvedHostPath } from "./types.js";

export type BuildHostRuntimeInput = {
  workspaceDir: string;
  sessionId: string;
  matterId?: string;
  projectDir?: string;
  hostMounts?: HostMount[];
  hostGrants?: HostGrant[];
  hostSessionCommandAllowed?: boolean;
  hostAccessFile?: string;
  edition?: HostAccessRuntime["edition"];
  homeDir?: string;
  env?: NodeJS.ProcessEnv;
};

export function buildHostAccessRuntime(input: BuildHostRuntimeInput): HostAccessRuntime {
  const storePath = input.hostAccessFile?.trim() || defaultHostAccessFilePath();
  const disk = readHostAccessFile(storePath);
  const mounts = input.hostMounts?.length
    ? input.hostMounts
    : migrateProjectDirToMounts(input.projectDir, disk.mounts);
  const policy = resolveHostAccessPolicy(
    input.workspaceDir,
    input.env ?? process.env,
    input.edition,
  );
  const grants = [
    ...(input.hostGrants ?? []),
    ...listSessionGrants(input.sessionId),
    ...disk.persistentGrants,
  ];
  return {
    workspaceDir: path.resolve(input.workspaceDir),
    sessionId: input.sessionId,
    matterId: input.matterId,
    edition: input.edition,
    policy,
    mounts,
    grants,
    sessionCommandAllowed:
      input.hostSessionCommandAllowed === true || isSessionCommandAllowed(input.sessionId),
    homeDir: input.homeDir ?? os.homedir(),
    storePath,
    logDir: path.dirname(storePath),
    indexDir: path.join(path.dirname(storePath), "host-index"),
  };
}

function grantCovers(grant: HostGrant, abs: string, write: boolean): boolean {
  if (write && grant.kind !== "write") {
    return false;
  }
  return isUnderRoot(grant.absPath, abs);
}

export function resolveHostPath(
  runtime: HostAccessRuntime,
  raw: string,
  opts?: { write?: boolean; allowLocateHint?: boolean },
): ResolvedHostPath {
  const trimmed = raw.trim().replace(/^["'`]+|["'`]+$/g, "");
  if (!trimmed || trimmed.includes("\0")) {
    return { ok: false, error: "empty", message: "路径为空。" };
  }
  const claimed = path.resolve(trimmed);
  const real = realpathOrResolve(claimed);
  const write = opts?.write === true;

  const denyOpts = {
    homeDir: runtime.homeDir,
    extraPatterns: runtime.policy.denyPathPatterns,
    workspaceDir: runtime.workspaceDir,
  };
  if (isDeniedHostPath(claimed, denyOpts) || isDeniedHostPath(real, denyOpts)) {
    return { ok: false, error: "deny_list", message: denyListMessage() };
  }

  if (workspaceOtherMatterDenied(runtime.workspaceDir, real, runtime.matterId)) {
    return {
      ok: false,
      error: "cross_matter_denied",
      message: "该路径属于其他案件，本案不能读取。如需核对利益冲突，请用利益冲突检索。",
    };
  }

  if (isUnderRoot(runtime.workspaceDir, real)) {
    return {
      ok: true,
      abs: real,
      rel: toPosixRel(runtime.workspaceDir, real),
      rootKind: "workspace",
      writable: true,
    };
  }

  const { active, blocked } = activeMountsForSession({
    mounts: runtime.mounts,
    workspaceDir: runtime.workspaceDir,
    sessionMatterId: runtime.matterId,
    allowCrossMatterMounts: runtime.policy.allowCrossMatterMounts,
    mode: runtime.policy.mode,
  });

  const blockedHit = blocked.find((row) => isUnderRoot(row.mount.absPath, real));
  if (blockedHit) {
    if (blockedHit.reason === "ethical_wall") {
      return {
        ok: false,
        error: "ethical_wall",
        message: "该本机文件夹绑定的案件与本案当事人对立，已按利益冲突隔离。",
      };
    }
    if (blockedHit.reason === "cross_matter") {
      return {
        ok: false,
        error: "cross_matter_denied",
        message: "该本机文件夹已绑定其他案件。未打开「允许对照旧案材料」时不能读取正文。",
      };
    }
    return {
      ok: false,
      error: "mode_denied",
      message: "当前本机能力为「仅本案」，请先在设置里改成已选文件夹。",
    };
  }

  for (const mount of active) {
    if (isUnderRoot(mount.absPath, real)) {
      if (write) {
        return {
          ok: false,
          error: "write_forbidden",
          message: "本机文件夹默认不能改写。请使用「收进本案」复制到案件目录。",
        };
      }
      return {
        ok: true,
        abs: real,
        rel: toPosixRel(mount.absPath, real),
        rootKind: "mount",
        rootId: mount.id,
        writable: false,
      };
    }
  }

  const grant = runtime.grants.find((g) => grantCovers(g, real, write));
  if (grant) {
    return {
      ok: true,
      abs: real,
      rel: path.basename(real),
      rootKind: "grant",
      rootId: grant.id,
      writable: grant.kind === "write",
    };
  }

  if (write) {
    return {
      ok: false,
      error: "write_forbidden",
      message: "写入只允许工作区。本机路径请先收进本案。",
    };
  }

  if (
    opts?.allowLocateHint ||
    runtime.policy.mode === "locate" ||
    runtime.policy.mode === "command"
  ) {
    return {
      ok: false,
      error: "needs_grant",
      message: `尚未允许读取「${path.basename(real)}」（位于 ${path.basename(path.dirname(real))}）。请律师选择允许一次、本会话允许或始终允许。`,
    };
  }

  return {
    ok: false,
    error: "escape",
    message: "该路径不在工作区或已选本机文件夹内。请先选择本机文件夹，或改用本机查找。",
  };
}

export function hostPathExists(abs: string): boolean {
  try {
    return fs.existsSync(abs);
  } catch {
    return false;
  }
}

export function allowedRootsForCommands(runtime: HostAccessRuntime): string[] {
  const { active } = activeMountsForSession({
    mounts: runtime.mounts,
    workspaceDir: runtime.workspaceDir,
    sessionMatterId: runtime.matterId,
    allowCrossMatterMounts: runtime.policy.allowCrossMatterMounts,
    mode: runtime.policy.mode === "matter" ? "mounts" : runtime.policy.mode,
  });
  return [runtime.workspaceDir, ...active.map((m) => path.resolve(m.absPath))];
}
