import type http from "node:http";
import type { ZodType } from "zod";
import { readJsonBody } from "./lawmind-server-helpers.js";

export type LawmindRequestParseError = Error & {
  code: "invalid_request_body";
  status: 400;
  issues: string[];
};

/**
 * 把 zod 的 issue 压成一行行可读文本。
 *
 * 参数类型刻意写成 `readonly PropertyKey[]`：zod（v4）的 `issue.path` 是
 * `PropertyKey[]`，可能含 **symbol**。而 `Array#join` 会抛
 * `TypeError: Cannot convert a Symbol value to a string`——
 * 所以这里逐个元素用 `String()` 安全转换，而不是直接把整段 path 交给 join。
 * 之前声明的 `(string | number)[]` 比现实窄，正好把这条边界掩盖了。
 */
function formatZodIssues(issues: ReadonlyArray<{ path: readonly PropertyKey[]; message: string }>): string[] {
  return issues.map((issue) => {
    const path =
      issue.path.length > 0 ? issue.path.map((part) => String(part)).join(".") : "body";
    return `${path}: ${issue.message}`;
  });
}

function createParseError(issues: string[]): LawmindRequestParseError {
  const summary = issues.join("; ");
  const err = new Error(summary ? `请求体无效：${summary}` : "请求体无效") as LawmindRequestParseError;
  err.code = "invalid_request_body";
  err.status = 400;
  err.issues = issues;
  return err;
}

export function isInvalidRequestBodyError(err: unknown): err is LawmindRequestParseError {
  return (
    err instanceof Error &&
    "code" in err &&
    (err as LawmindRequestParseError).code === "invalid_request_body" &&
    "status" in err &&
    (err as LawmindRequestParseError).status === 400
  );
}

export async function parseJsonBodyZod<T>(
  req: http.IncomingMessage,
  schema: ZodType<T>,
): Promise<T> {
  const raw = await readJsonBody(req);
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw createParseError(formatZodIssues(parsed.error.issues));
  }
  return parsed.data;
}
