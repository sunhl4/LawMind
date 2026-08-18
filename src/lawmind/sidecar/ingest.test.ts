import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ingestSidecarSelection } from "./ingest.js";

describe("sidecar ingest", () => {
  it("writes inbox markdown and keeps the review verb", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-sidecar-"));
    const result = ingestSidecarSelection(dir, {
      source: "word",
      title: "违约金条款",
      text: "第三条 甲方逾期应支付违约金。",
      verb: "review",
    });
    expect(result.verb).toBe("review");
    expect(result.prompt.startsWith("审这份")).toBe(true);
    const abs = path.join(dir, result.relativePath);
    expect(fs.readFileSync(abs, "utf8")).toContain("第三条");
  });

  it("rejects empty selection", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-sidecar-"));
    expect(() => ingestSidecarSelection(dir, { text: "   " })).toThrow("empty_selection");
  });
});
