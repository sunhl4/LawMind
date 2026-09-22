import { describe, expect, it } from "vitest";
import { buildLpmMemoSections, inferLpmMemoKind } from "./lpm-matter-columns.js";

describe("lpm-matter-columns", () => {
  it("routes status, scope change and close without blocking", () => {
    expect(inferLpmMemoKind("写本案办案周报")).toBe("status");
    expect(inferLpmMemoKind("事项范围变更说明")).toBe("scope_change");
    expect(inferLpmMemoKind("写一份结案备忘")).toBe("close");
    expect(inferLpmMemoKind("写一份本地顾问对接")).toBe("local_counsel");
    expect(inferLpmMemoKind("写办案人力安排")).toBe("resource_plan");
    expect(inferLpmMemoKind("写干系人沟通计划")).toBe("stakeholder_comms");
    expect(inferLpmMemoKind("写一份待签发清单")).toBe("issuance_list");
    expect(inferLpmMemoKind("写事项协作建议")).toBe("collab_platform");
    expect(inferLpmMemoKind("请审查采购合同")).toBeUndefined();
  });

  it("status columns cover progress, RAID, confidence and dated next steps", () => {
    const headings = buildLpmMemoSections("status", "")
      .map((s) => s.heading)
      .join(" ");
    expect(headings).toMatch(/事项/);
    expect(headings).toMatch(/进度/);
    expect(headings).toMatch(/范围/);
    expect(headings).toMatch(/风险与已决/);
    expect(headings).toMatch(/置信/);
    expect(headings).toMatch(/结论/);
    expect(headings).toMatch(/待办/);
    const body = buildLpmMemoSections("status", "")
      .map((s) => s.body)
      .join("\n");
    expect(body).toContain("不要写开会次数");
    expect(body).toContain("截止日期");
    expect(body).toContain("不自动消解");
  });

  it("local counsel, resource plan and comms plans produce without blocking", () => {
    const local = buildLpmMemoSections("local_counsel", "")
      .map((s) => s.body)
      .join("\n");
    expect(local).toContain("不把冲突表当开工闸门");
    const resource = buildLpmMemoSections("resource_plan", "")
      .map((s) => s.heading)
      .join(" ");
    expect(resource).toMatch(/角色/);
    expect(resource).toMatch(/关键路径/);
    const comms = buildLpmMemoSections("stakeholder_comms", "")
      .map((s) => s.body)
      .join("\n");
    expect(comms).toContain("飞书云文档和日历写入不是交件");
    expect(comms).toContain("不是律师函");
    const issuance = buildLpmMemoSections("issuance_list", "")
      .map((s) => s.body)
      .join("\n");
    expect(issuance).toContain("不是审批页");
    const collab = buildLpmMemoSections("collab_platform", "")
      .map((s) => s.body)
      .join("\n");
    expect(collab).toContain("不要把写入飞书");
  });
});
