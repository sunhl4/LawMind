import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  parseLawMindBundleManifest,
  verifyLawMindBundleManifest,
  type LawMindBundleManifest,
} from "./bundle-manifest.js";

describe("bundle-manifest", () => {
  let ws: string;

  afterEach(async () => {
    if (ws) {
      await fs.rm(ws, { recursive: true, force: true });
    }
  });

  it("parseLawMindBundleManifest rejects bad input", () => {
    expect(parseLawMindBundleManifest(null)).toBe(null);
    expect(parseLawMindBundleManifest({ schemaVersion: 2 })).toBe(null);
  });

  it("verifyLawMindBundleManifest passes when hashes match", async () => {
    ws = await fs.mkdtemp(path.join(os.tmpdir(), "lawmind-bundle-"));
    const rel = "lawmind/bundles/x.txt";
    const full = path.join(ws, rel);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, "hello bundle", "utf8");
    const hash = createHash("sha256").update("hello bundle").digest("hex");
    const manifest: LawMindBundleManifest = {
      schemaVersion: 1,
      bundleId: "test",
      version: "1.0.0",
      generatedAt: new Date().toISOString(),
      entries: [{ path: rel.replace(/\\/g, "/"), sha256: hash, role: "doc" }],
    };
    const r = verifyLawMindBundleManifest(ws, manifest);
    expect(r.ok).toBe(true);
    expect(r.errors).toHaveLength(0);
  });

  it("verifyLawMindBundleManifest rejects path traversal", () => {
    const manifest: LawMindBundleManifest = {
      schemaVersion: 1,
      bundleId: "bad",
      version: "1",
      generatedAt: "",
      entries: [{ path: "../secret", sha256: "a", role: "doc" }],
    };
    const r = verifyLawMindBundleManifest("/tmp/ws", manifest);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes("unsafe"))).toBe(true);
  });
});
