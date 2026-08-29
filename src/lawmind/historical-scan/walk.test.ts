import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { walkScanRoot } from "./walk.js";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  dirs.length = 0;
});

describe("walkScanRoot", () => {
  it("skips .git and catalogs organized vs leftover files", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lm-walk-"));
    dirs.push(root);
    fs.mkdirSync(path.join(root, ".git"), { recursive: true });
    fs.writeFileSync(path.join(root, ".git", "HEAD"), "ref");
    fs.mkdirSync(path.join(root, "华能采购案"), { recursive: true });
    fs.writeFileSync(path.join(root, "华能采购案", "供货合同.docx"), "a");
    fs.writeFileSync(path.join(root, "华能采购案", "补充协议.docx"), "b");
    fs.writeFileSync(path.join(root, "发票扫描.pdf"), "c");
    const walked = walkScanRoot({
      id: "root_test",
      absPath: root,
      addedAt: new Date().toISOString(),
    });
    expect(walked.truncated).toBe(false);
    expect(walked.items.some((i) => i.relPath.includes(".git"))).toBe(false);
    expect(walked.items).toHaveLength(3);
    const organized = walked.items.filter((i) => i.layout === "organized");
    expect(organized).toHaveLength(2);
    expect(organized.every((i) => i.proposedMatterLabel === "华能采购案")).toBe(true);
    expect(walked.items.filter((i) => i.layout === "messy")).toHaveLength(1);
  });
});
