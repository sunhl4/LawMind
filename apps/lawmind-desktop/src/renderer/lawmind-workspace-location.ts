/**
 * 工作区路径上的位置提示。只提示，不拦截。
 * 同步盘会和案件副本叠成两套同步；网络共享上的检索索引容易写坏。
 * 外置本地盘不因「在 /Volumes 下」而提示。网络卷与剩余空间由主进程查操作系统后传入。
 */

/** 主进程 `inspectWorkspaceVolume` 的事实，渲染进程只负责解释。 */
export type WorkspaceVolumeFacts = {
  /** macOS `stat -f %T` 或 Linux 挂载表里的文件系统名。 */
  fstype?: string | null;
  /** Windows Win32_LogicalDisk.DriveType。4 = 网络盘。 */
  driveType?: number | null;
  freeBytes?: number | null;
};

/** 低于这个值才提示。健康磁盘不打扰。 */
export const WORKSPACE_LOW_SPACE_BYTES = 5 * 1024 * 1024 * 1024;

export type WorkspaceLocationCaution =
  | { kind: "cloud_sync"; label: string }
  | { kind: "network"; label: string };

const SYNC_MARKERS: Array<{ re: RegExp; label: string }> = [
  { re: /(?:^|\/)Library\/Mobile Documents(?:\/|$)/i, label: "iCloud" },
  { re: /(?:^|\/)iCloud(?: Drive)?(?:\/|$)/i, label: "iCloud" },
  { re: /(?:^|\/)CloudStorage\/iCloud/i, label: "iCloud" },
  { re: /(?:^|\/)Dropbox(?: \([^)]+\))?(?:\/|$)/i, label: "Dropbox" },
  { re: /(?:^|\/)CloudStorage\/Dropbox(?:\/|$)/i, label: "Dropbox" },
  { re: /(?:^|\/)OneDrive(?: - [^/]+)?(?:\/|$)/i, label: "OneDrive" },
  { re: /(?:^|\/)CloudStorage\/OneDrive[^/]*(?:\/|$)/i, label: "OneDrive" },
  { re: /(?:^|\/)Google Drive(?:\/|$)|(?:^|\/)CloudStorage\/GoogleDrive/i, label: "Google 云端硬盘" },
  { re: /(?:^|\/)Nutstore(?:\/|$)|(?:^|\/)坚果云(?:\/|$)/i, label: "坚果云" },
  { re: /(?:^|\/)Box(?: Sync)?(?:\/|$)|(?:^|\/)CloudStorage\/Box-/i, label: "Box" },
  { re: /(?:^|\/)Synology(?: ?Drive)?(?:\/|$)/i, label: "群晖 Drive" },
  { re: /(?:^|\/)Nextcloud(?:\/|$)/i, label: "Nextcloud" },
];

function normalizePath(absPath: string): string {
  return absPath.trim().replace(/\\/g, "/");
}

/** 网络共享（UNC / smb / nfs / afp / macOS /net）。不把 /Volumes 外置盘算进去。 */
function networkLabel(norm: string): string | null {
  if (/^(?:smb|nfs|afp|cifs):\/\//i.test(norm)) {
    return "网络共享";
  }
  if (/^\/\/[^/]+\/[^/]+/.test(norm)) {
    return "网络共享";
  }
  if (norm.startsWith('/net/')) {
    return "网络共享";
  }
  return null;
}

export function workspaceLocationCaution(absPath: string): WorkspaceLocationCaution | null {
  const norm = normalizePath(absPath);
  if (!norm) {
    return null;
  }
  const network = networkLabel(norm);
  if (network) {
    return { kind: "network", label: network };
  }
  for (const marker of SYNC_MARKERS) {
    if (marker.re.test(norm)) {
      return { kind: "cloud_sync", label: marker.label };
    }
  }
  return null;
}

export function workspaceCloudSyncLabel(absPath: string): string | null {
  const caution = workspaceLocationCaution(absPath);
  return caution?.kind === "cloud_sync" ? caution.label : null;
}

const NETWORK_FS_TYPES = new Set([
  "smbfs",
  "smb",
  "cifs",
  "nfs",
  "nfs4",
  "afpfs",
  "afp",
  "webdav",
  "davfs",
  "ftp",
  "sshfs",
  "fuse.sshfs",
  "fuse.rclone",
  "9p",
  "glusterfs",
  "ceph",
]);

const NETWORK_MESSAGE =
  "这个目录在网络共享上。案件检索放在网络盘上容易变慢或写坏，并且同一时刻只能有一台电脑在写。建议改到本机磁盘。仍可继续使用。";

const LOW_SPACE_MESSAGE =
  "这个磁盘剩余空间不足 5 GB。材料会越积越多，建议换一块更空的盘。仍可继续使用。";

/** 操作系统报的网络卷。U 盘（exfat / msdos / 可移动盘）不算。 */
export function isNetworkVolume(volume: WorkspaceVolumeFacts | null | undefined): boolean {
  if (!volume) {
    return false;
  }
  if (volume.driveType === 4) {
    return true;
  }
  const name = (volume.fstype ?? "").trim().toLowerCase();
  if (!name) {
    return false;
  }
  if (NETWORK_FS_TYPES.has(name) || name.startsWith("nfs")) {
    return true;
  }
  return name.includes("smb") || name.includes("cifs") || name.includes("webdav");
}

function isLowSpace(volume: WorkspaceVolumeFacts | null | undefined): boolean {
  const free = volume?.freeBytes;
  return typeof free === "number" && Number.isFinite(free) && free >= 0 && free < WORKSPACE_LOW_SPACE_BYTES;
}

/** 律师可见的一句提示。没有风险时返回 null。同步盘或网络共享优先于剩余空间。 */
export function workspaceLocationCautionMessage(
  absPath: string,
  volume?: WorkspaceVolumeFacts | null,
): string | null {
  const caution = workspaceLocationCaution(absPath);
  if (caution?.kind === "network" || (isNetworkVolume(volume) && caution?.kind !== "cloud_sync")) {
    return NETWORK_MESSAGE;
  }
  if (caution?.kind === "cloud_sync") {
    return `这个目录在 ${caution.label} 里。同步盘会和案件副本叠成两套同步，建议改到本机磁盘。仍可继续使用。`;
  }
  if (isLowSpace(volume)) {
    return LOW_SPACE_MESSAGE;
  }
  return null;
}
