import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { captureDraftEditLearning } from "./draft-edit-learning.js";
import {
  DEFAULT_EXAMPLE_LIMIT,
  editExamplesPath,
  formatEditExamplesPromptBlock,
  loadEditExamplesForDrafting,
  readEditExamplesDetailed,
  recordEditExamples,
  toEditExamples,
} from "./edit-examples.js";

const dirs: string[] = [];

function makeWorkspace(): string {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-ee-"));
  dirs.push(ws);
  fs.mkdirSync(path.join(ws, "audit"), { recursive: true });
  return ws;
}

afterEach(() => {
  for (const dir of dirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  dirs.length = 0;
});

const AGENT_VERSION = "我方当事人将依合同第五条主张违约责任，并保留解除合同及要求赔偿损失的权利。";
const LAWYER_VERSION =
  "现要求贵司于 2026 年 10 月 5 日前完成全部交付，并按约定支付违约金。逾期未履行的，委托方将解除合同并主张实际损失。";

describe("改稿范例：过滤口径（宁可少存，不要存垃圾）", () => {
  it("实质改动 → 成对保留", () => {
    const out = toEditExamples({
      taskId: "t1",
      deliverableType: "letter.demand",
      deltas: [{ sectionHeading: "正文", removed: AGENT_VERSION, added: LAWYER_VERSION }],
    });
    expect(out).toHaveLength(1);
    expect(out[0]?.before).toContain("保留解除合同");
    expect(out[0]?.after).toContain("2026 年 10 月 5 日");
    expect(out[0]?.deliverableType).toBe("letter.demand");
  });

  it("纯新增（removed 为空）→ 跳过：新增与改稿语义不同，不混进同一类", () => {
    const out = toEditExamples({
      taskId: "t1",
      deltas: [{ sectionHeading: "正文", removed: "", added: LAWYER_VERSION }],
    });
    expect(out).toEqual([]);
  });

  it("琐碎改动（改后太短）→ 跳过：错别字修正不是范例", () => {
    const out = toEditExamples({
      taskId: "t1",
      deltas: [{ sectionHeading: "正文", removed: "甲方应支付定金三万元整。", added: "三万元" }],
    });
    expect(out).toEqual([]);
  });

  it("规范化后相同（仅空白/换行差异）→ 跳过", () => {
    const out = toEditExamples({
      taskId: "t1",
      deltas: [
        {
          sectionHeading: "正文",
          removed: "甲方应当在一周内完成交付并书面通知乙方。",
          added: "甲方应当在一周内完成交付并书面通知乙方。  ",
        },
      ],
    });
    expect(out).toEqual([]);
  });

  it("id 稳定：同一处改动重复产出得到同一 id（可去重）", () => {
    const mk = () =>
      toEditExamples({
        taskId: "t1",
        deltas: [{ sectionHeading: "正文", removed: AGENT_VERSION, added: LAWYER_VERSION }],
      })[0].id;
    expect(mk()).toBe(mk());
  });

  it("id 区分同任务的不同栏目/不同内容", () => {
    const a = toEditExamples({
      taskId: "t1",
      deltas: [{ sectionHeading: "正文", removed: AGENT_VERSION, added: LAWYER_VERSION }],
    })[0].id;
    const b = toEditExamples({
      taskId: "t1",
      deltas: [{ sectionHeading: "结论", removed: AGENT_VERSION, added: LAWYER_VERSION }],
    })[0].id;
    expect(a).not.toBe(b);
  });

  it("reviewNote 随范例一起存（「为什么改」的唯一线索）", () => {
    const out = toEditExamples({
      taskId: "t1",
      reviewNote: "改成通牒式，要有明确期限与解除后果",
      deltas: [{ sectionHeading: "正文", removed: AGENT_VERSION, added: LAWYER_VERSION }],
    });
    expect(out[0]?.reviewNote).toContain("通牒式");
  });
});

describe("改稿范例：落盘与读取", () => {
  it("缺文件时 present=false（不编造 0）", () => {
    const ws = makeWorkspace();
    const read = readEditExamplesDetailed(ws);
    expect(read.present).toBe(false);
    expect(read.rows).toEqual([]);
  });

  it("写入后可读，且重复 id 不重复写入", () => {
    const ws = makeWorkspace();
    const entries = toEditExamples({
      taskId: "t1",
      deltas: [{ sectionHeading: "正文", removed: AGENT_VERSION, added: LAWYER_VERSION }],
    });
    expect(recordEditExamples(ws, entries)).toBe(1);
    expect(recordEditExamples(ws, entries)).toBe(0); // 幂等
    expect(readEditExamplesDetailed(ws).rows).toHaveLength(1);
  });

  it("坏行跳过并计数，不抛", () => {
    const ws = makeWorkspace();
    const f = editExamplesPath(ws);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(
      f,
      [
        JSON.stringify({
          id: "ok",
          taskId: "t",
          sectionHeading: "正文",
          before: "旧文本内容够长",
          after: "新文本内容也够长",
          recordedAt: "2026-09-21T00:00:00.000Z",
        }),
        '{"id":"half","taskId":"t","before":"',
        JSON.stringify({ id: "no-before", after: "x" }),
        "garbage",
      ].join("\n"),
      "utf8",
    );
    const read = readEditExamplesDetailed(ws);
    expect(read.rows).toHaveLength(1);
    expect(read.totalLines).toBe(4);
    expect(read.skippedLines).toBe(3);
  });

  it("recordEditExamples 永不抛（路径不可写时返回 0）", () => {
    const ws = makeWorkspace();
    const asFile = path.join(ws, "not-a-dir");
    fs.writeFileSync(asFile, "x", "utf8");
    const entries = toEditExamples({
      taskId: "t1",
      deltas: [{ sectionHeading: "正文", removed: AGENT_VERSION, added: LAWYER_VERSION }],
    });
    expect(recordEditExamples(asFile, entries)).toBe(0);
  });
});

describe("改稿范例：检索（与黄金范例同口径）", () => {
  function seed(ws: string, rows: Array<Parameters<typeof recordEditExamples>[1][number]>): void {
    recordEditExamples(ws, rows.flat());
  }

  function entry(over: {
    id: string;
    deliverableType?: string;
    heading?: string;
    before: string;
    after: string;
  }) {
    return {
      id: over.id,
      taskId: `t-${over.id}`,
      ...(over.deliverableType ? { deliverableType: over.deliverableType } : {}),
      sectionHeading: over.heading ?? "正文",
      before: over.before,
      after: over.after,
      recordedAt: "2026-09-21T00:00:00.000Z",
    };
  }

  it("空库 → 空结果（不注入空块）", () => {
    const ws = makeWorkspace();
    expect(loadEditExamplesForDrafting({ workspaceDir: ws, instruction: "出个催告函" })).toEqual(
      [],
    );
  });

  it("同交付物类型优先（类型是最强先验）", () => {
    const ws = makeWorkspace();
    seed(ws, [
      entry({
        id: "demand",
        deliverableType: "letter.demand",
        before: "旧催告表述",
        after: "新的催告表述内容更完整",
      }),
      entry({
        id: "review",
        deliverableType: "contract.review",
        before: "旧审查表述",
        after: "新的审查表述内容更完整",
      }),
    ]);
    const hits = loadEditExamplesForDrafting({
      workspaceDir: ws,
      instruction: "再出一份催告函",
      deliverableType: "letter.demand",
    });
    expect(hits[0]?.id).toBe("demand");
  });

  it("类型不同且无任何文本命中 → 丢弃（不相关的不占预算）", () => {
    const ws = makeWorkspace();
    seed(ws, [
      entry({
        id: "review",
        deliverableType: "contract.review",
        before: "关于定金的表述",
        after: "关于定金的新表述内容更长一些",
      }),
    ]);
    const hits = loadEditExamplesForDrafting({
      workspaceDir: ws,
      instruction: "写一封催告函",
      deliverableType: "letter.demand",
    });
    expect(hits).toEqual([]);
  });

  it("类型相同即使无文本命中仍保留（同类型就是相关性）", () => {
    const ws = makeWorkspace();
    seed(ws, [
      entry({
        id: "demand",
        deliverableType: "letter.demand",
        before: "完全不相关的旧文本",
        after: "完全不相关的新文本内容更长",
      }),
    ]);
    const hits = loadEditExamplesForDrafting({
      workspaceDir: ws,
      instruction: "写一封催告函",
      deliverableType: "letter.demand",
    });
    expect(hits).toHaveLength(1);
  });

  it("limit 生效，默认 2 条（prompt 预算上限）", () => {
    const ws = makeWorkspace();
    seed(
      ws,
      Array.from({ length: 5 }, (_, i) =>
        entry({
          id: `e${i}`,
          deliverableType: "letter.demand",
          before: `催告函旧表述第 ${i} 版，包含一定的长度以通过过滤`,
          after: `催告函新表述第 ${i} 版，内容更长以便通过最短长度检查`,
        }),
      ),
    );
    const hits = loadEditExamplesForDrafting({
      workspaceDir: ws,
      instruction: "催告函",
      deliverableType: "letter.demand",
    });
    expect(hits).toHaveLength(DEFAULT_EXAMPLE_LIMIT);
  });

  it("检索永不抛（损坏的行不影响其它行）", () => {
    const ws = makeWorkspace();
    const f = editExamplesPath(ws);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(
      f,
      [
        "garbage",
        JSON.stringify(
          entry({
            id: "good",
            deliverableType: "letter.demand",
            before: "旧文本够长",
            after: "新文本够长",
          }),
        ),
      ].join("\n"),
      "utf8",
    );
    expect(() =>
      loadEditExamplesForDrafting({ workspaceDir: ws, instruction: "催告函" }),
    ).not.toThrow();
  });
});

describe("改稿范例：注入文案是**素材**而非指令", () => {
  const hints = [
    {
      id: "e1",
      taskId: "t1",
      sectionHeading: "正文",
      before: AGENT_VERSION,
      after: LAWYER_VERSION,
      reviewNote: "改成通牒式",
      score: 5,
    },
  ];

  it("空输入 → undefined（不注入空标题）", () => {
    expect(formatEditExamplesPromptBlock([])).toBeUndefined();
  });

  it("块内含改前/改后与律师说明", () => {
    const block = formatEditExamplesPromptBlock(hints)!;
    expect(block).toContain("改前（系统稿）");
    expect(block).toContain("改后（律师稿）");
    expect(block).toContain("改成通牒式");
  });

  it("**措辞必须是「供参照」**：不得出现命令式，且必须声明以本次交办为准", () => {
    const block = formatEditExamplesPromptBlock(hints)!;
    // 正向：素材口径
    expect(block).toContain("仅供参照");
    expect(block).toContain("本次仍以当前交办与材料为准");
    expect(block).toContain("不要照搬");
    // 反向：不得是命令/闸门口径
    expect(block).not.toContain("必须");
    expect(block).not.toContain("一律");
    expect(block).not.toContain("禁止");
    expect(block).not.toContain("不得");
  });

  it("说明改前那版是**系统自己**写的（不甩锅，也让模型知道要避开什么）", () => {
    const block = formatEditExamplesPromptBlock(hints)!;
    expect(block).toContain("系统当时写的那一版");
  });

  it("无栏目名时不渲染空标题", () => {
    const block = formatEditExamplesPromptBlock([{ ...hints[0], sectionHeading: "" }])!;
    expect(block).toContain("（无栏目名）");
  });
});

describe("接线：captureDraftEditLearning 同时走两条通道", () => {
  const before = [{ heading: "正文", body: AGENT_VERSION }];
  const after = [{ heading: "正文", body: LAWYER_VERSION }];

  it("既产出待确认偏好（原行为），也落改稿范例（新通道）", async () => {
    const ws = makeWorkspace();
    const created = await captureDraftEditLearning({
      workspaceDir: ws,
      auditDir: path.join(ws, "audit"),
      taskId: "t-link",
      before,
      after,
      deliverableType: "letter.demand",
      reviewNote: "改成通牒式",
    });

    // 原通道：仍返回 pending 采纳建议（行为未变）
    expect(created.length).toBeGreaterThanOrEqual(1);
    // 新通道：范例已落盘
    const read = readEditExamplesDetailed(ws);
    expect(read.present).toBe(true);
    expect(read.rows.length).toBeGreaterThanOrEqual(1);
    expect(read.rows[0]?.deliverableType).toBe("letter.demand");
    expect(read.rows[0]?.reviewNote).toContain("通牒式");
  });

  it("无改动 → 两条通道都不写", async () => {
    const ws = makeWorkspace();
    const created = await captureDraftEditLearning({
      workspaceDir: ws,
      auditDir: path.join(ws, "audit"),
      taskId: "t-noop",
      before,
      after: before,
    });
    expect(created).toEqual([]);
    expect(readEditExamplesDetailed(ws).present).toBe(false);
  });

  it("范例写入失败不得影响偏好通道的返回值（范例是可选增强）", async () => {
    const ws = makeWorkspace();
    // 把 edits 变成文件，使 append 必然失败
    fs.writeFileSync(path.join(ws, "edits"), "x", "utf8");
    const created = await captureDraftEditLearning({
      workspaceDir: ws,
      auditDir: path.join(ws, "audit"),
      taskId: "t-degrade",
      before,
      after,
    });
    expect(created.length).toBeGreaterThanOrEqual(1);
  });
});
