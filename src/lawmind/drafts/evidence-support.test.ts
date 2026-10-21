/**
 * 证据支持度回归：定位存在 ≠ 依据还在，更 ≠ 依据支持结论。
 *
 * 本文件只验证「可判定的部分」：文件是否存在、是否被改过、原句是否还在。
 * 「原句是否支持该法律结论」不在断言范围（那是模型与律师的判断）。
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  checkEvidenceSupport,
  fileVersionOf,
  normalizeForQuoteMatch,
  quoteAppearsIn,
  summarizeEvidenceSupport,
} from "./evidence-support.js";

const dirs: string[] = [];

function tmpWorkspace(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lm-evidence-support-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("normalizeForQuoteMatch", () => {
  it("ignores full-width vs half-width, punctuation style and whitespace", () => {
    expect(normalizeForQuoteMatch("甲方（北京）公司，应于 2024 年 3 月 1 日 支付。")).toContain(
      normalizeForQuoteMatch("甲方(北京)公司,应于2024年3月1日支付"),
    );
  });

  it("still distinguishes different wording", () => {
    expect(quoteAppearsIn(normalizeForQuoteMatch("总价款为300万元"), "总价款为100万元")).toBe(
      false,
    );
  });
});

describe("fileVersionOf", () => {
  it("changes when the content changes", () => {
    const ws = tmpWorkspace();
    const file = path.join(ws, "合同.txt");
    fs.writeFileSync(file, "本合同总价款为人民币300万元。", "utf8");
    const before = fileVersionOf(file);
    fs.writeFileSync(file, "本合同总价款为人民币500万元。", "utf8");
    const after = fileVersionOf(file);
    expect(before).toBeDefined();
    expect(after).toBeDefined();
    expect(after).not.toBe(before);
  });

  it("returns undefined for a missing file", () => {
    expect(fileVersionOf(path.join(tmpWorkspace(), "不存在.txt"))).toBeUndefined();
  });
});

describe("checkEvidenceSupport", () => {
  it("accepts a quote that is still verbatim in the file", () => {
    const ws = tmpWorkspace();
    fs.mkdirSync(path.join(ws, "cases", "m", "materials"), { recursive: true });
    const rel = "cases/m/materials/合同.txt";
    fs.writeFileSync(path.join(ws, rel), "第一条 本合同总价款为人民币300万元。\n", "utf8");
    const version = fileVersionOf(path.join(ws, rel));

    const result = checkEvidenceSupport({
      rootDir: ws,
      relPath: `${rel}#line=1`,
      quote: "本合同总价款为人民币300万元",
      ...(version ? { expectedVersion: version } : {}),
    });
    expect(result.status).toBe("supported");
  });

  it("does not accept a quote on a different line than its locator", () => {
    const ws = tmpWorkspace();
    fs.writeFileSync(path.join(ws, "source.txt"), "第一行：甲方\n第二行：价款300万元\n");
    expect(
      checkEvidenceSupport({ rootDir: ws, relPath: "source.txt#line=1", quote: "价款300万元" })
        .status,
    ).toBe("quote_mismatch");
    expect(
      checkEvidenceSupport({ rootDir: ws, relPath: "source.txt#line=2", quote: "价款300万元" })
        .status,
    ).toBe("supported");
  });

  it("reports stale when the file changed after the citation was recorded", () => {
    const ws = tmpWorkspace();
    const rel = "cases/m/materials/合同.txt";
    fs.mkdirSync(path.dirname(path.join(ws, rel)), { recursive: true });
    fs.writeFileSync(path.join(ws, rel), "本合同总价款为人民币300万元。", "utf8");
    const version = fileVersionOf(path.join(ws, rel))!;
    fs.writeFileSync(path.join(ws, rel), "本合同总价款为人民币500万元。", "utf8");

    const result = checkEvidenceSupport({
      rootDir: ws,
      relPath: rel,
      quote: "本合同总价款为人民币300万元",
      expectedVersion: version,
    });
    expect(result.status).toBe("stale");
    expect(result.reasonZh).toContain("被改过");
  });

  it("reports quote_mismatch when the wording was rewritten in place", () => {
    const ws = tmpWorkspace();
    const rel = "cases/m/materials/合同.txt";
    fs.mkdirSync(path.dirname(path.join(ws, rel)), { recursive: true });
    // 版本未知（历史数据），但原句已经不在了。
    fs.writeFileSync(path.join(ws, rel), "本合同总价款以补充协议为准。", "utf8");

    const result = checkEvidenceSupport({
      rootDir: ws,
      relPath: rel,
      quote: "本合同总价款为人民币300万元",
    });
    expect(result.status).toBe("quote_mismatch");
  });

  it("reads GBK material instead of calling a present quote a mismatch", () => {
    const ws = tmpWorkspace();
    const rel = "cases/m/materials/合同.txt";
    fs.mkdirSync(path.dirname(path.join(ws, rel)), { recursive: true });
    // GBK「合同价款为人民币」（Word/老系统导出的 txt 常见编码）
    fs.writeFileSync(path.join(ws, rel), Buffer.from("bacfcdacbcdbbfeeceaac8cbc3f1b1d2", "hex"));
    const result = checkEvidenceSupport({
      rootDir: ws,
      relPath: rel,
      quote: "合同价款为人民币",
    });
    expect(result.status).toBe("supported");
  });

  it("does not block on undecodable bytes; reports unverifiable", () => {
    const ws = tmpWorkspace();
    const rel = "cases/m/materials/未知编码.txt";
    fs.mkdirSync(path.dirname(path.join(ws, rel)), { recursive: true });
    // 0x81 0x20 既不是合法 UTF-8，也不是合法 GBK（尾字节范围不对）。
    fs.writeFileSync(path.join(ws, rel), Buffer.from([0x81, 0x20, 0x81, 0x20]));
    const result = checkEvidenceSupport({ rootDir: ws, relPath: rel, quote: "任意" });
    expect(result.status).toBe("unverifiable");
  });

  it("reports missing when the source file is gone", () => {
    const ws = tmpWorkspace();
    const result = checkEvidenceSupport({
      rootDir: ws,
      relPath: "cases/m/materials/无.txt",
      quote: "任意",
    });
    expect(result.status).toBe("missing");
  });

  it("does not pretend to verify docx by reading it as text", () => {
    const ws = tmpWorkspace();
    const rel = "cases/m/materials/合同.docx";
    fs.mkdirSync(path.dirname(path.join(ws, rel)), { recursive: true });
    fs.writeFileSync(path.join(ws, rel), "binary-ish", "utf8");
    const result = checkEvidenceSupport({ rootDir: ws, relPath: rel, quote: "任意" });
    expect(result.status).toBe("unverifiable");
    expect(result.reasonZh).toContain("专用解析器");
  });

  it("refuses paths outside the workspace", () => {
    const ws = tmpWorkspace();
    const result = checkEvidenceSupport({
      rootDir: ws,
      relPath: "../../etc/passwd",
      quote: "root",
    });
    expect(result.status).toBe("unverifiable");
  });

  it("uses the existing fence for symlinks and protected paths", () => {
    const ws = tmpWorkspace();
    const outside = tmpWorkspace();
    fs.writeFileSync(path.join(outside, "source.txt"), "外部原句");
    fs.symlinkSync(path.join(outside, "source.txt"), path.join(ws, "link.txt"));
    fs.writeFileSync(path.join(ws, ".env"), "PRIVATE_VALUE=fixture");
    for (const relPath of ["link.txt", ".env"]) {
      const result = checkEvidenceSupport({ rootDir: ws, relPath, quote: "外部原句" });
      expect(result.status).toBe("unverifiable");
      expect(result.actualVersion).toBeUndefined();
    }
  });

  it("treats a citation without a quote as unverifiable, not supported", () => {
    const ws = tmpWorkspace();
    const rel = "cases/m/materials/合同.txt";
    fs.mkdirSync(path.dirname(path.join(ws, rel)), { recursive: true });
    fs.writeFileSync(path.join(ws, rel), "正文。", "utf8");
    const result = checkEvidenceSupport({ rootDir: ws, relPath: rel });
    expect(result.status).toBe("unverifiable");
  });
});

describe("summarizeEvidenceSupport", () => {
  it("never calls a set with unverifiable entries all supported", () => {
    const summary = summarizeEvidenceSupport([
      { status: "supported", reasonZh: "ok" },
      { status: "unverifiable", reasonZh: "no quote" },
    ]);
    expect(summary.allSupported).toBe(false);
    expect(summary.unverifiable).toBe(1);
  });

  it("treats an empty set as not verified", () => {
    expect(summarizeEvidenceSupport([]).allSupported).toBe(false);
  });
});
