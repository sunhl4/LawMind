/**
 * Tests for invite key wrap, CASE live merge, and Matter Cloud store/HTTP.
 */

import fs from "node:fs";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { mergeCaseMdLines, rematerializeCaseMd } from "./case-md-live.js";
import { HttpReplicaRelay } from "./http-relay.js";
import { createInvite, upsertLawyerIdentity } from "./index.js";
import { wrapMatterKeyForInvite, unwrapMatterKeyFromInvite } from "./invite-key-wrap.js";
import { handleMatterCloudRequest } from "./matter-cloud-http.js";
import { MatterCloudStore } from "./matter-cloud-store.js";
import { ensureMatterKey } from "./matter-key.js";
import { snapshotCaseMd, listRecordOps } from "./record-ops.js";

const tmpDirs: string[] = [];

function tmp(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "lm-cloud-"));
  tmpDirs.push(d);
  return d;
}

afterEach(() => {
  for (const d of tmpDirs.splice(0)) {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

describe("invite-key-wrap", () => {
  it("wraps and unwraps with the invite token", () => {
    const ws = tmp();
    const key = ensureMatterKey(ws, "m1");
    const token = "LM-AAAA-BBBB-CCCC-DDDD";
    const wrapped = wrapMatterKeyForInvite(key, token, "m1");
    expect(wrapped.version).toBe(2);
    expect(wrapped.sealedKeyB64).toBeTruthy();
    const opened = unwrapMatterKeyFromInvite(wrapped, token, "m1");
    expect(opened.keyB64).toBe(key.keyB64);
  });

  it("refuses the wrong token", () => {
    const ws = tmp();
    const key = ensureMatterKey(ws, "m1");
    const wrapped = wrapMatterKeyForInvite(key, "LM-AAAA-BBBB-CCCC-DDDD", "m1");
    expect(() => unwrapMatterKeyFromInvite(wrapped, "LM-ZZZZ-ZZZZ-ZZZZ-ZZZZ", "m1")).toThrow();
  });

  it("createInvite records matter_key.share without plaintext key", () => {
    const ws = tmp();
    upsertLawyerIdentity(ws, { displayName: "张三", lawyerId: "lawyer_zhang" });
    const invite = createInvite(ws, {
      matterId: "m_share",
      matterTitle: "案",
      email: "li@example.com",
      role: "associate",
    });
    const share = listRecordOps(ws, "m_share").find((o) => o.kind === "matter_key.share");
    expect(share).toBeTruthy();
    const wrapped = share?.payload.wrapped as { sealedKeyB64?: string; keyB64?: string };
    expect(wrapped?.sealedKeyB64).toBeTruthy();
    expect(wrapped?.keyB64).toBeUndefined();
    expect(invite.token.startsWith("LM-")).toBe(true);
  });
});

describe("case-md-live", () => {
  it("merges when one side equals base", () => {
    const r = mergeCaseMdLines("a\nb\n", "a\nb\n", "a\nb\nc\n");
    expect(r.clean).toBe(true);
    expect(r.merged).toContain("c");
  });

  it("applies remote excerpt when local CASE is empty", () => {
    const ws = tmp();
    const mid = "m_case";
    // 摘录现在用案件密钥封套，所以要有钥匙才谈得上「采纳对端摘录」
    ensureMatterKey(ws, mid);
    fs.mkdirSync(path.join(ws, "cases", mid), { recursive: true });
    snapshotCaseMd(ws, { matterId: mid, actorId: "a", actorName: "甲" });
    // force a remote-like snapshot with excerpt by writing CASE then snapshot then delete
    fs.writeFileSync(path.join(ws, "cases", mid, "CASE.md"), "# 远程要点\n对方：乙\n", "utf8");
    snapshotCaseMd(ws, { matterId: mid, actorId: "a", actorName: "甲" });
    fs.rmSync(path.join(ws, "cases", mid, "CASE.md"));
    const result = rematerializeCaseMd(ws, mid);
    expect(result.action).toBe("applied_remote");
    expect(fs.readFileSync(path.join(ws, "cases", mid, "CASE.md"), "utf8")).toContain("乙");
  });

  it("无密钥时只有摘要、不采纳正文（不把明文当成回填来源）", () => {
    const ws = tmp();
    const mid = "m_case_nokey";
    fs.mkdirSync(path.join(ws, "cases", mid), { recursive: true });
    fs.writeFileSync(path.join(ws, "cases", mid, "CASE.md"), "# 远程要点\n对方：乙\n", "utf8");
    snapshotCaseMd(ws, { matterId: mid, actorId: "a", actorName: "甲" });
    fs.rmSync(path.join(ws, "cases", mid, "CASE.md"));
    const result = rematerializeCaseMd(ws, mid);
    expect(result.action).not.toBe("applied_remote");
  });
});

describe("matter-cloud store + http", () => {
  it("stores ops and serves them over HTTP", async () => {
    const root = tmp();
    const store = new MatterCloudStore(root);
    store.writeOps("m1", [
      {
        opId: "op1",
        matterId: "m1",
        kind: "invite.create",
        actorId: "a",
        actorName: "张三",
        createdAt: "2026-01-01T00:00:00.000Z",
        payload: {},
      },
    ]);

    const server = createServer((req, res) => {
      void handleMatterCloudRequest(store, req, req.url ?? "/").then((result) => {
        if (!result) {
          res.writeHead(404);
          res.end();
          return;
        }
        const body = result.body ?? Buffer.from(JSON.stringify(result.json ?? {}));
        res.writeHead(result.status, {
          "content-type": result.body ? "application/octet-stream" : "application/json",
          ...result.headers,
        });
        res.end(body);
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const addr = server.address();
    if (!addr || typeof addr === "string") {
      throw new Error("no port");
    }
    const relay = new HttpReplicaRelay(`http://127.0.0.1:${addr.port}`);
    const ops = await relay.fetchOps("m1");
    expect(ops).toHaveLength(1);
    expect(ops[0]?.opId).toBe("op1");
    server.close();
  });
});
