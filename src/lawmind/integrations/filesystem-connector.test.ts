import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { listFilesystemDocuments } from "./filesystem-connector.js";

describe("listFilesystemDocuments", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const d of dirs.splice(0)) {
      fs.rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    }
  });

  it("skips .lawmind-* files and returns nested paths", () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-fs-"));
    dirs.push(ws);
    const caseDir = path.join(ws, "cases", "m-nested");
    fs.mkdirSync(path.join(caseDir, "docs"), { recursive: true });
    fs.writeFileSync(path.join(caseDir, "README.md"), "hi");
    fs.writeFileSync(path.join(caseDir, "docs", "memo.txt"), "memo");
    fs.writeFileSync(path.join(caseDir, ".lawmind-role.txt"), "matter");

    const docs = listFilesystemDocuments(ws, "m-nested");
    expect(docs.map((d) => d.relativePath).toSorted()).toEqual(["README.md", "docs/memo.txt"]);
  });
});
