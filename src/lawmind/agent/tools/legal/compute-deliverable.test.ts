import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readDraft } from "../../../drafts/index.js";
import { findLawyerWork } from "../../../work/store.js";
import {
  ANALYSIS_TABLE_DELIVERABLE,
  computePackTaskId,
  markdownTablePreview,
  persistComputeDeliverablePack,
} from "./compute-deliverable.js";
import { writeXlsxWorkbook } from "./xlsx-workbook.js";

const dirs: string[] = [];

function tmpWs(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lm-compute-pack-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const d of dirs.splice(0)) {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

describe("persistComputeDeliverablePack", () => {
  it("writes an analysis.table draft, relocates xlsx, and puts work on 在办", async () => {
    const ws = tmpWs();
    const src = path.join(ws, "artifacts", "out.xlsx");
    fs.mkdirSync(path.dirname(src), { recursive: true });
    await writeXlsxWorkbook(src, [
      {
        name: "分析",
        rows: [["合计"], [30]],
      },
    ]);
    const pack = await persistComputeDeliverablePack({
      workspaceDir: ws,
      sessionId: "s1",
      purpose: "汇总费用并出图",
      tables: [{ path: "artifacts/out.xlsx", sheet: "分析", rowCount: 1 }],
      charts: [
        {
          path: "artifacts/charts/ab.json",
          spec: {
            title: "费用",
            type: "bar",
            categories: ["合计"],
            series: [{ name: "额", values: [30] }],
          },
        },
      ],
      value: 30,
    });
    expect(pack?.taskId).toBe(computePackTaskId("s1", "汇总费用并出图"));
    expect(pack?.title).toBe("汇总费用并出图");
    expect(pack?.tables[0]?.path).toMatch(/汇总费用并出图_\d{8}_01\.xlsx$/);
    expect(fs.existsSync(path.join(ws, pack!.tables[0].path))).toBe(true);

    const draft = readDraft(ws, pack!.taskId);
    expect(draft?.deliverableType).toBe(ANALYSIS_TABLE_DELIVERABLE);
    expect(draft?.reviewStatus).toBe("pending");
    expect(draft?.sections.map((s) => s.heading)).toEqual(
      expect.arrayContaining(["结论", "对照", "来源", "图"]),
    );
    expect(draft?.sections.find((s) => s.heading === "对照")?.body).toContain("30");
    expect(draft?.sections.find((s) => s.heading === "图")?.body).toContain("```lm-chart");
    expect(JSON.stringify(draft)).not.toContain("readTable");

    const work = findLawyerWork(ws, { taskId: pack!.taskId });
    expect(work?.status).toBe("needs_signoff");
    expect(work?.title).toBe("汇总费用并出图");
  });

  it("writes the xlsx under the matter artifacts folder when matterId is set", async () => {
    const ws = tmpWs();
    const src = path.join(ws, "artifacts", "out.xlsx");
    fs.mkdirSync(path.dirname(src), { recursive: true });
    await writeXlsxWorkbook(src, [{ name: "分析", rows: [["合计"], [30]] }]);
    const pack = await persistComputeDeliverablePack({
      workspaceDir: ws,
      sessionId: "s1",
      matterId: "demo-case",
      purpose: "汇总费用并出图",
      tables: [{ path: "artifacts/out.xlsx", sheet: "分析", rowCount: 1 }],
      charts: [],
      value: 30,
    });
    expect(pack?.tables[0]?.path).toMatch(
      /^cases\/demo-case\/artifacts\/汇总费用并出图_\d{8}_01\.xlsx$/,
    );
    expect(fs.existsSync(path.join(ws, pack!.tables[0].path))).toBe(true);
    expect(readDraft(ws, pack!.taskId)?.matterId).toBe("demo-case");
  });

  it("skips a pack when there are no tables or charts", async () => {
    const pack = await persistComputeDeliverablePack({
      workspaceDir: tmpWs(),
      sessionId: "s1",
      purpose: "试算",
      tables: [],
      charts: [],
      value: 30,
    });
    expect(pack).toBeUndefined();
  });

  it("overwrites the same session+purpose pack instead of spawning a second task", async () => {
    const ws = tmpWs();
    const src = path.join(ws, "artifacts", "out.xlsx");
    fs.mkdirSync(path.dirname(src), { recursive: true });
    await writeXlsxWorkbook(src, [{ name: "分析", rows: [["合计"], [1]] }]);
    const first = await persistComputeDeliverablePack({
      workspaceDir: ws,
      sessionId: "s1",
      purpose: "汇总费用并出图",
      tables: [{ path: "artifacts/out.xlsx", sheet: "分析", rowCount: 1 }],
      charts: [],
      value: 1,
    });
    await writeXlsxWorkbook(src, [{ name: "分析", rows: [["合计"], [2]] }]);
    const second = await persistComputeDeliverablePack({
      workspaceDir: ws,
      sessionId: "s1",
      purpose: "汇总费用并出图",
      tables: [{ path: "artifacts/out.xlsx", sheet: "分析", rowCount: 1 }],
      charts: [],
      value: 2,
    });
    expect(second?.taskId).toBe(first?.taskId);
    const draft = readDraft(ws, second!.taskId);
    expect(draft?.summary).toContain("2");
  });
});

describe("markdownTablePreview", () => {
  it("renders a short markdown table", () => {
    expect(
      markdownTablePreview([
        ["项", "额"],
        ["a", 10],
      ]),
    ).toContain("| 项 | 额 |");
  });
});
