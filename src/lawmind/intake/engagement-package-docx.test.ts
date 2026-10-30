/**
 * P1.3 委托包 DOCX 导出：Markdown 为真相源、正式文书版式、默认不覆盖。
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import JSZip from "jszip";
import { afterEach, describe, expect, it } from "vitest";
import { createMatterIfMissing } from "../application/services/matter-write-service.js";
import { exportEngagementPackageDocx } from "./engagement-package-docx.js";
import {
  engagementPackageDir,
  loadEngagementPackage,
  writeEngagementPackage,
} from "./engagement-package.js";

const dirs: string[] = [];

function workspace(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-engagement-docx-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function seedMatter(dir: string) {
  createMatterIfMissing(dir, { matterId: "matter-a", title: "货款纠纷", status: "intake" });
}

const INPUT = {
  clientName: "张三",
  firmName: "示例律师事务所",
  lawyerName: "李律师",
  feeText: "按标的额 5% 收取",
  paymentSchedule: "签约后 3 日内支付 50%，结案后支付余款",
  date: "2026-10-27",
};

async function documentXml(file: string): Promise<string> {
  const data = fs.readFileSync(file);
  const zip = await JSZip.loadAsync(data);
  return (await zip.file("word/document.xml")?.async("string")) ?? "";
}

async function seedPackage(dir: string) {
  seedMatter(dir);
  const written = await writeEngagementPackage(dir, "matter-a", INPUT);
  expect(written.ok).toBe(true);
}

describe("engagement package docx export", () => {
  it("exports five formal documents without memo header or disclaimer", async () => {
    const dir = workspace();
    await seedPackage(dir);

    const result = await exportEngagementPackageDocx(dir, "matter-a");
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.files).toHaveLength(5);
    expect(result.files.map((file) => file.name)).toEqual([
      "委托代理合同.docx",
      "授权委托书.docx",
      "风险告知书.docx",
      "AI-使用告知与同意.docx",
      "报价单.docx",
    ]);
    for (const file of result.files) {
      const absolute = path.join(dir, file.relativePath);
      expect(fs.existsSync(absolute)).toBe(true);
      expect(file.sha256).toMatch(/^[a-f0-9]{64}$/);
      const xml = await documentXml(absolute);
      expect(xml).toContain("草案 · 由 LawMind 生成");
      expect(xml).not.toContain("免责声明");
      expect(xml).not.toContain("不构成正式法律意见");
      expect(xml).not.toContain("事由：");
      expect(xml).not.toContain("保密：律师工作秘密");
      expect(xml).not.toContain("一、结论");
    }
  });

  it("renders the quote table as a native Word table and keeps signature fields", async () => {
    const dir = workspace();
    await seedPackage(dir);
    const result = await exportEngagementPackageDocx(dir, "matter-a", { overwrite: true });
    expect(result.ok).toBe(true);
    const quote = path.join(engagementPackageDir(dir, "matter-a"), "报价单.docx");
    const quoteXml = await documentXml(quote);
    expect(quoteXml).toContain("<w:tbl>");
    expect(quoteXml).toContain("项目");
    expect(quoteXml).toContain("说明");
    expect(quoteXml).toContain("金额/计费方式");
    expect(quoteXml).toContain("律师费");
    expect(quoteXml).toContain("按标的额 5% 收取");
    expect(quoteXml).toContain("差旅/鉴定/公证等");
    expect(quoteXml).toContain("按实际发生");
    expect(quoteXml).toContain("另行结算");
    // 1 行表头 + 3 行数据；竖线分隔符不再作为正文出现。
    expect((quoteXml.match(/<w:tr>/g) ?? []).length).toBe(4);
    expect(quoteXml).not.toContain("| --- |");

    const contract = path.join(engagementPackageDir(dir, "matter-a"), "委托代理合同.docx");
    const contractXml = await documentXml(contract);
    expect(contractXml).toContain("委托人（签字/盖章）：");
    expect(contractXml).toContain("一、委托事项与范围");
  });

  it("re-exports from the current markdown so lawyer edits reach Word", async () => {
    const dir = workspace();
    await seedPackage(dir);
    const source = path.join(engagementPackageDir(dir, "matter-a"), "委托代理合同.md");
    const edited = fs
      .readFileSync(source, "utf8")
      .replace("按标的额 5% 收取", "按标的额 4% 收取（律师已改）");
    fs.writeFileSync(source, edited, "utf8");

    const first = await exportEngagementPackageDocx(dir, "matter-a");
    expect(first.ok).toBe(true);
    const contract = path.join(engagementPackageDir(dir, "matter-a"), "委托代理合同.docx");
    expect(await documentXml(contract)).toContain("按标的额 4% 收取（律师已改）");

    fs.appendFileSync(source, "\n补充：差旅费实报实销。\n");
    const second = await exportEngagementPackageDocx(dir, "matter-a", { overwrite: true });
    expect(second.ok).toBe(true);
    expect(await documentXml(contract)).toContain("补充：差旅费实报实销。");
  });

  it("refuses to overwrite existing docx unless asked", async () => {
    const dir = workspace();
    await seedPackage(dir);
    const first = await exportEngagementPackageDocx(dir, "matter-a");
    expect(first.ok).toBe(true);

    const second = await exportEngagementPackageDocx(dir, "matter-a");
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.error).toBe("exists");
      expect(second.files).toHaveLength(5);
    }
  });

  it("records the export in the manifest without touching markdown hashes", async () => {
    const dir = workspace();
    await seedPackage(dir);
    const before = loadEngagementPackage(dir, "matter-a");
    const result = await exportEngagementPackageDocx(dir, "matter-a", {
      now: new Date("2026-10-28T02:00:00.000Z"),
    });
    expect(result.ok).toBe(true);

    const after = loadEngagementPackage(dir, "matter-a");
    expect(after?.files).toEqual(before?.files);
    expect(after?.docx?.generatedAt).toBe("2026-10-28T02:00:00.000Z");
    expect(after?.docx?.files).toHaveLength(5);
    expect(after?.docx?.files[0]?.relativePath.startsWith(path.join("matters", "matter-a"))).toBe(
      true,
    );
  });

  it("reports a missing package instead of inventing one", async () => {
    const dir = workspace();
    seedMatter(dir);
    const result = await exportEngagementPackageDocx(dir, "matter-a");
    expect(result).toEqual({ ok: false, error: "package_not_found" });
  });
});
