import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  estimateMindmapLabelWidth,
  groupTimelineByYear,
  layoutMatterMindmap,
  matterArtifactPath,
  normalizeMatterArtifact,
  normalizeMatterDate,
  readMatterArtifact,
  summarizeMatterArtifact,
  type MatterMindmapNode,
} from "./matter-artifact.js";

const dirs: string[] = [];

function tmp(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lm-matter-artifact-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("normalizeMatterDate", () => {
  it("accepts common lawyer date spellings", () => {
    expect(normalizeMatterDate("2026-03-01")).toEqual({
      sortKey: "20260301",
      year: "2026",
      displayDate: "2026-03-01",
    });
    expect(normalizeMatterDate("2026年3月1日")).toEqual({
      sortKey: "20260301",
      year: "2026",
      displayDate: "2026-03-01",
    });
    expect(normalizeMatterDate("2026/3/1")?.sortKey).toBe("20260301");
    expect(normalizeMatterDate("2026年3月")?.sortKey).toBe("20260300");
    expect(normalizeMatterDate("2026")?.sortKey).toBe("20260000");
    expect(normalizeMatterDate("2026-13-01")).toBeNull();
    expect(normalizeMatterDate("去年秋天")).toBeNull();
  });
});

describe("normalizeMatterArtifact", () => {
  it("sorts events, fills ids, and flags undated rows instead of guessing", () => {
    const { artifact, issues } = normalizeMatterArtifact("case-timeline", {
      schemaVersion: 1,
      kind: "case-timeline",
      events: [
        {
          date: "2026-05-02",
          title: "对方发函催款",
          evidence: [
            { filePath: "cases/m/materials/函.pdf", lineRef: "P2", quote: "请于十日内付款" },
          ],
        },
        { date: "2025-12-20", title: "签订合同", evidence: [] },
        { date: "很久以前", title: "无日期" },
      ],
    });
    expect(artifact.kind).toBe("case-timeline");
    if (artifact.kind !== "case-timeline") {
      return;
    }
    expect(artifact.events.map((e) => e.title)).toEqual(["签订合同", "对方发函催款"]);
    expect(artifact.events[1]?.id).toBe("ev-1");
    expect(artifact.events[1]?.evidence[0]?.lineRef).toBe("P2");
    expect(issues.some((i) => i.reasonZh.includes("日期无法识别"))).toBe(true);
  });

  it("keeps chronology people and drops evidence entries without a path", () => {
    const { artifact, issues } = normalizeMatterArtifact("case-chronology", {
      entries: [
        {
          date: "2026-01-09",
          fact: "双方对账确认欠款 120 万元",
          people: ["张三", "李四"],
          evidence: [
            { quote: "无路径" },
            { filePath: "cases/m/materials/对账单.xlsx", lineRef: "S1!B4" },
          ],
        },
      ],
    });
    expect(artifact.kind).toBe("case-chronology");
    if (artifact.kind !== "case-chronology") {
      return;
    }
    expect(artifact.entries[0]?.people).toEqual(["张三", "李四"]);
    expect(artifact.entries[0]?.evidence).toHaveLength(1);
    expect(issues.some((i) => i.reasonZh.includes("缺少 filePath"))).toBe(true);
  });

  it("caps mindmap depth and keeps labels", () => {
    let node: Record<string, unknown> = { label: "第6层", children: [] };
    for (let depth = 5; depth >= 0; depth -= 1) {
      node = { label: `第${depth}层`, children: [node] };
    }
    const { artifact } = normalizeMatterArtifact("case-mindmap", { root: node });
    expect(artifact.kind).toBe("case-mindmap");
    if (artifact.kind !== "case-mindmap") {
      return;
    }
    const depthOf = (n: MatterMindmapNode, d = 0): number =>
      n.children.length === 0 ? d : Math.max(...n.children.map((c) => depthOf(c, d + 1)));
    expect(depthOf(artifact.root)).toBe(6);
  });
});

describe("readMatterArtifact", () => {
  it("returns missing, then ok with issues for partial data, then invalid for broken JSON", () => {
    const ws = tmp();
    expect(readMatterArtifact(ws, "m-1", "case-timeline")).toEqual({ status: "missing" });

    const file = matterArtifactPath(ws, "m-1", "case-timeline");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(
      file,
      JSON.stringify({
        schemaVersion: 1,
        kind: "case-timeline",
        events: [
          { date: "2026-01-01", title: "立案" },
          { date: "??", title: "坏日期" },
        ],
      }),
      "utf8",
    );
    const partial = readMatterArtifact(ws, "m-1", "case-timeline");
    expect(partial.status).toBe("ok");
    if (partial.status === "ok") {
      expect(partial.artifact.kind).toBe("case-timeline");
      expect(partial.issues.length).toBe(1);
    }

    fs.writeFileSync(file, "{not json", "utf8");
    expect(readMatterArtifact(ws, "m-1", "case-timeline").status).toBe("invalid");
  });

  it("stores artifacts at the visible case root, not the JSON storage root", () => {
    const ws = tmp();
    const file = matterArtifactPath(ws, "甲案", "case-chronology");
    expect(file.endsWith(path.join("cases", "甲案", "project.case-chronology.json"))).toBe(true);
  });
});

describe("summaries and grouping", () => {
  const timeline = normalizeMatterArtifact("case-timeline", {
    events: [
      { date: "2026-03-01", title: "立案", evidence: [{ filePath: "a.txt", lineRef: "L1" }] },
      { date: "2025-11-02", title: "签约", evidence: [] },
      { date: "2026-03-08", title: "开庭", evidence: [{ filePath: "b.txt" }] },
    ],
  }).artifact;

  it("counts anchored rows and year range", () => {
    expect(summarizeMatterArtifact(timeline)).toEqual({
      itemCount: 3,
      anchoredCount: 2,
      unanchoredCount: 1,
      yearFrom: "2025",
      yearTo: "2026",
    });
  });

  it("groups by year in ascending order with MM-DD labels", () => {
    const groups = groupTimelineByYear(timeline);
    expect(groups.map((g) => g.year)).toEqual(["2025", "2026"]);
    expect(groups[1]?.items.map((i) => i.shortDate)).toEqual(["03-01", "03-08"]);
    expect(groups[1]?.items[0]?.displayDate).toBe("2026-03-01");
  });
});

describe("layoutMatterMindmap", () => {
  const root: MatterMindmapNode = {
    id: "root",
    label: "租赁纠纷",
    kind: "issue",
    children: [
      {
        id: "a",
        label: "合同效力",
        children: [
          { id: "a1", label: "签章真实性", children: [] },
          { id: "a2", label: "无权代理", children: [] },
        ],
      },
      { id: "b", label: "租金标准", children: [] },
    ],
  };

  it("is deterministic and centers parents between children", () => {
    const first = layoutMatterMindmap(root);
    const second = layoutMatterMindmap(root);
    expect(first).toEqual(second);
    const byId = new Map(first.nodes.map((n) => [n.id, n]));
    const a = byId.get("a")!;
    const a1 = byId.get("a1")!;
    const a2 = byId.get("a2")!;
    expect(a.y).toBeCloseTo((a1.y + a2.y) / 2, 5);
    expect(byId.get("a1")!.x).toBeGreaterThan(a.x);
    expect(first.edges).toEqual([
      { from: "root", to: "a" },
      { from: "a", to: "a1" },
      { from: "a", to: "a2" },
      { from: "root", to: "b" },
    ]);
  });

  it("keeps width within node bounds and grows with depth", () => {
    const layout = layoutMatterMindmap(root);
    expect(layout.width).toBeGreaterThan(200);
    expect(layout.height).toBeGreaterThan(0);
    for (const node of layout.nodes) {
      expect(node.x + node.width).toBeLessThanOrEqual(layout.width);
      expect(node.y + node.height).toBeLessThanOrEqual(layout.height);
    }
  });

  it("estimates wider boxes for longer CJK labels", () => {
    expect(estimateMindmapLabelWidth("合同效力认定的争点与抗辩顺序")).toBeGreaterThan(
      estimateMindmapLabelWidth("ab"),
    );
  });
});
