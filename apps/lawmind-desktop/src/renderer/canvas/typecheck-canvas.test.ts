import { describe, expect, it } from "vitest";
import type { AcceptanceSheet } from "../../../../../src/lawmind/acceptance-sheet/model.ts";
import { renderAcceptanceCanvas } from "./acceptance-canvas";
import { typecheckCanvasSource } from "./typecheck-canvas";

const page = `
import { H1, Stack } from "cursor/canvas";
export default function Page() {
  return <Stack><H1>核对</H1></Stack>;
}
`;

function sheet(): AcceptanceSheet {
  return {
    taskId: "task-1",
    title: "采购合同核对",
    summary: "导语",
    hasDraft: true,
    claims: [
      {
        id: "c1",
        text: "违约金按日万分之五。",
        locator: "第 8 条",
        sources: [
          {
            id: "s1",
            title: "合同",
            citation: "合同正文",
            relPath: "cases/m1/合同.docx",
            openKind: "word",
          },
        ],
        mark: "accepted",
        demo: false,
      },
    ],
    gaps: [{ id: "g1", text: "管辖没有出处" }],
    risks: [],
    table: {
      title: "费用",
      columns: [{ key: "name", label: "项" }],
      rows: [{ id: "r1", cells: { name: "服务费" }, sourceLabel: "附件", sourced: false }],
    },
    charts: [
      {
        id: "ch1",
        title: "费用构成",
        specText: JSON.stringify({
          title: "费用构成",
          type: "bar",
          categories: ["服务费"],
          series: [{ name: "金额", values: [20] }],
          unit: "万元",
        }),
        sourcePath: "cases/m1/费用.xlsx",
      },
    ],
    removedCount: 0,
    open: true,
  };
}

describe("typecheckCanvasSource", () => {
  it("accepts a canvas that only uses imported components", () => {
    expect(typecheckCanvasSource(page)).toEqual([]);
  });

  it("accepts the generated acceptance canvas", () => {
    expect(typecheckCanvasSource(renderAcceptanceCanvas(sheet()))).toEqual([]);
  });

  it("accepts ordinary string and math helpers", () => {
    expect(
      typecheckCanvasSource(`import { Text } from "cursor/canvas";
export default function Page() {
  const label = "费用".trim();
  return <Text>{Math.round(1.2)} {label.includes("费") ? "有" : "无"}</Text>;
}
`),
    ).toEqual([]);
  });

  it("reports a button variant the component does not have", () => {
    const diagnostics = typecheckCanvasSource(`import { Button } from "cursor/canvas";
export default function Page() {
  return <Button variant="nope">去导出</Button>;
}
`);
    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics[0]?.message).toMatch(/nope|variant/);
    expect(diagnostics[0]?.line).toBe(3);
  });
});
