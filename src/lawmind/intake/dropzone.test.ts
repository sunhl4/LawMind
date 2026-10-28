import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createMatterIfMissing } from "../application/services/matter-write-service.js";
import { scanIntakeDropzone } from "./dropzone.js";
import { buildIntakeMatterIndex } from "./matter-index.js";
import { getIntakeItem } from "./store.js";

describe("intake dropzone", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("records and auto-files a settled file in a matter-named folder", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-dropzone-test-"));
    dirs.push(dir);
    createMatterIfMissing(dir, { matterId: "matter-a", title: "甲案" });
    const drop = path.join(dir, "收件投递", "matter-a", "证据.txt");
    fs.mkdirSync(path.dirname(drop), { recursive: true });
    fs.writeFileSync(drop, "proof");
    const old = new Date(Date.now() - 10_000);
    fs.utimesSync(drop, old, old);

    const result = scanIntakeDropzone(dir, { index: buildIntakeMatterIndex(dir), now: new Date() });
    expect(result.recorded).toBe(1);
    expect(result.autoAttached).toBe(1);
    expect(fs.existsSync(drop)).toBe(false);
    expect(fs.existsSync(path.join(dir, "收件投递", "已入库"))).toBe(true);
    const item = fs
      .readdirSync(path.join(dir, "lawmind", "intake", "items"))[0]
      ?.replace(/\.json$/, "");
    expect(item).toBeTruthy();
    expect(getIntakeItem(dir, item)?.status).toBe("attached");
  });

  it("does not consume a file that is still being copied", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-dropzone-test-"));
    dirs.push(dir);
    const drop = path.join(dir, "收件投递", "new.pdf");
    fs.mkdirSync(path.dirname(drop), { recursive: true });
    fs.writeFileSync(drop, "partial");
    const result = scanIntakeDropzone(dir, { now: new Date() });
    expect(result.recorded).toBe(0);
    expect(fs.existsSync(drop)).toBe(true);
  });
});
