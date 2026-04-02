import { PassThrough } from "node:stream";
import type http from "node:http";
import { describe, expect, it } from "vitest";
import {
  isLawMindHttpError,
  MAX_JSON_BODY_BYTES,
  readJsonBody,
} from "./lawmind-server-helpers.js";

function createRequest(body: string): http.IncomingMessage {
  const stream = new PassThrough();
  stream.end(body, "utf8");
  return stream as unknown as http.IncomingMessage;
}

describe("lawmind-server-helpers", () => {
  it("readJsonBody parses valid json", async () => {
    await expect(readJsonBody(createRequest('{"ok":true,"value":1}'))).resolves.toEqual({
      ok: true,
      value: 1,
    });
  });

  it("readJsonBody rejects invalid json with structured error", async () => {
    try {
      await readJsonBody(createRequest("{invalid"));
      throw new Error("expected invalid json to reject");
    } catch (error) {
      expect(isLawMindHttpError(error)).toBe(true);
      if (isLawMindHttpError(error)) {
        expect(error.code).toBe("invalid_json");
        expect(error.status).toBe(400);
      }
    }
  });

  it("readJsonBody rejects oversized payloads", async () => {
    try {
      await readJsonBody(createRequest(`{"data":"${"x".repeat(MAX_JSON_BODY_BYTES)}"}`));
      throw new Error("expected oversized json to reject");
    } catch (error) {
      expect(isLawMindHttpError(error)).toBe(true);
      if (isLawMindHttpError(error)) {
        expect(error.code).toBe("body_too_large");
        expect(error.status).toBe(413);
      }
    }
  });
});
