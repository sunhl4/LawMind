import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import JSZip from "jszip";
import { afterEach, describe, expect, it } from "vitest";
import { MAX_DOCX_BYTES, MAX_DOCX_ENTRIES, checkDocxSize, loadDocxZip } from "./docx-size.js";

const dirs: string[] = [];

async function workspace(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "lm-docx-size-"));
  dirs.push(dir);
  return dir;
}

afterEach(async () => {
  for (const dir of dirs.splice(0)) {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

describe("docx-size", () => {
  it("passes a normal docx and reports its size", async () => {
    const dir = await workspace();
    const abs = path.join(dir, "合同.docx");
    const zip = new JSZip();
    zip.file("word/document.xml", "<w:document/>");
    const bytes = await zip.generateAsync({ type: "nodebuffer" });
    await fs.writeFile(abs, bytes);

    const size = await checkDocxSize(abs);
    expect(size.ok).toBe(true);
    if (size.ok) {
      expect(size.bytes).toBe(bytes.length);
    }
    const loaded = await loadDocxZip(abs);
    expect(loaded.ok).toBe(true);
  });

  it("refuses a file over the byte cap before parsing", async () => {
    const dir = await workspace();
    const abs = path.join(dir, "超大.docx");
    // 稀疏文件：不真的写 20MB，但 stat.size 会超过上限。
    const handle = await fs.open(abs, "w");
    await handle.truncate(MAX_DOCX_BYTES + 1);
    await handle.close();

    const size = await checkDocxSize(abs);
    expect(size.ok).toBe(false);
    if (!size.ok) {
      expect(size.reason).toContain("超过");
    }
    const loaded = await loadDocxZip(abs);
    expect(loaded.ok).toBe(false);
  });

  it("refuses a zip with an absurd number of parts", async () => {
    const dir = await workspace();
    const abs = path.join(dir, "怪包.docx");
    const zip = new JSZip();
    zip.file("word/document.xml", "<w:document/>");
    for (let i = 0; i < MAX_DOCX_ENTRIES + 2; i += 1) {
      zip.file(`word/media/f${i}.bin`, "");
    }
    await fs.writeFile(abs, await zip.generateAsync({ type: "nodebuffer" }));

    const loaded = await loadDocxZip(abs);
    expect(loaded.ok).toBe(false);
    if (!loaded.ok) {
      expect(loaded.reason).toContain("部件");
    }
  });

  it("reports an unreadable zip as not-a-docx instead of empty", async () => {
    const dir = await workspace();
    const abs = path.join(dir, "假.docx");
    await fs.writeFile(abs, "this is not a zip");
    const loaded = await loadDocxZip(abs);
    expect(loaded.ok).toBe(false);
  });

  it("reports a missing file", async () => {
    const dir = await workspace();
    const size = await checkDocxSize(path.join(dir, "没这个.docx"));
    expect(size.ok).toBe(false);
  });
});
