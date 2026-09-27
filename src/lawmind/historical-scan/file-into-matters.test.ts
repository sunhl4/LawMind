import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { fileScanIntoMatters } from "./file-into-matters.js";
import { addScanRoot } from "./job-store.js";
import { runHistoricalScan } from "./run-scan.js";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  dirs.length = 0;
});

describe("fileScanIntoMatters", () => {
  it("copies organized folders into a matter and leaves the originals", async () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-file-ws-"));
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lm-file-root-"));
    dirs.push(ws, root);
    fs.mkdirSync(path.join(root, "华能采购案"), { recursive: true });
    fs.writeFileSync(path.join(root, "华能采购案", "供货合同.docx"), "contract");
    fs.writeFileSync(path.join(root, "华能采购案", "补充协议.docx"), "addendum");
    fs.mkdirSync(path.join(root, "下载"), { recursive: true });
    fs.writeFileSync(path.join(root, "下载", "甲.pdf"), "a");
    fs.writeFileSync(path.join(root, "下载", "乙.pdf"), "b");
    expect(addScanRoot(ws, root).ok).toBe(true);
    await runHistoricalScan(ws);

    const filed = await fileScanIntoMatters(ws, ["华能采购案", "下载"]);
    expect(filed.ok).toBe(true);
    if (!filed.ok) {
      return;
    }
    const huaneng = filed.result.filed.find((row) => row.label === "华能采购案");
    expect(huaneng?.copied).toBe(2);
    expect(huaneng?.created).toBe(true);
    expect(filed.result.filed.some((row) => row.label === "下载")).toBe(false);
    expect(
      filed.result.skipped.some((row) => row.label === "下载" && row.reason === "no_files"),
    ).toBe(true);
    const copied = path.join(ws, "cases", "华能采购案", "materials", "供货合同.docx");
    expect(fs.readFileSync(copied, "utf8")).toBe("contract");
    expect(fs.readFileSync(path.join(root, "华能采购案", "供货合同.docx"), "utf8")).toBe(
      "contract",
    );

    const again = await fileScanIntoMatters(ws, ["华能采购案"]);
    expect(again.ok).toBe(true);
    if (again.ok) {
      expect(again.result.filed[0]?.copied).toBe(0);
      expect(again.result.filed[0]?.alreadyThere).toBe(2);
      expect(again.result.filed[0]?.created).toBe(false);
    }
  });

  it("does not create a matter for a name that cannot be a case id", async () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-file-bad-"));
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lm-file-bad-root-"));
    dirs.push(ws, root);
    fs.mkdirSync(path.join(root, "华能采购案"), { recursive: true });
    fs.writeFileSync(path.join(root, "华能采购案", "供货合同.docx"), "contract");
    fs.writeFileSync(path.join(root, "华能采购案", "补充协议.docx"), "addendum");
    expect(addScanRoot(ws, root).ok).toBe(true);
    await runHistoricalScan(ws);
    const result = await fileScanIntoMatters(ws, ["../秘密"]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.result.filed).toHaveLength(0);
      expect(result.result.skipped).toEqual([{ label: "../秘密", reason: "invalid_name" }]);
    }
    expect(fs.existsSync(path.join(ws, "cases"))).toBe(false);
  });
});
