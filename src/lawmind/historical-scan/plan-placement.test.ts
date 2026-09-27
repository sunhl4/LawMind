import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createMatterIfAbsent } from "../cases/matter-create.js";
import { addScanRoot } from "./job-store.js";
import { applyScanPlan, buildScanPlan } from "./plan-placement.js";
import { runHistoricalScan } from "./run-scan.js";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  dirs.length = 0;
});

describe("buildScanPlan", () => {
  it("does not file every contract into a matter named 合同", async () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-plan-short-"));
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lm-plan-short-root-"));
    dirs.push(ws, root);
    await createMatterIfAbsent(ws, "合同", { displayName: "合同" });
    fs.mkdirSync(path.join(root, "下载"), { recursive: true });
    fs.writeFileSync(path.join(root, "下载", "关于合同的说明.pdf"), "note");
    fs.writeFileSync(path.join(root, "下载", "合同.pdf"), "exact");
    expect(addScanRoot(ws, root).ok).toBe(true);
    await runHistoricalScan(ws);
    const plan = await buildScanPlan(ws);
    expect(plan?.intoMatters).toEqual([{ matterId: "合同", displayName: "合同", count: 1 }]);
    expect(plan?.library).toEqual([{ kind: "contract", label: "合同", count: 1 }]);
  });

  it("creates a case, files into an existing one, and shelves general papers", async () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-plan-ws-"));
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lm-plan-root-"));
    dirs.push(ws, root);
    await createMatterIfAbsent(ws, "华能采购案", { displayName: "华能采购案" });
    fs.mkdirSync(path.join(root, "华能采购案"), { recursive: true });
    fs.writeFileSync(path.join(root, "华能采购案", "供货合同.docx"), "contract");
    fs.writeFileSync(path.join(root, "华能采购案", "补充协议.docx"), "addendum");
    fs.mkdirSync(path.join(root, "新客户案"), { recursive: true });
    fs.writeFileSync(path.join(root, "新客户案", "起诉状.docx"), "claim");
    fs.writeFileSync(path.join(root, "新客户案", "证据清单.docx"), "evidence");
    fs.mkdirSync(path.join(root, "下载"), { recursive: true });
    fs.writeFileSync(path.join(root, "下载", "笔记.pdf"), "note");
    fs.writeFileSync(path.join(root, "下载", "华能采购案备忘.pdf"), "memo");
    fs.mkdirSync(path.join(root, "Documents"), { recursive: true });
    fs.writeFileSync(path.join(root, "Documents", "章程.pdf"), "a");
    fs.writeFileSync(path.join(root, "Documents", "简介.pdf"), "b");
    expect(addScanRoot(ws, root).ok).toBe(true);
    await runHistoricalScan(ws);

    const plan = await buildScanPlan(ws);
    expect(plan?.createMatters).toEqual([{ label: "新客户案", count: 2 }]);
    expect(plan?.intoMatters).toEqual([
      { matterId: "华能采购案", displayName: "华能采购案", count: 3 },
    ]);
    expect(plan?.library.find((row) => row.kind === "other")?.count).toBe(3);
    expect(plan?.createMatters.some((row) => row.label === "Documents")).toBe(false);

    const applied = await applyScanPlan(ws, {
      createLabels: ["新客户案"],
      intoMatterIds: ["华能采购案"],
      libraryKinds: ["other"],
    });
    expect(applied).toMatchObject({ ok: true, created: 1 });
    expect(
      fs.readFileSync(path.join(ws, "cases", "华能采购案", "materials", "供货合同.docx"), "utf8"),
    ).toBe("contract");
    expect(
      fs.readFileSync(
        path.join(ws, "cases", "华能采购案", "materials", "华能采购案备忘.pdf"),
        "utf8",
      ),
    ).toBe("memo");
    expect(
      fs.readFileSync(path.join(ws, "cases", "新客户案", "materials", "起诉状.docx"), "utf8"),
    ).toBe("claim");
    expect(fs.readFileSync(path.join(ws, "library", "其他", "笔记.pdf"), "utf8")).toBe("note");
    expect(fs.readFileSync(path.join(root, "华能采购案", "供货合同.docx"), "utf8")).toBe(
      "contract",
    );
  });
});
