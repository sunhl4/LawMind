import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  formatMissingDeliverableNudge,
  missingNamedDeliverables,
  namedWorkspaceDeliverables,
} from "./named-deliverable.js";

describe("named workspace deliverables", () => {
  it("reads the filename the lawyer asked to write", () => {
    const names = namedWorkspaceDeliverables(
      "把金额写入 amount.txt，文件里只能有数字。再把字段写入 fields.json。",
    );
    expect(names).toEqual(["amount.txt", "fields.json"]);
  });

  it("reads an English Output and Write filename", () => {
    expect(
      namedWorkspaceDeliverables(
        "Output: `issue-memorandum.docx`. Write issue-memorandum.docx here.",
      ),
    ).toEqual(["issue-memorandum.docx"]);
  });

  it("ignores a file that is only being read", () => {
    expect(namedWorkspaceDeliverables("请读 facts.txt。不要估算。")).toEqual([]);
  });

  it("reports a named file that is not at that workspace path", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lm-deliver-"));
    try {
      fs.mkdirSync(path.join(dir, "artifacts", "analysis"), { recursive: true });
      fs.writeFileSync(path.join(dir, "artifacts", "analysis", "amount.txt"), "4300");
      const missing = missingNamedDeliverables(dir, "把金额写入 amount.txt。");
      expect(missing).toEqual(["amount.txt"]);
      expect(formatMissingDeliverableNudge(missing)).toContain("write_document");
      fs.writeFileSync(path.join(dir, "amount.txt"), "4300");
      expect(missingNamedDeliverables(dir, "把金额写入 amount.txt。")).toEqual([]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
