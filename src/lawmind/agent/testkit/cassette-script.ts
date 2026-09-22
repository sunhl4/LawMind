/**
 * Semantic cassette rounds. The HTTP server renders JSON or SSE from these
 * based on the live request's `stream` flag — one script, both transports.
 */

export type CassetteToolCall = {
  name: string;
  arguments?: Record<string, unknown>;
  id?: string;
};

export type CassetteRound =
  | { kind: "assistant"; content: string }
  | { kind: "tool_calls"; calls: CassetteToolCall[] }
  | { kind: "http_error"; status: number; body?: string };

export function cassetteAssistant(content: string): CassetteRound {
  return { kind: "assistant", content };
}

export function cassetteToolCall(name: string, args: Record<string, unknown> = {}): CassetteRound {
  return { kind: "tool_calls", calls: [{ name, arguments: args }] };
}

export function cassetteToolCalls(calls: CassetteToolCall[]): CassetteRound {
  return { kind: "tool_calls", calls };
}

export function cassetteHttpError(status: number, body?: string): CassetteRound {
  return { kind: "http_error", status, body };
}

export function lastDraftTaskIdFromRequestBody(body: string): string {
  try {
    const parsed = JSON.parse(body) as { messages?: Array<{ role?: string; content?: string }> };
    for (const message of [...(parsed.messages ?? [])].toReversed()) {
      if (message.role !== "tool" || typeof message.content !== "string") {
        continue;
      }
      try {
        const content = JSON.parse(message.content) as {
          ok?: boolean;
          data?: { taskId?: unknown };
        };
        if (content.ok && typeof content.data?.taskId === "string" && content.data.taskId) {
          return content.data.taskId;
        }
      } catch {
        /* skip malformed tool message */
      }
    }
  } catch {
    /* skip malformed request */
  }
  return "";
}

export function resolveRuntimeTokens(value: unknown, taskId: string): unknown {
  if (value === "$lastDraftTaskId") {
    return taskId;
  }
  if (Array.isArray(value)) {
    return value.map((item) => resolveRuntimeTokens(item, taskId));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [
        k,
        resolveRuntimeTokens(v, taskId),
      ]),
    );
  }
  return value;
}
