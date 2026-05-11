import fs from "node:fs";
import type http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { handleContractReviewRoutes } from "./lawmind-server-route-contract-review.js";
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

describe("handleContractReviewRoutes", () => {
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

  it("POST draft then accept creates revision pack", async () => {
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "lm-cr-accept-"));
    tmp.push(workspaceDir);
    fs.writeFileSync(path.join(workspaceDir, "orig.md"), "orig", "utf8");
    fs.writeFileSync(path.join(workspaceDir, "rev.md"), "revised", "utf8");
    const ctx: LawmindDispatchContext = {
      workspaceDir,
      envFile: undefined,
      userEnvPath: path.join(workspaceDir, ".env.lawmind"),
      policy: { loaded: false },
    };
    const c = {};
    const saveCap = captureRes();
    await handleContractReviewRoutes({
      ctx,
      pathname: "/api/learning/contract-review/drafts",
      req: jsonReq("POST", {
        initialPath: "orig.md",
        revisedPath: "rev.md",
        lawyerAnnotations: "OK",
        keyModificationsDraft: ["条款1"],
      }),
      res: saveCap.res,
      url: new URL("http://127.0.0.1/api/learning/contract-review/drafts"),
      c,
    });
    const draftId = (saveCap.json().draft as { draftId: string }).draftId;
    expect(draftId.length).toBeGreaterThan(4);

    const accCap = captureRes();
    await handleContractReviewRoutes({
      ctx,
      pathname: "/api/learning/contract-review/drafts/accept",
      req: jsonReq("POST", { draftId, stableDocumentKey: "K-1" }),
      res: accCap.res,
      url: new URL("http://127.0.0.1/api/learning/contract-review/drafts/accept"),
      c,
    });
    expect(accCap.status).toBe(200);
    expect(typeof accCap.json().revisionId).toBe("string");
    const idx = path.join(workspaceDir, "learning", "contract-revisions", "_index", "by-key", "K-1.json");
    expect(fs.existsSync(idx)).toBe(true);
  });
});
