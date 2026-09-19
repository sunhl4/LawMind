import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  formatTrueManuscriptGateReport,
  inspectTrueManuscriptFileShape,
  inspectTrueManuscriptGate,
  runTrueManuscriptGateCli,
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

  it("prints SKIP or RUN report for CI logs", () => {
    const gate = inspectTrueManuscriptGate();
    const report = formatTrueManuscriptGateReport(gate);
    if (gate.present) {
      expect(report.startsWith("RUN:")).toBe(true);
    } else {
      expect(report.startsWith("SKIP:")).toBe(true);
      expect(report).toContain("lawmind-true-manuscript");
    }
  });

  it("CLI exits 0 on honest skip unless REQUIRE is set", async () => {
    const lines: string[] = [];
    const r = await runTrueManuscriptGateCli({
      require: false,
      log: (line) => lines.push(line),
    });
    expect(lines[0]).toMatch(/^(SKIP|RUN):/);
    if (!r.gate.present) {
      expect(r.exitCode).toBe(0);
      const forced = await runTrueManuscriptGateCli({
        require: true,
        log: () => undefined,
      });
      expect(forced.exitCode).toBe(1);
    }
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
