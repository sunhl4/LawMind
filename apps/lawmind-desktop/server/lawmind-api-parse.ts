import type http from "node:http";
import type { ZodType } from "zod";
import { readJsonBody } from "./lawmind-server-helpers.js";

export type LawmindRequestParseError = Error & {
  code: "invalid_request_body";
  status: 400;
  issues: string[];
};

function formatZodIssues(issues: { path: (string | number)[]; message: string }[]): string[] {
  return issues.map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join(".") : "body";
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
