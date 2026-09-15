import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  inspectTrueManuscriptFileShape,
  inspectTrueManuscriptGate,
  TRUE_MANUSCRIPT_DIR_REL,
} from "./true-manuscript-gate.js";

describe("true-manuscript-gate", () => {
  it("skips honestly when real manuscripts are not in the repo", () => {
    const gate = inspectTrueManuscriptGate();
    if (gate.present) {
      expect(gate.files.length).toBeGreaterThan(0);
      expect(gate.files.every((name) => /\.(docx|doc|pdf)$/i.test(name))).toBe(true);
      return;
    }
    expect(gate.present).toBe(false);
    expect(gate.skipReason).toContain("lawmind-true-manuscript");
    expect(TRUE_MANUSCRIPT_DIR_REL).toBe("fixtures/lawmind-true-manuscript");
  });

  it("rejects a markdown file renamed to .docx", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lm-true-ms-"));
    try {
      const fake = path.join(dir, "nda.docx");
      fs.writeFileSync(fake, "# 保密协议\n本协议双方同意保密。\n", "utf8");
      const shape = await inspectTrueManuscriptFileShape(fake);
      expect(shape.ok).toBe(false);
      expect(shape.reason).toMatch(/OOXML|markdown/i);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("compares sidecar baselines against extracted OOXML text", async () => {
    const { Document, Packer, Paragraph, TextRun } = await import("docx");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lm-true-ms-base-"));
    try {
      const buf = await Packer.toBuffer(
        new Document({
          sections: [
            {
              children: [
                new Paragraph({
                  children: [new TextRun("保密协议双方同意对商业秘密承担保密义务并约定违约责任。")],
                }),
              ],
            },
          ],
        }),
      );
      fs.writeFileSync(path.join(dir, "nda.docx"), Buffer.from(buf));
      fs.writeFileSync(
        path.join(dir, "nda.baseline.json"),
        JSON.stringify({ file: "nda.docx", minTextChars: 10, mustContain: ["保密协议"] }),
        "utf8",
      );
      const { compareTrueManuscriptAgainstBaseline, loadTrueManuscriptBaselines } =
        await import("./true-manuscript-gate.js");
      const baselines = loadTrueManuscriptBaselines(dir);
      expect(baselines).toHaveLength(1);
      const r = await compareTrueManuscriptAgainstBaseline(dir, baselines[0]);
      expect(r.ok).toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
