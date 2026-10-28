/**
 * P1.3 委托包：草案骨架、占位字段、已存在不覆盖。
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createMatterIfMissing } from "../application/services/matter-write-service.js";
import {
  engagementPackageDir,
  loadEngagementPackage,
  writeEngagementPackage,
} from "./engagement-package.js";

const dirs: string[] = [];

function workspace(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-engagement-"));
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
  riskNotes: ["对方可能无财产可供执行"],
  date: "2026-10-27",
};

describe("engagement package", () => {
  it("writes five draft documents with the review banner and a manifest", async () => {
    const dir = workspace();
    seedMatter(dir);
    expect(loadEngagementPackage(dir, "matter-a")).toBeUndefined();

    const result = await writeEngagementPackage(dir, "matter-a", INPUT);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.manifest.files).toHaveLength(5);
    expect(result.manifest.esign).toEqual({ status: "placeholder", provider: null });
    expect(result.manifest.draft).toBe(true);
    for (const file of result.manifest.files) {
      expect(file.relativePath.startsWith(path.join("matters", "matter-a", "收案"))).toBe(true);
      expect(file.sha256).toMatch(/^[a-f0-9]{64}$/);
      const content = fs.readFileSync(path.join(dir, file.relativePath), "utf8");
      expect(content).toContain("草案 · 由 LawMind 生成");
      expect(content).toContain("张三");
    }
    const contract = fs.readFileSync(
      path.join(engagementPackageDir(dir, "matter-a"), "委托代理合同.md"),
      "utf8",
    );
    expect(contract).toContain("示例律师事务所");
    expect(contract).toContain("按标的额 5% 收取");
    expect(contract).toContain("对方可能无财产可供执行");
    expect(loadEngagementPackage(dir, "matter-a")?.files).toHaveLength(5);
  });

  it("marks unset fields instead of inventing terms", async () => {
    const dir = workspace();
    seedMatter(dir);
    const result = await writeEngagementPackage(dir, "matter-a", {
      clientName: "张三",
      feeText: "按小时计费",
    });
    expect(result.ok).toBe(true);
    const contract = fs.readFileSync(
      path.join(engagementPackageDir(dir, "matter-a"), "委托代理合同.md"),
      "utf8",
    );
    expect(contract).toContain("【待填：律所名称】");
    expect(contract).toContain("【待填：承办律师】");
    expect(contract).toContain("【待填：付款安排】");
    expect(contract).toContain("【待填：签署日期】");
  });

  it("refuses to overwrite lawyer-edited files unless explicitly asked", async () => {
    const dir = workspace();
    seedMatter(dir);
    const first = await writeEngagementPackage(dir, "matter-a", INPUT);
    expect(first.ok).toBe(true);
    const contractPath = path.join(engagementPackageDir(dir, "matter-a"), "委托代理合同.md");
    fs.writeFileSync(contractPath, "律师改过的稿", "utf8");

    const blocked = await writeEngagementPackage(dir, "matter-a", INPUT);
    expect(blocked).toMatchObject({ ok: false, error: "exists" });
    expect(fs.readFileSync(contractPath, "utf8")).toBe("律师改过的稿");

    const replaced = await writeEngagementPackage(dir, "matter-a", INPUT, { overwrite: true });
    expect(replaced.ok).toBe(true);
    expect(fs.readFileSync(contractPath, "utf8")).toContain("草案 · 由 LawMind 生成");
  });

  it("rejects missing matter and missing required fields", async () => {
    const dir = workspace();
    expect(await writeEngagementPackage(dir, "missing", INPUT)).toMatchObject({
      ok: false,
      error: "matter_not_found",
    });
    seedMatter(dir);
    expect(
      await writeEngagementPackage(dir, "matter-a", { clientName: "", feeText: "" }),
    ).toMatchObject({ ok: false, error: "missing_fields" });
  });
});
