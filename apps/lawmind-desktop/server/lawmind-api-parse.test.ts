import type http from "node:http";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { parseJsonBodyZod } from "./lawmind-api-parse.js";
import { modelsTestRequestSchema } from "./lawmind-api-schemas.js";

function mockJsonReq(payload: unknown): http.IncomingMessage {
  const req = { method: "POST", headers: {} } as http.IncomingMessage;
  Object.assign(req, {
    on(event: string, handler: (...args: unknown[]) => void) {
      if (event === "data") {
        handler(Buffer.from(JSON.stringify(payload)));
      }
      if (event === "end") {
        handler();
      }
      return this;
    },
  });
  return req;
}

describe("parseJsonBodyZod", () => {
  it("parses models test body", async () => {
    const body = await parseJsonBodyZod(mockJsonReq({ modelId: " builtin:qwen " }), modelsTestRequestSchema);
    expect(body.modelId).toBe("builtin:qwen");
  });

  it("accepts empty object for optional fields", async () => {
    const body = await parseJsonBodyZod(mockJsonReq({}), modelsTestRequestSchema);
    expect(body.modelId).toBeUndefined();
  });

  it("rejects non-string modelId", async () => {
    await expect(parseJsonBodyZod(mockJsonReq({ modelId: 1 }), modelsTestRequestSchema)).rejects.toMatchObject({
      code: "invalid_request_body",
      status: 400,
    });
  });

  it("rejects unknown keys when schema is strict", async () => {
    const strict = z.object({ ok: z.literal(true) }).strict();
    await expect(parseJsonBodyZod(mockJsonReq({ ok: true, extra: 1 }), strict)).rejects.toMatchObject({
      code: "invalid_request_body",
    });
  });
});
