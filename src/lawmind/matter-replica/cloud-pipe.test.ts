/**
 * Unit tests for crypto envelope, CDC chunks, and HTTP relay client shapes.
 */

import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { describe, expect, it } from "vitest";
import { isSealedEnvelope, openBytes, sealBytes } from "./crypto-envelope.js";
import { HttpMaterialsRelay, HttpReplicaRelay } from "./http-relay.js";
import {
  MATERIAL_CHUNK_THRESHOLD,
  hashBuffer,
  planMaterialChunks,
  reassembleChunks,
} from "./materials-cdc.js";

describe("crypto-envelope", () => {
  it("round-trips and marks sealed", () => {
    const key = randomBytes(32);
    const plain = Buffer.from("对方盖章合同扫描件", "utf8");
    const sealed = sealBytes(plain, key);
    expect(isSealedEnvelope(sealed)).toBe(true);
    expect(openBytes(sealed, key).equals(plain)).toBe(true);
  });

  it("refuses plaintext instead of silently passing it through (downgrade guard)", () => {
    const key = randomBytes(32);
    const plain = Buffer.from("legacy-blob");
    // 明文直通会让「把密文换成明文」无法被发现（差距评审 X6），所以必须失败关闭
    expect(isSealedEnvelope(plain)).toBe(false);
    expect(() => openBytes(plain, key)).toThrow(/sealed envelope/i);
  });

  it("rejects a ciphertext sealed with a different key", () => {
    const key = randomBytes(32);
    const other = randomBytes(32);
    const sealed = sealBytes(Buffer.from("案件正文", "utf8"), other);
    expect(() => openBytes(sealed, key)).toThrow();
  });
});

describe("materials-cdc", () => {
  it("keeps small files as a single chunk", () => {
    const bytes = Buffer.alloc(1024, 7);
    const plan = planMaterialChunks(bytes);
    expect(plan.chunks).toHaveLength(1);
    expect(plan.sha256).toBe(hashBuffer(bytes));
  });

  it("splits large files and reassembles", () => {
    const bytes = Buffer.alloc(MATERIAL_CHUNK_THRESHOLD + 1000, 9);
    const plan = planMaterialChunks(bytes);
    expect(plan.chunks.length).toBeGreaterThan(1);
    const parts = plan.chunks.map((c) => bytes.subarray(c.offset, c.offset + c.size));
    expect(reassembleChunks(parts, plan.sha256).equals(bytes)).toBe(true);
  });
});

describe("http-relay", () => {
  it("publishes and fetches ops against a tiny in-memory cloud", async () => {
    const store = new Map<string, Buffer | string>();
    const server = createServer((req, res) => {
      const url = req.url ?? "";
      if (req.method === "PUT" && url.endsWith("/ops")) {
        const chunks: Buffer[] = [];
        req.on("data", (c) => chunks.push(c));
        req.on("end", () => {
          store.set(url, Buffer.concat(chunks).toString("utf8"));
          res.writeHead(200);
          res.end("{}");
        });
        return;
      }
      if (req.method === "GET" && url.endsWith("/ops")) {
        const body = store.get(url);
        if (!body) {
          res.writeHead(404);
          res.end();
          return;
        }
        res.writeHead(200, { "content-type": "application/json" });
        res.end(typeof body === "string" ? body : body.toString("utf8"));
        return;
      }
      res.writeHead(404);
      res.end();
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const addr = server.address();
    if (!addr || typeof addr === "string") {
      throw new Error("no port");
    }
    const endpoint = `http://127.0.0.1:${addr.port}`;
    const relay = new HttpReplicaRelay(endpoint);
    await relay.publishOps("m1", [
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
    const ops = await relay.fetchOps("m1");
    expect(ops).toHaveLength(1);
    expect(ops[0]?.opId).toBe("op1");

    const mats = new HttpMaterialsRelay(endpoint);
    // 404 empty manifest
    expect(await mats.fetchManifest("m1")).toEqual([]);
    server.close();
  });
});
