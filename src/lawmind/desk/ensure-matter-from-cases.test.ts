import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadMatter } from "../adapters/matter-storage/index.js";
import { createMatterIfMissing } from "../application/services/matter-write-service.js";
import { ensureMatterFromCasesDir } from "./ensure-matter-from-cases.js";

describe("ensureMatterFromCasesDir", () => {
  const tmp: string[] = [];

  afterEach(() => {
    for (const dir of tmp) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns existing matter without rewriting", () => {
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "lm-ensure-exist-"));
    tmp.push(workspaceDir);
    createMatterIfMissing(workspaceDir, { matterId: "case-a", title: "已有案" });
    const again = ensureMatterFromCasesDir(workspaceDir, "case-a");
    expect(again?.title).toBe("已有案");
  });

  it("registers matter when only cases/<id> folder exists", () => {
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "lm-ensure-cases-"));
    tmp.push(workspaceDir);
    fs.mkdirSync(path.join(workspaceDir, "cases", "YX-mail"), { recursive: true });
    fs.writeFileSync(path.join(workspaceDir, "cases", "YX-mail", "CASE.md"), "# 案\n", "utf8");
    expect(loadMatter(workspaceDir, "YX-mail")).toBeUndefined();
    const created = ensureMatterFromCasesDir(workspaceDir, "YX-mail");
    expect(created?.matterId).toBe("YX-mail");
    expect(loadMatter(workspaceDir, "YX-mail")?.title).toBe("YX-mail");
  });

  it("returns undefined when neither matter nor cases folder exists", () => {
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "lm-ensure-miss-"));
    tmp.push(workspaceDir);
    expect(ensureMatterFromCasesDir(workspaceDir, "ghost-case")).toBeUndefined();
  });
});
