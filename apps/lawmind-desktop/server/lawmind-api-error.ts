/**
 * Unified JSON error body for LawMind local API (stable `code` + user-facing `message`).
 */
import type http from "node:http";

export type LawMindApiErrorBody = {
  ok: false;
  /** Stable machine-readable code */
  code: string;
  /** User-facing message (Chinese in desktop context) */
  message: string;
  /** Legacy field; same as message when present */
  error: string;
  [key: string]: unknown;
};

export function jsonErrorBody(
  code: string,
  message: string,
  extra?: Record<string, unknown>,
): LawMindApiErrorBody {
  return {
    ok: false,
    code,
    message,
    error: message,
    ...extra,
  };
}

export function sendJsonError(
  res: http.ServerResponse,
  status: number,
  code: string,
  message: string,
  c: Record<string, string>,
  extra?: Record<string, unknown>,
): void {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    ...c,
  });
  res.end(JSON.stringify(jsonErrorBody(code, message, extra)));
}
