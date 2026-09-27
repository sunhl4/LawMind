import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  listMemorySuggestions,
  suggestMemoryAdoption,
  type MemoryAdoptionRecord,
} from "./adoption-service.js";
import {
  LOW_RISK_STYLE_KINDS,
  adoptBatch,
  isLowRiskStyleAdoption,
  planBatchAdoption,
} from "./batch-adoption.js";

describe("batch adoption", () => {
  let workspaceDir: string;
  let auditDir: string;

  beforeEach(async () => {
    workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "lm-batch-adopt-"));
    auditDir = path.join(workspaceDir, "audit");
    await fs.mkdir(auditDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(workspaceDir, { recursive: true, force: true });
  });

  async function seed(
    kind: MemoryAdoptionRecord["kind"],
    payload: string,
    scope: MemoryAdoptionRecord["scope"] = "lawyer",
  ): Promise<MemoryAdoptionRecord> {
    return suggestMemoryAdoption(workspaceDir, auditDir, {
      scope,
      kind,
      payload,
      origin: "engine",
    });
  }

  it("plans without writing and previews every low-risk style item", async () => {
    const style = await seed("review_label", "习惯：结论前置");
    await seed("case.core_issue", "争点：付款条件是否成就", "matter");

    const plan = await planBatchAdoption(workspaceDir, { dryRun: true });
    expect(plan.mode).toBe("low_risk_style");
    expect(plan.items.map((i) => i.id)).toEqual([style.id]);
    expect(plan.items[0]?.lowRiskStyle).toBe(true);
    expect(plan.items[0]?.summary).toContain("结论前置");
    expect(plan.note).toContain("未确认的一条都不写");
    // 预览是纯读：一条都还没写
    const after = await listMemorySuggestions(workspaceDir);
    expect(after.every((r) => r.state === "pending")).toBe(true);
  });

  it("plans by explicit ids and reports ids that are no longer pending", async () => {
    const a = await seed("review_label", "习惯 A");
    const b = await seed("firm.preference", "偏好 B", "firm");

    const plan = await planBatchAdoption(workspaceDir, { mode: "ids", ids: [a.id, "missing-id"] });
    expect(plan.items.map((i) => i.id)).toEqual([a.id]);
    expect(plan.blocked).toEqual([
      { id: "missing-id", reason: "不在待审列表（可能已被采纳或忽略）" },
    ]);
    expect(plan.adoptableIds).toEqual([a.id]);

    const after = await listMemorySuggestions(workspaceDir);
    expect(after.find((r) => r.id === b.id)?.state).toBe("pending");
  });

  it("adopts every confirmed id in one call", async () => {
    const a = await seed("firm.preference", "偏好：条款清单一律给中英对照", "firm");
    const b = await seed("playbook.clause_learning", "惯用条款：付款先票后款", "playbook");

    const result = await adoptBatch(workspaceDir, auditDir, [a.id, b.id], {
      actorId: "lawyer:test",
    });
    expect(result.ok).toBe(true);
    expect(result.adopted).toEqual([a.id, b.id]);
    expect(result.failed).toEqual([]);

    const after = await listMemorySuggestions(workspaceDir);
    for (const id of [a.id, b.id]) {
      const row = after.find((r) => r.id === id);
      expect(row?.state === "adopted" || row?.state === "recorded_noop").toBe(true);
    }
  });

  it("keeps the rest of the batch when one writer throws", async () => {
    // review_label 无 sourceTaskId 时写入面会抛错：不得因此掀掉整批。
    const broken = await seed("review_label", "标签学习缺来源任务");
    const ok = await seed("firm.preference", "偏好：统一用「我方」", "firm");

    const result = await adoptBatch(workspaceDir, auditDir, [broken.id, ok.id]);
    expect(result.ok).toBe(false);
    expect(result.adopted).toEqual([ok.id]);
    expect(result.failed[0]?.id).toBe(broken.id);
    expect(result.failed[0]?.error).toContain("review_label_source_task_required");
  });

  it("reports a per-item failure without rolling back the rest", async () => {
    const a = await seed("firm.preference", "偏好 A", "firm");
    const result = await adoptBatch(workspaceDir, auditDir, [a.id, "ghost-id"]);
    expect(result.ok).toBe(false);
    expect(result.adopted).toEqual([a.id]);
    expect(result.failed).toEqual([{ id: "ghost-id", error: "not_found" }]);
  });

  it("classifies低风险风格 kinds only", () => {
    for (const kind of LOW_RISK_STYLE_KINDS) {
      expect(isLowRiskStyleAdoption({ kind })).toBe(true);
    }
    expect(isLowRiskStyleAdoption({ kind: "case.core_issue" })).toBe(false);
    expect(isLowRiskStyleAdoption({ kind: "client.profile_note" })).toBe(false);
    expect(
      isLowRiskStyleAdoption({
        kind: "lawyer.profile_learning",
        payload: "「付款」：改后「于2026年10月5日前支付1,200,000元」",
      }),
    ).toBe(false);
  });
});
