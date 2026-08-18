import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  clearLawminddAdvertisement,
  LAWMIDD_ADVERTISE_REL,
  readLawminddAdvertisement,
  writeLawminddAdvertisement,
} from "./advertise.js";

describe("lawmindd advertisement", () => {
  it("writes and reads the loopback port file", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lawmindd-adv-"));
    const written = writeLawminddAdvertisement(dir, 4312);
    expect(written.port).toBe(4312);
    expect(written.pid).toBe(process.pid);
    expect(fs.existsSync(path.join(dir, LAWMIDD_ADVERTISE_REL))).toBe(true);
    const read = readLawminddAdvertisement(dir);
    expect(read?.port).toBe(4312);
    expect(read?.pendingPath).toBe("/api/sidecar/pending");
    expect(read?.outboxPath).toBe("/api/sidecar/outbox");
    clearLawminddAdvertisement(dir);
    expect(readLawminddAdvertisement(dir)).toBeNull();
  });

  it("does not delete another process advertisement", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lawmindd-adv-"));
    const file = path.join(dir, ...LAWMIDD_ADVERTISE_REL.split("/"));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(
      file,
      JSON.stringify({
        daemon: "lawmindd",
        host: "127.0.0.1",
        port: 4312,
        pid: process.pid + 99999,
        startedAt: new Date().toISOString(),
        workspaceDir: dir,
      }),
      "utf8",
    );
    clearLawminddAdvertisement(dir);
    expect(readLawminddAdvertisement(dir)?.pid).toBe(process.pid + 99999);
  });
});
