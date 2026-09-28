import { describe, expect, it } from "vitest";
import type { AcceptanceSheet } from "../../../../../src/lawmind/acceptance-sheet/model.ts";
import { compileCanvasSource } from "./compile-canvas";
import { acceptanceCanvasPath, embedCanvasJson, renderAcceptanceCanvas } from "./acceptance-canvas";

function sheet(): AcceptanceSheet {
  return {
    taskId: "task-1",
    title: "采购合同核对",
    summary: "导语里有 fetch( 和 </script>，不能当成代码。",
    hasDraft: true,
    claims: [
      {
        id: "c1",
        text: "违约金按日万分之五。",
        locator: "第 8 条",
        quote: "import x from \"react\"",
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
      {
        id: "c2",
        text: "已拿掉的句子",
        sources: [],
        mark: "removed",
        demo: false,
      },
    ],
    gaps: [{ id: "g1", text: "管辖没有出处" }],
    risks: [],
    table: {
      title: "费用",
      columns: [{ key: "name", label: "项" }],
      rows: [
        { id: "r1", cells: { name: "服务费" }, sourceLabel: "附件", sourced: true },
        { id: "r2", cells: { name: "差旅" }, sourceLabel: "未挂上", sourced: false },
      ],
    },
    charts: [
      {
        id: "ch1",
        title: "费用构成",
        specText: JSON.stringify({
          title: "费用构成",
          type: "bar",
          categories: ["服务费", "差旅"],
          series: [{ name: "金额", values: [20, 3] }],
          unit: "万元",
        }),
        sourcePath: "cases/m1/费用.xlsx",
      },
    ],
    removedCount: 1,
    open: true,
  };
}

describe("acceptance canvas", () => {
  it("names the workspace file after the task id", () => {
    expect(acceptanceCanvasPath("task-1")).toBe("canvas/核对-task-1.canvas.tsx");
    expect(acceptanceCanvasPath("../task")).toBeNull();
  });

  it("embeds hostile text so the canvas compiler still accepts the page", () => {
    const source = renderAcceptanceCanvas(sheet());
    expect(source).not.toContain("</script");
    expect(source).not.toMatch(/\bfetch\s*\(/);
    expect(source).not.toContain("import x from");
    expect(embedCanvasJson("fetch(")).toContain("\\u0066etch(");
    const compiled = compileCanvasSource(source);
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) {
      return;
    }
    expect(compiled.script).toContain("采购合同核对");
    expect(compiled.script).toContain("违约金按日万分之五");
    expect(compiled.script).not.toContain("已拿掉的句子");
    expect(compiled.script).toContain("去导出审阅稿");
    expect(compiled.script).toContain("费用构成");
  });
});
