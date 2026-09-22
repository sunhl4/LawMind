import fs from "node:fs";
import type http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { handlePracticePlaybookRoutes } from "./lawmind-server-route-practice-playbook.js";
import type { LawmindDispatchContext } from "./lawmind-server-route-types.js";

function captureRes() {
  let status = 0;
  let body = "";
  const res = {
    writeHead(s: number) {
      status = s;
      return res;
    },
    end(c?: string | Buffer) {
      body += c ? c.toString() : "";
    },
  } as unknown as http.ServerResponse;
  return {
    res,
    get status() {
      return status;
    },
    json() {
      return JSON.parse(body) as Record<string, unknown>;
    },
  };
}

function jsonReq(method: string, body?: unknown): http.IncomingMessage {
  const req = { method, headers: {} } as http.IncomingMessage;
  Object.assign(req, {
    on(ev: string, fn: (...a: unknown[]) => void) {
      if (ev === "data" && body !== undefined) {
        fn(Buffer.from(JSON.stringify(body)));
      }
      if (ev === "end") {
        fn();
      }
      return req;
    },
  });
  return req;
}

describe("handlePracticePlaybookRoutes", () => {
  const tmp: string[] = [];
  afterEach(() => {
    for (const d of tmp) {
      try {
        fs.rmSync(d, { recursive: true, force: true });
      } catch {
        /* */
      }
    }
    tmp.length = 0;
  });

  it("GET defaults then POST roundtrip", async () => {
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "lm-playbook-api-"));
    tmp.push(workspaceDir);
    const ctx: LawmindDispatchContext = {
      workspaceDir,
      envFile: undefined,
      userEnvPath: path.join(workspaceDir, ".env.lawmind"),
      policy: { loaded: false },
    };
    const c = {};
    const getCap = captureRes();
    const getHandled = await handlePracticePlaybookRoutes({
      ctx,
      pathname: "/api/workspace/practice-playbook",
      req: jsonReq("GET"),
      res: getCap.res,
      url: new URL("http://127.0.0.1/api/workspace/practice-playbook"),
      c,
    });
    expect(getHandled).toBe(true);
    expect(getCap.status).toBe(200);
    const loaded = getCap.json().playbook as { source: string; stanceDefault: string };
    expect(loaded.source).toBe("default");
    expect(loaded.stanceDefault).toBe("protect_instructing");

    const postCap = captureRes();
    await handlePracticePlaybookRoutes({
      ctx,
      pathname: "/api/workspace/practice-playbook",
      req: jsonReq("POST", { stanceDefault: "neutral", neverAccept: ["无限责任"] }),
      res: postCap.res,
      url: new URL("http://127.0.0.1/api/workspace/practice-playbook"),
      c,
    });
    expect(postCap.json().ok).toBe(true);
    expect((postCap.json().playbook as { stanceDefault: string; source: string }).stanceDefault).toBe(
      "neutral",
    );
    expect((postCap.json().playbook as { source: string }).source).toBe("workspace");
  });
});
