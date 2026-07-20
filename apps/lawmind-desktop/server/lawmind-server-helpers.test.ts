import { PassThrough } from "node:stream";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type http from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildAgentConfig,
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
  const tmpDirs: string[] = [];
  afterEach(() => {
    for (const d of tmpDirs.splice(0)) {
      fs.rmSync(d, { recursive: true, force: true });
    }
  });

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
    } catch (error) {
      expect(isLawMindHttpError(error)).toBe(true);
      if (isLawMindHttpError(error)) {
        expect(error.code).toBe("body_too_large");
        expect(error.status).toBe(413);
      }
    }
  });

  it("buildAgentConfig preserves envFile for assistant root resolution", () => {
    const lawMindRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lm-cfg-env-"));
    tmpDirs.push(lawMindRoot);
    const workspaceDir = path.join(lawMindRoot, "workspace");
    fs.mkdirSync(workspaceDir, { recursive: true });
    const envFile = path.join(lawMindRoot, ".env.lawmind");
    fs.writeFileSync(envFile, "LAWMIND_AGENT_API_KEY=sk-test\n", "utf8");
    process.env.LAWMIND_AGENT_API_KEY = "sk-test";
    const built = buildAgentConfig(workspaceDir, { envFile });
    expect(built.config.envFile).toBe(envFile);
  });
});