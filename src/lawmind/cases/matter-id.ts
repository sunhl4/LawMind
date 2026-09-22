/**
 * 案件 ID 校验 — 与桌面 API、引擎 engine-tools 的 matter_id 规则一致，
 * 避免路径穿越与非可移植目录名。
 *
 * 支持中文等 Unicode 字母/数字，便于「文件夹名 = 案件名」。
 */

/** 字母或数字（含 Unicode）开头；后续可为字母、数字、点、下划线、连字符、空格；总长 2–128。 */
export const MATTER_ID_PATTERN = /^[\p{L}\p{N}][\p{L}\p{N}._\- ]{1,127}$/u;

export function isValidMatterId(raw: string): boolean {
  const t = raw.trim();
  if (!MATTER_ID_PATTERN.test(t)) {
    return false;
  }
  // 路径穿越与分隔符（正则未覆盖的边界）
  if (t.includes("..") || t.includes("/") || t.includes("\\") || t.includes("\0")) {
    return false;
  }
  return true;
}

/**
 * 若 `raw` 为非空字符串则校验并返回 trim 后的 ID；否则返回 `undefined`。
 * 用于 HTTP body：`matterId` 省略或 `""` 表示不关联案件。
 */
export function parseOptionalMatterId(raw: unknown): string | undefined {
  if (raw === undefined || raw === null) {
    return undefined;
  }
  if (typeof raw !== "string") {
    return undefined;
  }
  const t = raw.trim();
  if (!t) {
    return undefined;
  }
  if (!isValidMatterId(t)) {
    throw new Error("invalid_matter_id");
  }
  return t;
}
