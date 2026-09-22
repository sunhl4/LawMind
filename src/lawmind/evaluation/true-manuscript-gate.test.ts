import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  baselineMustContainCandidates,
  formatTrueManuscriptGateReport,
  guessTrueManuscriptKind,
  inspectTrueManuscriptFileShape,
  inspectTrueManuscriptGate,
  persistTrueManuscriptReport,
  runTrueManuscriptGateCli,
  writeTrueManuscriptBaselineDrafts,
  TRUE_MANUSCRIPT_DIR_REL,
  type TrueManuscriptReport,
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

  it("guesses manuscript kind from name and text (draft only)", () => {
    expect(guessTrueManuscriptKind("民事起诉状.docx")).toBe("complaint");
    expect(guessTrueManuscriptKind("x.docx", "原告张三诉被告李四，诉讼请求如下")).toBe("complaint");
    expect(guessTrueManuscriptKind("买卖合同.docx")).toBe("contract");
    expect(guessTrueManuscriptKind("x.docx", "甲方与乙方就违约责任达成一致")).toBe("contract");
    expect(guessTrueManuscriptKind("notes.docx", "今天下午开会")).toBe("other");
  });

  it("picks mustContain candidates from early long lines", () => {
    const candidates = baselineMustContainCandidates(
      "短\n本保密协议由甲乙双方于二零二六年一月一日签订\n第二条 双方同意对商业秘密承担保密义务\n尾",
    );
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates.length).toBeLessThanOrEqual(3);
    expect(candidates[0]).toContain("保密协议");
  });

  it("writes draft baselines for new manuscripts and never overwrites confirmed ones", async () => {
    const { Document, Packer, Paragraph, TextRun } = await import("docx");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lm-true-ms-gen-"));
    try {
      const buf = await Packer.toBuffer(
        new Document({
          sections: [
            {
              children: [
                new Paragraph({
                  children: [
                    new TextRun("买卖合同双方同意按照约定交付货物并承担违约责任与付款义务。"),
                  ],
                }),
              ],
            },
          ],
        }),
      );
      fs.writeFileSync(path.join(dir, "sale.docx"), Buffer.from(buf));
      const first = await writeTrueManuscriptBaselineDrafts(dir);
      expect(first.written).toEqual(["sale.docx"]);
      const sidecar = JSON.parse(fs.readFileSync(path.join(dir, "sale.baseline.json"), "utf8")) as {
        file: string;
        kind: string;
        minTextChars: number;
        mustContain: string[];
      };
      expect(sidecar.file).toBe("sale.docx");
      expect(sidecar.kind).toBe("contract");
      expect(sidecar.minTextChars).toBeGreaterThanOrEqual(20);
      expect(Array.isArray(sidecar.mustContain)).toBe(true);
      // Lawyer edits the sidecar; a second run must not overwrite it.
      sidecar.mustContain = ["律师确认短语"];
      fs.writeFileSync(
        path.join(dir, "sale.baseline.json"),
        `${JSON.stringify(sidecar, null, 2)}\n`,
        "utf8",
      );
      const second = await writeTrueManuscriptBaselineDrafts(dir);
      expect(second.written).toEqual([]);
      expect(second.kept).toEqual(["sale.docx"]);
      const after = JSON.parse(fs.readFileSync(path.join(dir, "sale.baseline.json"), "utf8")) as {
        mustContain: string[];
      };
      expect(after.mustContain).toEqual(["律师确认短语"]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("persists a trend report with per-kind rollup for the Doctor scorecard", async () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "lm-true-ms-ws-"));
    try {
      const report: TrueManuscriptReport = {
        generatedAt: new Date().toISOString(),
        status: "pass",
        dir: "/tmp/fixtures",
        files: [{ name: "nda.docx", ok: true, textChars: 100 }],
        baselines: [{ file: "nda.docx", kind: "contract", ok: true }],
        byKind: { contract: { total: 1, ok: 1 } },
      };
      const out = persistTrueManuscriptReport(workspace, report);
      expect(out.endsWith(path.join("lawmind", "metrics", "true-manuscript-report.json"))).toBe(
        true,
      );
      const loaded = JSON.parse(fs.readFileSync(out, "utf8")) as TrueManuscriptReport;
      expect(loaded.status).toBe("pass");
      expect(loaded.byKind.contract?.ok).toBe(1);
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true });
    }
  });

  it("CLI report lines carry baseline kind and persist skip reports when workspace given", async () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "lm-true-ms-cli-"));
    try {
      const lines: string[] = [];
      const r = await runTrueManuscriptGateCli({
        require: false,
        workspaceDir: workspace,
        log: (line) => lines.push(line),
      });
      expect(lines[0]).toMatch(/^(SKIP|RUN):/);
      const reportPath = path.join(workspace, "lawmind", "metrics", "true-manuscript-report.json");
      expect(fs.existsSync(reportPath)).toBe(true);
      const report = JSON.parse(fs.readFileSync(reportPath, "utf8")) as TrueManuscriptReport;
      if (!r.gate.present) {
        expect(report.status).toBe("skip");
      } else {
        expect(["pass", "fail"]).toContain(report.status);
        for (const line of lines.filter((l) => l.includes("baseline"))) {
          expect(line).toMatch(/\[(contract|complaint|other)\]/);
        }
      }
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true });
    }
  });
});
