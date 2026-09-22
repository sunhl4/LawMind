import { describe, expect, it } from "vitest";
import {
  applyCrossDocumentEditsToSections,
  formatCrossDocumentSummary,
  planCrossDocumentEdits,
  type CrossDocumentChangeManifest,
  type CrossDocumentDoc,
} from "./cross-document-edits.js";

function doc(taskId: string, bodies: Record<string, string>): CrossDocumentDoc {
  return {
    taskId,
    title: `${taskId}-标题`,
    sections: Object.entries(bodies).map(([heading, body]) => ({ heading, body })),
  };
}

describe("planCrossDocumentEdits", () => {
  it("accepts a single-hit anchor across several documents", () => {
    const documents = [
      doc("d1", { 首部: "甲方为北京示例科技有限公司，乙方为李某。" }),
      doc("d2", { 首部: "本协议由北京示例科技有限公司与王某签订。" }),
    ];
    const plan = planCrossDocumentEdits({
      documents,
      edits: [{ find: "北京示例科技有限公司", replace: "北京示例集团有限公司" }],
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) {
      return;
    }
    expect(plan.docs).toHaveLength(2);
    expect(plan.totalMatches).toBe(2);
    expect(plan.docs.every((d) => d.matched === 1 && d.missed.length === 0)).toBe(true);
  });

  it("stops the whole batch when an anchor hits several places and is not declared as all", () => {
    const documents = [doc("d1", { 正文: "甲方应付款。甲方应开票。" })];
    const plan = planCrossDocumentEdits({
      documents,
      edits: [{ find: "甲方", replace: "委托人" }],
    });
    expect(plan.ok).toBe(false);
    if (plan.ok) {
      return;
    }
    expect(plan.code).toBe("anchor_ambiguous");
    expect(plan.conflicts).toEqual([{ taskId: "d1", find: "甲方", count: 2 }]);
    expect(plan.error).toContain('occurrences: "all"');
  });

  it("allows several hits once the caller declares a batch-wide replace", () => {
    const plan = planCrossDocumentEdits({
      documents: [doc("d1", { 正文: "甲方应付款。甲方应开票。" })],
      edits: [{ find: "甲方", replace: "委托人", occurrences: "all" }],
    });
    expect(plan.ok).toBe(true);
  });

  it("records documents that simply do not contain the anchor, without failing", () => {
    const plan = planCrossDocumentEdits({
      documents: [
        doc("d1", { 正文: "本协议适用中国法律。" }),
        doc("d2", { 正文: "本协议适用美国纽约州法律。" }),
      ],
      edits: [{ find: "纽约州", replace: "加利福尼亚州" }],
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) {
      return;
    }
    // 最短改动把共有的「州」留在修订轨外，故锚点是「纽约」。
    expect(plan.docs[0].missed).toEqual(["纽约"]);
    expect(plan.docs[1].matched).toBe(1);
  });

  it("normalizes an over-wide anchor once, for the whole batch", () => {
    const plan = planCrossDocumentEdits({
      documents: [doc("d1", { 正文: "乙方应当在收到通知之日起十个工作日内回复。" })],
      edits: [
        {
          find: "乙方应当在收到通知之日起十个工作日内回复。",
          replace: "乙方应当在收到通知之日起十个工作日内答复。",
        },
      ],
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) {
      return;
    }
    expect(plan.narrowed).toBe(1);
    expect(plan.edits[0].find).toBe("回");
    expect(plan.edits[0].replace).toBe("答");
  });

  it("整段改写不再整批失败：重算成最短改动后照常落笔", () => {
    const plan = planCrossDocumentEdits({
      documents: [doc("d1", { 正文: "第一句。第二句。" })],
      edits: [{ find: "第一句。第二句。", replace: "完全不同。" }],
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) {
      return;
    }
    // 共有的句末句号留在修订轨之外；只把真正变动的文字交出去。
    expect(plan.edits.map((e) => `${e.find}→${e.replace}`)).toEqual(["第一句。第二句→完全不同"]);
  });

  it("纯插入不再被判成本档无此锚点（位置精确地插进去）", () => {
    const documents = [doc("d1", { 正文: "甲方为王某。乙方为李某。" })];
    const plan = planCrossDocumentEdits({
      documents,
      edits: [{ find: "甲方为王某。", replace: "甲方为王某，承包人应交付。" }],
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) {
      return;
    }
    // 这一层只管内容：写成「原 find → 插入后的原 find」，位置精确。
    expect(plan.edits[0].find).toBe("甲方为王某。");
    expect(plan.edits[0].replace).toBe("甲方为王某，承包人应交付。");
    expect(plan.docs[0].matched).toBe(1);
    const result = applyCrossDocumentEditsToSections(plan, documents);
    expect(result.docs[0].sections[0].body).toBe("甲方为王某，承包人应交付。乙方为李某。");
    expect(result.changes[0].applied[0]?.occurrences).toBe(1);
  });

  it("refuses an empty batch or empty edits", () => {
    const noDocs = planCrossDocumentEdits({
      documents: [],
      edits: [{ find: "甲", replace: "乙" }],
    });
    expect(noDocs.ok).toBe(false);
    if (!noDocs.ok) {
      expect(noDocs.code).toBe("no_documents");
    }
    const noEdits = planCrossDocumentEdits({ documents: [doc("d1", { 正文: "甲" })], edits: [] });
    expect(noEdits.ok).toBe(false);
    if (!noEdits.ok) {
      expect(noEdits.code).toBe("no_edits");
    }
  });
});

describe("applyCrossDocumentEditsToSections", () => {
  const documents = [
    doc("d1", { 首部: "甲方为北京示例科技有限公司。", 尾部: "北京示例科技有限公司盖章。" }),
    doc("d2", { 首部: "本协议由北京示例科技有限公司与王某签订。" }),
    doc("d3", { 首部: "本协议无相关约定。" }),
  ];

  it("applies the same anchor to every document that contains it", () => {
    const plan = planCrossDocumentEdits({
      documents,
      edits: [
        { find: "北京示例科技有限公司", replace: "北京示例集团有限公司", occurrences: "all" },
      ],
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) {
      return;
    }
    const result = applyCrossDocumentEditsToSections(plan, documents);
    expect(result.docs[0].sections.map((s) => s.body)).toEqual([
      "甲方为北京示例集团有限公司。",
      "北京示例集团有限公司盖章。",
    ]);
    expect(result.docs[1].sections[0].body).toBe("本协议由北京示例集团有限公司与王某签订。");
    expect(result.docs[2].sections[0].body).toBe("本协议无相关约定。");
    expect(result.changes.map((c) => c.changed)).toEqual([true, true, false]);
    // 最短改动的锚点是共有部分之外的「科技」。
    expect(result.changes[2].missed).toEqual(["科技"]);
  });

  it("replaces only the first occurrence in first mode", () => {
    const plan = planCrossDocumentEdits({
      documents: [doc("d1", { 正文: "甲方应付款。" })],
      edits: [{ find: "甲方", replace: "委托人" }],
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) {
      return;
    }
    const result = applyCrossDocumentEditsToSections(plan, [doc("d1", { 正文: "甲方应付款。" })]);
    expect(result.docs[0].sections[0].body).toBe("委托人应付款。");
    expect(result.changes[0].applied[0].occurrences).toBe(1);
  });

  it("does not mutate the input sections", () => {
    const source = doc("d1", { 正文: "甲方应付款。" });
    const plan = planCrossDocumentEdits({
      documents: [source],
      edits: [{ find: "甲方", replace: "委托人" }],
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) {
      return;
    }
    applyCrossDocumentEditsToSections(plan, [source]);
    expect(source.sections[0].body).toBe("甲方应付款。");
  });
});

describe("formatCrossDocumentSummary", () => {
  it("lists changed and untouched documents", () => {
    const manifest: CrossDocumentChangeManifest = {
      batchId: "xdoc-1",
      generatedAt: "2026-09-20T00:00:00.000Z",
      anchors: [{ find: "甲方", replace: "委托人", occurrences: "all" }],
      totals: {
        documents: 2,
        documentsChanged: 1,
        appliedAnchors: 1,
        replacements: 2,
        anchorsMissed: 1,
        redlinePending: 2,
      },
      docs: [
        {
          taskId: "d1",
          title: "合作协议",
          applied: [{ find: "甲方", replace: "委托人", occurrences: 2, sections: [0] }],
          skipped: [],
          missed: [],
          changed: true,
          redlinePending: 2,
        },
        {
          taskId: "d2",
          title: "保密协议",
          applied: [],
          skipped: [{ find: "甲方", reason: "本件无此锚点（原文不含 find）" }],
          missed: ["甲方"],
          changed: false,
          redlinePending: 0,
        },
      ],
    };
    const summary = formatCrossDocumentSummary({ manifest, narrowed: 0 });
    expect(summary).toContain("2 份中 1 份落改");
    expect(summary).toContain("合作协议：「甲方」→「委托人」×2");
    expect(summary).toContain("保密协议：本件无待改锚点");
  });
});
