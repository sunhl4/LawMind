/**
 * 案件 ID 校验 — 与桌面 API、引擎 engine-tools 的 matter_id 规则一致，
 * 避免路径穿越与非可移植目录名。
 */

/** 字母或数字开头，后续为字母、数字、点、下划线、连字符；总长 2–128。 */
export const MATTER_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{1,127}$/;

export function isValidMatterId(raw: string): boolean {
  return MATTER_ID_PATTERN.test(raw.trim());
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
