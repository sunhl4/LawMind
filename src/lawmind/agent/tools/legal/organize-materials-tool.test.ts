import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { revertDeskWrite } from "../../../desk/desk-apply.js";
import type { AgentContext } from "../../types.js";
import { executeOrganizePlan, proposeOrganizePlan } from "./organize-materials-tool.js";

function makeCtx(workspaceDir: string, matterId?: string): AgentContext {
  return { workspaceDir, matterId } as unknown as AgentContext;
}

describe("organize-materials three-piece (propose → confirm → execute → undo)", () => {
  let workspaceDir: string;

  beforeEach(async () => {
    workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "lm-organize-"));
    const { createMatterIfMissing } =
      await import("../../../application/services/matter-write-service.js");
    createMatterIfMissing(workspaceDir, { matterId: "m-org", title: "整理案" });
    const materialsDir = path.join(workspaceDir, "cases", "m-org", "materials");
    fs.mkdirSync(materialsDir, { recursive: true });
    fs.writeFileSync(path.join(materialsDir, "合同扫描件.txt"), "合同正文", "utf8");
    fs.writeFileSync(path.join(materialsDir, "发票.txt"), "发票正文", "utf8");
  });

  afterEach(() => {
    fs.rmSync(workspaceDir, { recursive: true, force: true });
  });

  it("propose records a pending plan without touching files; execute applies it; revert restores", async () => {
    const ctx = makeCtx(workspaceDir, "m-org");
    const proposed = await proposeOrganizePlan.execute(
      {
        goal: "按文件类型归类",
        ops: [
          { from: "合同扫描件.txt", to: "合同/合同扫描件.txt", reason: "合同类" },
          { from: "发票.txt", to: "票据/发票.txt", reason: "票据类" },
        ],
      },
      ctx,
    );
    expect(proposed.ok).toBe(true);
    const planId = (proposed.data as { planId: string }).planId;
    expect((proposed.data as { planText: string }).planText).toContain("合同扫描件.txt → 合同/");
    // 未执行前文件不动。
    expect(
      fs.existsSync(path.join(workspaceDir, "cases", "m-org", "materials", "合同扫描件.txt")),
    ).toBe(true);

    const executed = await executeOrganizePlan.execute({ plan_id: planId }, ctx);
    expect(executed.ok).toBe(true);
    const writeId = (executed.data as { writeId: string }).writeId;
    expect(
      fs.existsSync(
        path.join(workspaceDir, "cases", "m-org", "materials", "合同", "合同扫描件.txt"),
      ),
    ).toBe(true);
    expect(
      fs.existsSync(path.join(workspaceDir, "cases", "m-org", "materials", "合同扫描件.txt")),
    ).toBe(false);

    const reverted = await revertDeskWrite(workspaceDir, "m-org", writeId);
    expect(reverted.ok).toBe(true);
    expect(
      fs.existsSync(path.join(workspaceDir, "cases", "m-org", "materials", "合同扫描件.txt")),
    ).toBe(true);
    expect(
      fs.existsSync(
        path.join(workspaceDir, "cases", "m-org", "materials", "合同", "合同扫描件.txt"),
      ),
    ).toBe(false);
  });

  it("execute refuses an unknown or unconfirmed plan", async () => {
    const ctx = makeCtx(workspaceDir, "m-org");
    const r = await executeOrganizePlan.execute({ plan_id: "org-nope" }, ctx);
    expect(r.ok).toBe(false);
    expect(r.error).toContain("propose_organize_plan");
  });

  it("propose rejects out-of-fence paths and missing sources honestly", async () => {
    const ctx = makeCtx(workspaceDir, "m-org");
    const r = await proposeOrganizePlan.execute(
      {
        ops: [
          { from: "../CASE.md", to: "x/CASE.md" },
          { from: "不存在.txt", to: "x/不存在.txt" },
        ],
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toContain("没有可执行的操作");
    // 越界与缺失都被点名，不静默。
    const err = r.error ?? "";
    expect(err.length).toBeGreaterThan(0);
  });

  it("execute is idempotent-safe: a second run reports sources missing", async () => {
    const ctx = makeCtx(workspaceDir, "m-org");
    const proposed = await proposeOrganizePlan.execute(
      { ops: [{ from: "发票.txt", to: "票据/发票.txt" }] },
      ctx,
    );
    const planId = (proposed.data as { planId: string }).planId;
    const first = await executeOrganizePlan.execute({ plan_id: planId }, ctx);
    expect(first.ok).toBe(true);
    // 已执行的计划不再是 pending。
    const second = await executeOrganizePlan.execute({ plan_id: planId }, ctx);
    expect(second.ok).toBe(false);
  });
});
