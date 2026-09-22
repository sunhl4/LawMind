import { isValidMatterId } from "../../../../src/lawmind/cases/matter-id.ts";

/** 工作区相对路径 → `cases/<matterId>` 下的案件编号；无效或不在 cases 下则为 null。 */
export function matterIdFromWorkspaceCasesRelPath(relPath: string): string | null {
  const norm = relPath.replace(/^\/+/, "");
  if (!norm.startsWith("cases/")) {
    return null;
  }
  const rest = norm.slice("cases/".length);
  const seg = rest.split("/").filter(Boolean)[0];
  if (!seg || !isValidMatterId(seg)) {
    return null;
  }
  return seg;
}

/** 是否为 `cases/<合法 matterId>` 这一层目录（用于双击打开案件工作台）。 */
export function isWorkspaceCaseSubdirRootRelPath(relPath: string): boolean {
  const norm = relPath.replace(/^\/+/, "");
  const parts = norm.split("/").filter(Boolean);
  return (
    parts.length === 2 && parts[0] === "cases" && parts[1] !== undefined && isValidMatterId(parts[1])
  );
}
