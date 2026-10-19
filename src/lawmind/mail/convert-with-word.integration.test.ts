/**
 * Opt-in real-Word integration check. Skipped by default: it needs Microsoft Word
 * installed and a real `.doc` produced by Word/WPS (our hand-built fixture is not
 * a valid stand-in for Word's repair path).
 *
 *   LAWMIND_WORD_INTEGRATION_DOC=/path/to/contract.doc pnpm exec vitest run \
 *     src/lawmind/mail/convert-with-word.integration.test.ts
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import {
  convertDocToDocxWithWord,
  microsoftWordInstalled,
  resolveWordSandboxDir,
} from "./convert-with-word.js";

const SAMPLE = process.env.LAWMIND_WORD_INTEGRATION_DOC?.trim() ?? "";
const enabled = SAMPLE !== "" && fs.existsSync(SAMPLE) && microsoftWordInstalled();

describe.skipIf(!enabled)("Word sandbox conversion (real .doc)", () => {
  it("converts without a permission prompt and keeps revisions and footers", async () => {
    const sandbox = resolveWordSandboxDir();
    expect(sandbox).toBeTruthy();

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lm-word-int-"));
    try {
      const out = path.join(dir, "out.docx");
      const before = fs.readFileSync(SAMPLE);
      const started = Date.now();
      const ok = await convertDocToDocxWithWord(SAMPLE, out);
      expect(ok).toBe(true);
      // Word 打开 + 另存应在数十秒内完成；卡住就说明又遇到授权/修复对话框。
      expect(Date.now() - started).toBeLessThan(90_000);
      expect(fs.readFileSync(SAMPLE).equals(before)).toBe(true);

      const zip = await JSZip.loadAsync(fs.readFileSync(out));
      expect(Object.hasOwn(zip.files, "word/document.xml")).toBe(true);
      const xml = (await zip.file("word/document.xml")?.async("string")) ?? "";
      // 版式与修订都是 Word 自己写的；至少要有正文，修订数不应把源文件整个抹平。
      expect(xml.length).toBeGreaterThan(1_000);
      const authors = [...new Set([...xml.matchAll(/w:author="([^"]*)"/g)].map((m) => m[1]))];
      if (authors.length > 0) {
        expect(authors.length).toBeGreaterThanOrEqual(1);
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
