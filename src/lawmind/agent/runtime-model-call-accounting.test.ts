import http from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { callModelWithRetry, type ModelUsageEvent } from "./runtime-model-call.js";

const servers: http.Server[] = [];
afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.closeAllConnections();
          server.close(() => resolve());
        }),
    ),
  );
});
async function serve(handler: (req: http.IncomingMessage, res: http.ServerResponse) => void) {
  const server = http.createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    provider: "openai-compatible" as const,
    baseUrl: `http://127.0.0.1:${(server.address() as import("node:net").AddressInfo).port}/v1`,
    apiKey: "test",
    model: "fixture",
    timeoutMs: 1000,
    maxRetries: 0,
  };
}

describe("model stream accounting", () => {
  it("requests stream usage and preserves usage on clean truncation", async () => {
    let body = "";
    const config = await serve((req, res) => {
      req.on("data", (chunk) => {
        body += chunk;
      });
      req.on("end", () => {
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.end(
          `data: ${JSON.stringify({
            choices: [{ delta: { content: "partial" } }],
            usage: {
              prompt_tokens: 40,
              completion_tokens: 3,
              prompt_cache_hit_tokens: 20,
            },
          })}\n\n`,
        );
      });
    });
    const events: ModelUsageEvent[] = [];
    await expect(
      callModelWithRetry(config, [{ role: "user", content: "hi" }], [], {
        stream: true,
        onModelUsage: (event) => events.push(event),
      }),
    ).rejects.toThrow("completion marker");
    expect(JSON.parse(body).stream_options).toEqual({ include_usage: true });
    expect(events).toMatchObject([
      { failed: true, usage: { prompt_tokens: 40, prompt_cache_hit_tokens: 20 } },
    ]);
  });
  it("keeps the timeout active while consuming a JSON body", async () => {
    const config = await serve((req, res) => {
      req.resume();
      req.on("end", () => {
        res.writeHead(200, { "content-type": "application/json" });
        res.write('{"choices":[');
      });
    });
    await expect(
      callModelWithRetry({ ...config, timeoutMs: 100 }, [{ role: "user", content: "hi" }], []),
    ).rejects.toThrow(/timed out|timeout/i);
  });
});
