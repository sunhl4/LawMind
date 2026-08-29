import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveOutboundAttachmentPaths } from "./mail-attachments.js";

const dirs: string[] = [];

afterEach(() => {
  for (const d of dirs.splice(0)) {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

describe("resolveOutboundAttachmentPaths", () => {
  it("resolves workspace-relative files", () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-att-"));
    dirs.push(ws);
    const rel = "artifacts/demo.tracked.docx";
    const abs = path.join(ws, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, "x");
    const r = resolveOutboundAttachmentPaths(ws, [rel]);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.files).toHaveLength(1);
      expect(r.files[0]?.filename).toBe("demo.tracked.docx");
    }
  });

  it("rejects path escape", () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-att-"));
    dirs.push(ws);
    const r = resolveOutboundAttachmentPaths(ws, ["../outside.docx"]);
    expect(r.ok).toBe(false);
    const prefix = resolveOutboundAttachmentPaths(ws, [`${ws}-evil/secret.docx`]);
    expect(prefix.ok).toBe(false);
  });
});
