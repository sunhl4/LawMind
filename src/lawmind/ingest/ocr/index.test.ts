import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { confirmOcrExtraction, isCloudOcrEnabled } from "./index.js";

describe("ingest/ocr", () => {
  let workspaceDir: string;

  beforeEach(async () => {
    workspaceDir = await fs.mkdtemp(path.join("/tmp", "lawmind-ocr-"));
  });

  afterEach(async () => {
    await fs.rm(workspaceDir, { recursive: true, force: true }).catch(() => undefined);
  });

  it("cloud flag default off", () => {
    expect(isCloudOcrEnabled({ flag: "" })).toBe(false);
  });

  it("confirmOcrExtraction writes markdown under matter", async () => {
    const r = await confirmOcrExtraction(workspaceDir, {
      matterId: "m-ocr",
      sourcePath: "/tmp/scan.png",
      text: "确认后的 OCR 正文",
      confirmedBy: "lawyer-1",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) {
      return;
    }
    const abs = path.join(workspaceDir, r.relativePath);
    const body = await fs.readFile(abs, "utf8");
    expect(body).toContain("确认后的 OCR 正文");
    expect(body).toContain("lawyer-1");
  });

  it("rejects empty text", async () => {
    const r = await confirmOcrExtraction(workspaceDir, {
      matterId: "m-ocr",
      sourcePath: "/tmp/x.png",
      text: "   ",
      confirmedBy: "lawyer-1",
    });
    expect(r).toEqual({ ok: false, error: "empty_ocr_text" });
  });
});
