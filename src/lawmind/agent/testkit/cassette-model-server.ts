/**
 * Local OpenAI-compatible chat.completions server for true-loop cassettes.
 *
 * SSE bytes are fake; the request goes through LawMind's real outbound proxy,
 * retry, and SSE aggregator. Tools / gates / the next request body are real.
 * Exhausting the cassette is a 400 (not retried, not silently completed).
 */

import http from "node:http";
import { snapshotFromRawBody, type ModelRequestSnapshot } from "./cassette-inspect.js";
import type { CassetteRound, CassetteToolCall } from "./cassette-script.js";

export type CassetteModelServerOptions = {
  /** Rewrite tool-call arguments (e.g. `$lastDraftTaskId` from the request body). */
  resolveValue?: (value: unknown, rawBody: string) => unknown;
  onRequest?: (req: ModelRequestSnapshot) => void | Promise<void>;
};

export type CassetteModelServer = {
  url: string;
  requests: ModelRequestSnapshot[];
  remaining: () => number;
  enqueue: (...rounds: CassetteRound[]) => void;
  onRequest: (handler: (req: ModelRequestSnapshot) => void | Promise<void>) => void;
  close: () => Promise<void>;
};

function sseEvent(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

function applyResolve(
  value: unknown,
  rawBody: string,
  resolveValue?: CassetteModelServerOptions["resolveValue"],
): unknown {
  return resolveValue ? resolveValue(value, rawBody) : value;
}

function toolCallsPayload(
  calls: CassetteToolCall[],
  requestIndex: number,
  remainingAfterShift: number,
  rawBody: string,
  resolveValue?: CassetteModelServerOptions["resolveValue"],
): Array<{ id: string; type: "function"; function: { name: string; arguments: string } }> {
  return calls.map((tc, index) => ({
    id: tc.id ?? `cassette_call_${requestIndex}_${remainingAfterShift}_${index}`,
    type: "function" as const,
    function: {
      name: tc.name,
      arguments: JSON.stringify(applyResolve(tc.arguments ?? {}, rawBody, resolveValue) ?? {}),
    },
  }));
}

function renderJson(
  round: CassetteRound,
  requestIndex: number,
  remainingAfterShift: number,
  rawBody: string,
  resolveValue?: CassetteModelServerOptions["resolveValue"],
): { status: number; contentType: string; body: string } {
  if (round.kind === "http_error") {
    return {
      status: round.status,
      contentType: "application/json",
      body: round.body ?? JSON.stringify({ error: "cassette http_error" }),
    };
  }
  if (round.kind === "assistant") {
    return {
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        choices: [
          {
            message: { role: "assistant", content: round.content },
            finish_reason: "stop",
          },
        ],
      }),
    };
  }
  const tool_calls = toolCallsPayload(
    round.calls,
    requestIndex,
    remainingAfterShift,
    rawBody,
    resolveValue,
  );
  return {
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      choices: [
        {
          message: { role: "assistant", content: "", tool_calls },
          finish_reason: "tool_calls",
        },
      ],
    }),
  };
}

function renderSse(
  round: CassetteRound,
  requestIndex: number,
  remainingAfterShift: number,
  rawBody: string,
  resolveValue?: CassetteModelServerOptions["resolveValue"],
): { status: number; contentType: string; body: string } {
  if (round.kind === "http_error") {
    return renderJson(round, requestIndex, remainingAfterShift, rawBody, resolveValue);
  }
  const chunks: string[] = [];
  if (round.kind === "assistant") {
    chunks.push(sseEvent({ choices: [{ delta: { role: "assistant" } }] }));
    const text = round.content;
    if (text.length === 0) {
      chunks.push(sseEvent({ choices: [{ delta: { content: "" } }] }));
    } else {
      for (let i = 0; i < text.length; i += 24) {
        chunks.push(sseEvent({ choices: [{ delta: { content: text.slice(i, i + 24) } }] }));
      }
    }
    chunks.push(sseEvent({ choices: [{ finish_reason: "stop" }] }));
    chunks.push("data: [DONE]\n\n");
    return { status: 200, contentType: "text/event-stream", body: chunks.join("") };
  }
  const tool_calls = toolCallsPayload(
    round.calls,
    requestIndex,
    remainingAfterShift,
    rawBody,
    resolveValue,
  );
  chunks.push(sseEvent({ choices: [{ delta: { role: "assistant" } }] }));
  tool_calls.forEach((tc, index) => {
    chunks.push(
      sseEvent({
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index,
                  id: tc.id,
                  type: "function",
                  function: { name: tc.function.name, arguments: "" },
                },
              ],
            },
          },
        ],
      }),
    );
    chunks.push(
      sseEvent({
        choices: [
          {
            delta: {
              tool_calls: [{ index, function: { arguments: tc.function.arguments } }],
            },
          },
        ],
      }),
    );
  });
  chunks.push(sseEvent({ choices: [{ finish_reason: "tool_calls" }] }));
  chunks.push("data: [DONE]\n\n");
  return { status: 200, contentType: "text/event-stream", body: chunks.join("") };
}

function isChatCompletionsPath(url: string | undefined): boolean {
  const pathOnly = (url ?? "").split("?")[0] ?? "";
  return /\/chat\/completions\/?$/.test(pathOnly);
}

function writeError(res: http.ServerResponse, status: number, error: string): void {
  if (res.writableEnded) {
    return;
  }
  res.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify({ error }));
}

export async function startCassetteModelServer(
  opts: CassetteModelServerOptions = {},
): Promise<CassetteModelServer> {
  const queue: CassetteRound[] = [];
  const requests: ModelRequestSnapshot[] = [];
  const handlers: Array<(req: ModelRequestSnapshot) => void | Promise<void>> = [];
  if (opts.onRequest) {
    handlers.push(opts.onRequest);
  }
  let serving: Promise<void> = Promise.resolve();

  const server = http.createServer((req, res) => {
    if (req.method !== "POST" || !isChatCompletionsPath(req.url)) {
      req.resume();
      writeError(res, 404, "cassette only serves POST /v1/chat/completions");
      return;
    }
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
    });
    req.on("end", () => {
      serving = serving
        .then(async () => {
          const snapshot = snapshotFromRawBody(requests.length, raw);
          requests.push(snapshot);
          const round = queue.shift();
          for (const handler of handlers) {
            await handler(snapshot);
          }
          if (!round) {
            writeError(res, 400, "cassette exhausted");
            return;
          }
          const rendered = snapshot.streamed
            ? renderSse(round, snapshot.index, queue.length, raw, opts.resolveValue)
            : renderJson(round, snapshot.index, queue.length, raw, opts.resolveValue);
          res.writeHead(rendered.status, { "Content-Type": rendered.contentType });
          res.end(rendered.body);
        })
        .catch((err: unknown) => {
          const message = err instanceof Error ? err.message : String(err);
          writeError(res, 500, message);
        });
    });
  });

  await new Promise<void>((resolve, reject) => {
    const onError = (err: Error) => {
      reject(err);
    };
    server.once("error", onError);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", onError);
      resolve();
    });
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;

  return {
    url: `http://127.0.0.1:${port}/v1`,
    requests,
    remaining: () => queue.length,
    enqueue: (...rounds) => {
      queue.push(...rounds);
    },
    onRequest: (handler) => {
      handlers.push(handler);
    },
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}
