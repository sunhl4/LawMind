/**
 * 工作台「卷」里的路径：来件是案件相对（materials/…），
 * 文书 / 其余可能是工作区相对、cases/…，或绝对路径。
 * 打开本机应用或中栏预览前，先归一成工作区相对路径。
 */
import { toWorkspaceRelativePath } from "./lawmind-workspace-relpath";

const MATTER_SCOPED_PREFIX =
  /^(materials|deliverables|mail|notes|intake|workproduct|attachments)\//i;

export function resolveDeskVolumeWorkspacePath(
  matterId: string | null | undefined,
  label: string,
  workspaceDir?: string | null,
): string | null {
  const raw = label.trim().replace(/\\/g, "/");
  if (!raw || raw.includes("..")) {
    return null;
  }
  if (/^[A-Za-z]:\//.test(raw) || raw.startsWith("/")) {
    return toWorkspaceRelativePath(workspaceDir, raw);
  }
  const rel = raw.replace(/^\.\//, "");
  if (rel.startsWith("cases/")) {
    return rel;
  }
  const mid = matterId?.trim() ?? "";
  if (mid && MATTER_SCOPED_PREFIX.test(rel)) {
    return `cases/${mid}/${rel}`;
  }
  return rel;
}

export function isDeskWordPath(label: string): boolean {
  return /\.docx?$/i.test(label.trim());
}

export function isDeskNativeOfficePath(label: string): boolean {
  return /\.(?:doc|docx|wps|xls|xlsx|et|ppt|pptx|dps|pdf)$/i.test(label.trim());
}

export function isDeskPreviewablePath(label: string): boolean {
  const t = label.trim();
  if (!t) {
    return false;
  }
  return (
    isDeskWordPath(t) ||
    /\.(?:md|txt|csv|json|html|png|jpe?g|webp|gif|canvas\.tsx)$/i.test(t) ||
    /[\\/]/.test(t)
  );
}
