import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readReviewTable } from "../../../deliverables/review-table.js";
import { persistDraft, readDraft } from "../../../drafts/index.js";
import type { AgentContext } from "../../types.js";
import { reviewTableUpdate } from "./review-table-tool.js";

function makeCtx(workspaceDir: string): AgentContext {
  return { workspaceDir } as unknown as AgentContext;
}

function seedDraft(workspaceDir: string, taskId: string, matterId?: string): void {
  persistDraft(workspaceDir, {
    taskId,
    ...(matterId ? { matterId } : {}),
    title: "尽调审查表",
    summary: "",
    output: "docx",
    templateId: "word/legal-memo-default",
    deliverableType: "review.table",
    sections: [{ heading: "结论与说明", body: "见审查表明细。", citations: [] }],
    reviewNotes: [],
    reviewStatus: "pending",
    createdAt: new Date().toISOString(),
  });
}

describe("review_table_update", () => {
  let workspaceDir: string;

  beforeEach(() => {
    workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "lm-review-table-"));
    seedDraft(workspaceDir, "t-table");
  });

  afterEach(() => {
    fs.rmSync(workspaceDir, { recursive: true, force: true });
  });

  it("requires set_template before other actions", async () => {
    const r = await reviewTableUpdate.execute(
      { task_id: "t-table", action: "add_rows", rows: [{ cells: { item: "x" } }] },
      makeCtx(workspaceDir),
    );
    expect(r.ok).toBe(false);
    expect(r.error).toContain("set_template");
  });

  it("builds a table, adds rows, syncs the draft section, and reports acceptance gaps", async () => {
    const ctx = makeCtx(workspaceDir);
    const created = await reviewTableUpdate.execute(
      { task_id: "t-table", action: "set_template", template: "due_diligence" },
      ctx,
    );
    expect(created.ok).toBe(true);

    const added = await reviewTableUpdate.execute(
      {
        task_id: "t-table",
        action: "add_rows",
        rows: [
          {
            cells: { item: "股权结构", finding: "存在代持", risk: "高" },
            source: "cases/m/materials/a.pdf",
          },
          { cells: { item: "重大合同", finding: "缺少违约条款" } },
        ],
      },
      ctx,
    );
    expect(added.ok).toBe(true);
    expect((added.data as { rowCount: number }).rowCount).toBe(2);
    // 缺来源的行被点名为验收缺口，不静默通过。
    expect((added.data as { acceptanceGaps?: string[] }).acceptanceGaps).toEqual(["1 行缺来源"]);

    const table = readReviewTable(workspaceDir, "t-table");
    expect(table?.template).toBe("due_diligence");
    expect(table?.rows).toHaveLength(2);

    // 草稿正文同步 markdown 预览（与 agent 工具同一真相源）。
    const draft = readDraft(workspaceDir, "t-table");
    const section = draft?.sections.find((s) => s.heading === "审查表");
    expect(section?.body).toContain("股权结构");
    expect(section?.body).toContain("| 审查事项 |");
  });

  it("update_cells rejects unknown row ids; group_by groups by a real column", async () => {
    const ctx = makeCtx(workspaceDir);
    await reviewTableUpdate.execute(
      { task_id: "t-table", action: "set_template", template: "evidence" },
      ctx,
    );
    await reviewTableUpdate.execute(
      {
        task_id: "t-table",
        action: "add_rows",
        rows: [
          { cells: { exhibit: "劳动合同", source: "s1" } },
          { cells: { exhibit: "工资流水", source: "s2" } },
        ],
      },
      ctx,
    );
    const miss = await reviewTableUpdate.execute(
      {
        task_id: "t-table",
        action: "update_cells",
        updates: [{ rowId: "nope", cells: { purpose: "x" } }],
      },
      ctx,
    );
    expect(miss.ok).toBe(false);

    const grouped = await reviewTableUpdate.execute(
      { task_id: "t-table", action: "group_by", column: "exhibit" },
      ctx,
    );
    expect(grouped.ok).toBe(true);
    const table = readReviewTable(workspaceDir, "t-table");
    expect(table?.rows.every((r) => r.group === r.cells.exhibit)).toBe(true);

    const badCol = await reviewTableUpdate.execute(
      { task_id: "t-table", action: "group_by", column: "not_a_column" },
      ctx,
    );
    expect(badCol.ok).toBe(false);
  });

  it("imports matter materials metadata as rows with source paths", async () => {
    seedDraft(workspaceDir, "t-mat", "m-x");
    const dir = path.join(workspaceDir, "cases", "m-x", "materials");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "尽调清单.txt"), "清单", "utf8");
    fs.writeFileSync(path.join(dir, "章程.txt"), "章程", "utf8");
    const ctx = makeCtx(workspaceDir);
    await reviewTableUpdate.execute(
      { task_id: "t-mat", action: "set_template", template: "due_diligence" },
      ctx,
    );
    const r = await reviewTableUpdate.execute(
      { task_id: "t-mat", action: "import_materials_metadata" },
      ctx,
    );
    expect(r.ok).toBe(true);
    expect((r.data as { rowCount: number }).rowCount).toBe(2);
    const table = readReviewTable(workspaceDir, "t-mat");
    expect(table?.rows.map((row) => row.source)).toEqual([
      "cases/m-x/materials/尽调清单.txt",
      "cases/m-x/materials/章程.txt",
    ]);
  });

  it("refuses a missing draft or unknown action honestly", async () => {
    const ctx = makeCtx(workspaceDir);
    const noDraft = await reviewTableUpdate.execute(
      { task_id: "nope", action: "set_template", template: "evidence" },
      ctx,
    );
    expect(noDraft.ok).toBe(false);
    const badAction = await reviewTableUpdate.execute(
      { task_id: "t-table", action: "explode" },
      ctx,
    );
    expect(badAction.ok).toBe(false);
  });
});

describe("review_table_update · scale extraction", () => {
  let workspaceDir: string;
  const matterId = "m-batch";

  beforeEach(() => {
    workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "lm-review-batch-"));
    seedDraft(workspaceDir, "t-batch", matterId);
  });

  afterEach(() => {
    fs.rmSync(workspaceDir, { recursive: true, force: true });
  });

  function seedMaterials(files: Record<string, string>): void {
    const dir = path.join(workspaceDir, "cases", matterId, "materials");
    fs.mkdirSync(dir, { recursive: true });
    for (const [name, body] of Object.entries(files)) {
      fs.writeFileSync(path.join(dir, name), body, "utf8");
    }
  }

  async function buildExtractionTable(ctx: AgentContext): Promise<void> {
    await reviewTableUpdate.execute(
      { task_id: "t-batch", action: "set_template", template: "due_diligence" },
      ctx,
    );
    // 换成抽取型列：每列都能映射到确定性模式。
    await reviewTableUpdate.execute(
      {
        task_id: "t-batch",
        action: "set_columns",
        columns: [
          { key: "document", label: "对应文件" },
          { key: "amount", label: "金额" },
          { key: "date", label: "日期" },
          { key: "court", label: "管辖法院" },
          { key: "source", label: "来源" },
        ],
      },
      ctx,
    );
  }

  it("extracts a whole material set in one call, with per-cell sources", async () => {
    seedMaterials({
      "付款函.txt": "甲方应于2024年3月1日前支付人民币120,000元。争议提交北京市朝阳区人民法院管辖。",
      "章程.txt": "本章程未载明付款安排。",
    });
    const ctx = makeCtx(workspaceDir);
    await buildExtractionTable(ctx);

    const r = await reviewTableUpdate.execute({ task_id: "t-batch", action: "extract_batch" }, ctx);
    expect(r.ok).toBe(true);
    const data = r.data as {
      rowCount: number;
      provenance: { sourced: number; abstained: number };
      note: string;
    };
    expect(data.rowCount).toBe(2);
    expect(data.provenance.sourced).toBeGreaterThan(0);

    const table = readReviewTable(workspaceDir, "t-batch");
    const row = table!.rows.find((x) => x.cells["document"] === "付款函.txt")!;
    expect(row.cells["amount"]).toContain("120,000");
    expect(row.cells["court"]).toContain("人民法院");
    expect(row.cellMeta?.["amount"]?.source).toContain("付款函.txt");
    expect(row.source).toBe(`cases/${matterId}/materials/付款函.txt`);
  });

  it("files one honest row per material and abstains where the text has nothing", async () => {
    seedMaterials({ "无关材料.txt": "本文与交易无关。" });
    const ctx = makeCtx(workspaceDir);
    await buildExtractionTable(ctx);
    const r = await reviewTableUpdate.execute({ task_id: "t-batch", action: "extract_batch" }, ctx);
    expect(r.ok).toBe(true);
    const table = readReviewTable(workspaceDir, "t-batch");
    const row = table!.rows[0];
    // 没有命中 → 逐格弃答，但材料名与出处仍在，行可追溯。
    expect(row.cells["amount"]).toBe("无法判断（证据不足）");
    expect(row.cellMeta?.["amount"]?.abstained).toBe(true);
    expect(row.cells["document"]).toBe("无关材料.txt");
    expect(row.source).toBeTruthy();
  });

  it("refuses to run without a matter instead of guessing a scope", async () => {
    seedDraft(workspaceDir, "t-nomatter");
    const ctx = makeCtx(workspaceDir);
    await reviewTableUpdate.execute(
      { task_id: "t-nomatter", action: "set_template", template: "due_diligence" },
      ctx,
    );
    const r = await reviewTableUpdate.execute(
      { task_id: "t-nomatter", action: "extract_batch" },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toContain("未关联案件");
  });

  it("marks rows reviewed/locked locally and reports it", async () => {
    seedMaterials({ "a.txt": "金额 100 元" });
    const ctx = makeCtx(workspaceDir);
    await buildExtractionTable(ctx);
    await reviewTableUpdate.execute({ task_id: "t-batch", action: "extract_batch" }, ctx);

    const marked = await reviewTableUpdate.execute(
      { task_id: "t-batch", action: "set_review", review: "locked", assignee: "张律师" },
      ctx,
    );
    expect(marked.ok).toBe(true);
    expect((marked.data as { note: string }).note).toContain("锁定");

    const table = readReviewTable(workspaceDir, "t-batch");
    expect(table!.rows.every((r) => r.review?.locked === true)).toBe(true);
    expect(table!.rows[0].review?.assignee).toBe("张律师");

    const bad = await reviewTableUpdate.execute(
      { task_id: "t-batch", action: "set_review", review: "looked" },
      ctx,
    );
    expect(bad.ok).toBe(false);
  });

  it("pushes verified conclusions plus sources into the draft, and isolates abstains", async () => {
    seedMaterials({
      "付款函.txt": "甲方应于2024年3月1日前支付人民币120,000元。",
      "章程.txt": "本章程未载明付款安排。",
    });
    const ctx = makeCtx(workspaceDir);
    await buildExtractionTable(ctx);
    await reviewTableUpdate.execute({ task_id: "t-batch", action: "extract_batch" }, ctx);

    const pushed = await reviewTableUpdate.execute({ task_id: "t-batch", action: "to_draft" }, ctx);
    expect(pushed.ok).toBe(true);

    const draft = readDraft(workspaceDir, "t-batch");
    const section = draft?.sections.find((s) => s.heading === "审查结论");
    expect(section?.body).toContain("出处：");
    expect(section?.body).toContain("120,000");
    // 未能取得的项单独成节，不混进结论。
    expect(section?.body).toContain("未能取得的项");
  });
});
