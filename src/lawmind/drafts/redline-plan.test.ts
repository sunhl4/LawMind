import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  formatRedlinePlanPromptBlock,
  buildXmlQaRetryHint,
  normalizeRedlinePlanItems,
  readRedlinePlan,
  shouldInjectRedlinePlanProtocol,
  writeRedlinePlan,
} from "./redline-plan.js";

describe("redline-plan", () => {
  let tmp: string | undefined;

  afterEach(() => {
    if (tmp) {
      fs.rmSync(tmp, { recursive: true, force: true });
      tmp = undefined;
    }
  });

  it("narrows a wide find to the shortest differing span", () => {
    const { items, skipped } = normalizeRedlinePlanItems([
      {
        find: "适用中华人民共和国法律，争议提交上海仲裁委员会。",
        replace: "适用中华人民共和国法律，争议提交北京仲裁委员会。",
      },
    ]);
    expect(skipped).toHaveLength(0);
    expect(items[0]?.find).toBe("上海");
    expect(items[0]?.replace).toBe("北京");
    expect(items[0]?.narrowed).toBe(true);
  });

  it("skips empty or identical pairs", () => {
    const { items, skipped } = normalizeRedlinePlanItems([
      { find: "", replace: "x" },
      { find: "甲", replace: "甲" },
    ]);
    expect(items).toHaveLength(0);
    expect(skipped.length).toBeGreaterThan(0);
  });

  it("round-trips a sidecar plan", () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lm-redline-plan-"));
    writeRedlinePlan(tmp, {
      taskId: "t1",
      items: [{ find: "上海", replace: "北京" }],
      skipped: [],
      updatedAt: "2026-09-08T00:00:00.000Z",
    });
    const read = readRedlinePlan(tmp, "t1");
    expect(read?.items[0]?.find).toBe("上海");
    expect(read?.items[0]?.replace).toBe("北京");
  });

  it("injects the plan protocol only on unlocked 合同审查", () => {
    expect(
      shouldInjectRedlinePlanProtocol({ id: "contract.review", pipeline: "execute_workflow" }),
    ).toBe(true);
    expect(
      shouldInjectRedlinePlanProtocol({ id: "contract.review", pipeline: "tracked_redline" }),
    ).toBe(false);
    expect(
      shouldInjectRedlinePlanProtocol({ id: "mail.contract", pipeline: "execute_workflow" }),
    ).toBe(false);
    expect(formatRedlinePlanPromptBlock()).toContain("apply_surgical_edits");
    expect(formatRedlinePlanPromptBlock()).toContain("render_tracked_draft");
  });

  it("builds a narrow-and-reapply XML QA hint from the plan sidecar", () => {
    const hint = buildXmlQaRetryHint({
      taskId: "t",
      items: [
        {
          find: "适用中华人民共和国法律，争议提交上海仲裁委员会。",
          replace: "适用中华人民共和国法律，争议提交北京仲裁委员会。",
        },
      ],
      skipped: [],
      updatedAt: new Date().toISOString(),
    });
    expect(hint.action).toBe("narrow_and_reapply");
    expect(hint.edits[0]?.find).toBe("上海");
    expect(hint.edits[0]?.replace).toBe("北京");
  });
});
