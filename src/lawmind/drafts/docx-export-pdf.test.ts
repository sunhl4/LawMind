import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../platform/safe-command.js", () => ({
  buildMinimalChildEnv: () => ({}),
  runSafeCommand: vi.fn().mockResolvedValue({ exitCode: 127 }),
}));

import { exportDocxToPdf } from "./docx-export-pdf.js";

describe("exportDocxToPdf", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
  });

  it("rejects non-docx paths", async () => {
    const r = await exportDocxToPdf("/tmp/readme.txt");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toContain(".docx");
    }
  });

  it("reports missing file", async () => {
    const r = await exportDocxToPdf(path.join(os.tmpdir(), "lm-missing-export.docx"));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toContain("找不到");
    }
  });

  it("reports when no converter succeeds", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lm-export-pdf-"));
    dirs.push(dir);
    const docx = path.join(dir, "合同.docx");
    fs.writeFileSync(docx, "PK\x03\x04fake");
    const r = await exportDocxToPdf(docx);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toMatch(/LibreOffice|PDF/);
    }
  });
});
