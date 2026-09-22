/**
 * Optional true-manuscript compare.
 * Skips unless fixtures/lawmind-true-manuscript/ contains real .docx/.doc/.pdf.
 * In-repo NDA markdown is not a stand-in. Does not fake-pass against panrui/copilot.
 */

import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  compareTrueManuscriptAgainstBaseline,
  inspectTrueManuscriptFileShape,
  inspectTrueManuscriptGate,
  loadTrueManuscriptBaselines,
} from "./true-manuscript-gate.js";

const gate = inspectTrueManuscriptGate();
const baselines = gate.present ? loadTrueManuscriptBaselines(gate.dir) : [];

describe.skipIf(!gate.present)("true manuscript compare", () => {
  it("has real Word/PDF fixtures (not NDA markdown)", () => {
    expect(gate.files.length).toBeGreaterThan(0);
    expect(gate.files.every((name) => /\.(docx|doc|pdf)$/i.test(name))).toBe(true);
  });

  it("extracts document bytes, not a renamed markdown stand-in", async () => {
    for (const name of gate.files) {
      const shape = await inspectTrueManuscriptFileShape(path.join(gate.dir, name));
      expect(shape.ok, `${name}: ${shape.reason ?? "ok"}`).toBe(true);
    }
  });
});

describe.skipIf(baselines.length === 0)("true manuscript sidecar baselines", () => {
  it("matches lawyer-provided sidecar phrases when present (not a panrui fake-pass)", async () => {
    for (const baseline of baselines) {
      const r = await compareTrueManuscriptAgainstBaseline(gate.dir, baseline);
      expect(r.ok, r.reason ?? baseline.file).toBe(true);
    }
  });
});
