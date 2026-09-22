/**
 * 素材块合并（D10）：三个素材通道收进一个受预算约束的片段。
 *
 * 核心断言是「**整块取舍**」：实测撞过两次「打包器在块中间截断」，
 * 被腰斩的素材比没有更糟——它看起来像一句完整的话。
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { listProductMetricEvents } from "../metrics/product-metrics.js";
import {
  MATERIALS_BLOCK_CAP_TOKENS,
  MATERIALS_BLOCK_MAX_CHARS,
  MATERIALS_FRAGMENT_KIND,
  MATERIALS_FRAGMENT_PRIORITY,
  MATERIAL_HEALTH_MIN_SAMPLES_PER_CHANNEL,
  MATERIAL_SECTION_ORDER,
  composeMaterialsBlock,
  describeMaterialBlockHealth,
  recordMaterialBlockEvent,
  summarizeMaterialBlockHealth,
  type MaterialSection,
} from "./material-blocks.js";

/**
 * 用**真实量级**的通道内容。
 *
 * 早期版本用 30–44 字的玩具串，撞上了 `composeMaterialsBlock` 的 `maxChars` 下限
 * （120），于是无论怎么传 cap 都全放得下、测不出取舍行为。
 * 真实素材块是几百字（见 `derived-facts.ts` / `edit-examples.ts` 的实测），
 * 所以夹具也要同量级——否则测的是不存在的场景。
 */
const facts = [
  "## 已算好的事实（代码计算，可复核）",
  "下列数字由代码算出，**不是模型的推断**；括号内是算式，可自行复核。",
  "",
  "- 定金 310,000 元 占合同标的额 1,032,000 元 的 30.04%；民法典第586条载明的上限为 20%",
  "  （310000 ÷ 1032000 = 0.3004 → 30.04%）",
  "",
  "- 付款分项合计 1,032,400 元，比总价多 400 元。",
  "  （310000 + 722400 = 1032400）",
].join("\n");

const edits = [
  "## 改稿参照（本所律师对系统稿的实际修改）",
  "以下「改前」是**系统当时写的那一版**，「改后」是律师交付的版本。仅供参照：",
  "",
  "### 「正文」（律师说明：改成通牒式）",
  "改前（系统稿）：我方当事人将保留解除合同及要求赔偿损失的权利。",
  "改后（律师稿）：现要求贵司于 2026 年 10 月 5 日前完成全部交付。",
].join("\n");

const golden = [
  "## 质量范例（本所黄金样例）",
  "以下为律师标记的优质交付结构参考。对齐章节与表述习惯，勿照抄事实。",
  "",
  "### 采购合同审查意见书（task t-1 · contract.review）",
  "章节：审查范围与依据、主要风险、修改建议",
].join("\n");

function sections(over: Partial<Record<string, string>> = {}): MaterialSection[] {
  return [
    { id: "derived_facts", body: "derived_facts" in over ? over.derived_facts : facts },
    { id: "edit_examples", body: "edit_examples" in over ? over.edit_examples : edits },
    { id: "golden_examples", body: "golden_examples" in over ? over.golden_examples : golden },
  ];
}

describe("素材块：顺序即优先级", () => {
  it("优先级顺序是 事实 > 改稿范例 > 黄金范例", () => {
    expect(MATERIAL_SECTION_ORDER).toEqual(["derived_facts", "edit_examples", "golden_examples"]);
    const r = composeMaterialsBlock(sections());
    expect(r.included).toEqual(["derived_facts", "edit_examples", "golden_examples"]);
    // 输出顺序与优先级一致
    expect(r.body!.indexOf("已算好的事实")).toBeLessThan(r.body!.indexOf("改稿参照"));
    expect(r.body!.indexOf("改稿参照")).toBeLessThan(r.body!.indexOf("质量范例"));
  });

  it("预算充足时三个通道都在，没有丢弃说明", () => {
    const r = composeMaterialsBlock(sections());
    expect(r.dropped).toEqual([]);
    expect(r.body).not.toContain("因篇幅未展开");
  });
});

describe("素材块：**整块取舍**（不腰斩）", () => {
  it("预算不足时从**末尾**（最低优先级）整条丢弃", () => {
    // 只够放事实 + 改稿范例
    const cap = facts.length + edits.length + 10;
    const r = composeMaterialsBlock(sections(), { maxChars: cap });
    expect(r.included).toEqual(["derived_facts", "edit_examples"]);
    expect(r.dropped).toEqual(["golden_examples"]);
    // 每条通道的内容都是完整的（没有被切一半）
    expect(r.body).toContain(facts);
    expect(r.body).toContain(edits);
    expect(r.body).not.toContain("质量范例（本所黄金样例）");
  });

  it("丢弃时**具名说明**（否则无法区分「没看到」与「本来就没有」）", () => {
    const cap = facts.length + edits.length + 10;
    const r = composeMaterialsBlock(sections(), { maxChars: cap });
    expect(r.body).toContain("因篇幅未展开");
    expect(r.body).toContain("质量范例");
  });

  it("极紧预算下只留最高优先级一条，其余都具名丢弃", () => {
    const r = composeMaterialsBlock(sections(), { maxChars: facts.length + 5 });
    expect(r.included).toEqual(["derived_facts"]);
    expect(r.dropped).toEqual(["edit_examples", "golden_examples"]);
    expect(r.body).toContain("改稿参照"); // 只在「丢弃说明」里出现
    expect(r.body).not.toContain("改前：保留权利");
  });

  it("**永不腰斩**：任何被纳入的通道，其整段文本原样出现", () => {
    for (const cap of [facts.length + 5, facts.length + edits.length + 5, 10_000]) {
      const r = composeMaterialsBlock(sections(), { maxChars: cap });
      for (const id of r.included) {
        const original = id === "derived_facts" ? facts : id === "edit_examples" ? edits : golden;
        expect(r.body, `cap=${cap} 通道=${id}`).toContain(original);
      }
    }
  });
});

describe("素材块：空通道与全空", () => {
  it("空通道跳过，不产生空标题", () => {
    const r = composeMaterialsBlock(sections({ edit_examples: "" }));
    expect(r.included).toEqual(["derived_facts", "golden_examples"]);
    // 空通道不算「丢弃」
    expect(r.dropped).toEqual([]);
    expect(r.body).not.toContain("改稿参照");
  });

  it("通道为 undefined 同样跳过", () => {
    const r = composeMaterialsBlock([
      { id: "derived_facts", body: undefined },
      { id: "edit_examples", body: edits },
    ]);
    expect(r.included).toEqual(["edit_examples"]);
  });

  it("全空 → body undefined（整块不注入，不注入空标题）", () => {
    const r = composeMaterialsBlock([
      { id: "derived_facts", body: undefined },
      { id: "edit_examples", body: "   " },
      { id: "golden_examples", body: undefined },
    ]);
    expect(r.body).toBeUndefined();
    expect(r.included).toEqual([]);
    expect(r.dropped).toEqual([]);
  });

  it("没有任何 section 传入 → body undefined", () => {
    expect(composeMaterialsBlock([]).body).toBeUndefined();
  });

  it("纯空白通道不视为有内容", () => {
    const r = composeMaterialsBlock([{ id: "derived_facts", body: "\n\n  \t" }]);
    expect(r.body).toBeUndefined();
  });
});

describe("素材块：预算常量自洽", () => {
  it("char 预算与 token 预算成比例（CJK 约 1 token/字）", () => {
    // token 预算应明显小于 char 预算（英文/标点按 4 char/token 折算）
    expect(MATERIALS_BLOCK_CAP_TOKENS).toBeLessThan(MATERIALS_BLOCK_MAX_CHARS);
    expect(MATERIALS_BLOCK_CAP_TOKENS).toBeGreaterThan(MATERIALS_BLOCK_MAX_CHARS * 0.5);
  });

  it("复用 memory_hit kind（不新造预算类别），优先级高于其默认值", () => {
    expect(MATERIALS_FRAGMENT_KIND).toBe("memory_hit");
    expect(MATERIALS_FRAGMENT_PRIORITY).toBeGreaterThan(40);
    // 但低于 protocol(55) / skill_index(70) / craft(80)——不挤占起草指引
    expect(MATERIALS_FRAGMENT_PRIORITY).toBeLessThan(55);
  });

  it("maxChars 下限兜底（不会因为传 0 就一条都不给）", () => {
    const r = composeMaterialsBlock(sections(), { maxChars: 0 });
    expect(r.included.length).toBeGreaterThanOrEqual(1);
  });
});

// ─────────────────────────────────────────────
// 可观测（D10 收口）：丢弃必须**可测**
// ─────────────────────────────────────────────

describe("素材块可观测：丢弃率可测（不只是写在文案里）", () => {
  const dirs: string[] = [];

  function makeWorkspace(): string {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-mb-"));
    dirs.push(ws);
    return ws;
  }

  afterEach(() => {
    for (const dir of dirs) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    dirs.length = 0;
  });

  it("记录一次合成：included / dropped / chars 都进指标", () => {
    const ws = makeWorkspace();
    const r = composeMaterialsBlock(sections(), {
      maxChars: facts.length + edits.length + 5,
    });
    recordMaterialBlockEvent(ws, r);
    const ev = listProductMetricEvents(ws).find((e) => e.kind === "material_block");
    expect(ev?.outcome).toBe("dropped");
    expect(ev?.meta?.included).toBe("derived_facts,edit_examples");
    expect(ev?.meta?.dropped).toBe("golden_examples");
    expect(ev?.meta?.droppedCount).toBe(1);
    expect(ev?.meta?.chars).toBe(r.body!.length);
  });

  it("无丢弃时 outcome=complete，dropped 为空串", () => {
    const ws = makeWorkspace();
    recordMaterialBlockEvent(ws, composeMaterialsBlock(sections(), { maxChars: 10_000 }));
    const ev = listProductMetricEvents(ws).find((e) => e.kind === "material_block");
    expect(ev?.outcome).toBe("complete");
    expect(ev?.meta?.dropped).toBe("");
  });

  it("三通道全空 → **不记录**（那不是丢弃，是本来就没素材）", () => {
    const ws = makeWorkspace();
    recordMaterialBlockEvent(ws, composeMaterialsBlock([{ id: "derived_facts", body: undefined }]));
    expect(listProductMetricEvents(ws).filter((e) => e.kind === "material_block")).toEqual([]);
  });

  it("记录永不抛（路径不可写时静默）", () => {
    const ws = makeWorkspace();
    const asFile = path.join(ws, "not-a-dir");
    fs.writeFileSync(asFile, "x", "utf8");
    expect(() =>
      recordMaterialBlockEvent(asFile, composeMaterialsBlock(sections(), { maxChars: 10_000 })),
    ).not.toThrow();
  });

  it("汇总：按通道给纳入/丢弃次数与丢弃率", () => {
    const ws = makeWorkspace();
    // 5 个回合都丢弃 golden_examples，其中 3 个丢弃 edit_examples
    for (let i = 0; i < 5; i += 1) {
      const cap = i < 3 ? facts.length + 5 : facts.length + edits.length + 5;
      recordMaterialBlockEvent(ws, composeMaterialsBlock(sections(), { maxChars: cap }));
    }
    const h = summarizeMaterialBlockHealth(ws);
    expect(h.samples).toBe(5);
    const golden = h.byChannel.find((c) => c.channel === "golden_examples")!;
    expect(golden.includedCount).toBe(0);
    expect(golden.droppedCount).toBe(5);
    expect(golden.presentCount).toBe(5);
    expect(golden.dropRate).toBe(1);

    const editsRow = h.byChannel.find((c) => c.channel === "edit_examples")!;
    expect(editsRow.includedCount).toBe(2);
    expect(editsRow.droppedCount).toBe(3);
    expect(editsRow.dropRate).toBeCloseTo(3 / 5, 10);

    const factsRow = h.byChannel.find((c) => c.channel === "derived_facts")!;
    expect(factsRow.dropRate).toBe(0);
  });

  it("**样本不足不给比例**：dropRate 为 null 而不是编造 0", () => {
    const ws = makeWorkspace();
    const h = summarizeMaterialBlockHealth(ws);
    expect(h.samples).toBe(0);
    expect(h.worstChannel).toBeNull();
    for (const c of h.byChannel) {
      expect(c.dropRate).toBeNull();
      expect(c.presentCount).toBe(0);
    }
  });

  it("**通道本来没内容 → 不进分母**（不算被丢）", () => {
    const ws = makeWorkspace();
    // 只有事实通道有内容，且没被丢
    for (let i = 0; i < 3; i += 1) {
      recordMaterialBlockEvent(
        ws,
        composeMaterialsBlock([{ id: "derived_facts", body: facts }], { maxChars: 10_000 }),
      );
    }
    const h = summarizeMaterialBlockHealth(ws);
    const golden = h.byChannel.find((c) => c.channel === "golden_examples")!;
    expect(golden.presentCount).toBe(0);
    expect(golden.dropRate).toBeNull(); // 不编造 0%
    const factsRow = h.byChannel.find((c) => c.channel === "derived_facts")!;
    expect(factsRow.dropRate).toBe(0);
  });

  it("worstChannel 需要**样本足够**才给（太少时比例剧烈跳动）", () => {
    const ws = makeWorkspace();
    // 只 1 个回合丢 golden —— 低于门槛，不给 worstChannel
    recordMaterialBlockEvent(
      ws,
      composeMaterialsBlock(sections(), { maxChars: facts.length + edits.length + 5 }),
    );
    const h = summarizeMaterialBlockHealth(ws);
    expect(h.anyDropped).toBe(true);
    expect(h.worstChannel).toBeNull(); // 样本不足
  });

  it("sample 足够时给出 worstChannel（丢弃率最高的那个）", () => {
    const ws = makeWorkspace();
    for (let i = 0; i < MATERIAL_HEALTH_MIN_SAMPLES_PER_CHANNEL + 1; i += 1) {
      recordMaterialBlockEvent(
        ws,
        composeMaterialsBlock(sections(), { maxChars: facts.length + edits.length + 5 }),
      );
    }
    expect(summarizeMaterialBlockHealth(ws).worstChannel).toBe("golden_examples");
  });

  it("describeMaterialBlockHealth：无样本时如实说没有数据", () => {
    expect(describeMaterialBlockHealth(summarizeMaterialBlockHealth(makeWorkspace()))).toContain(
      "尚无观测数据",
    );
  });

  it("describeMaterialBlockHealth：有样本时报出各通道与比例", () => {
    const ws = makeWorkspace();
    for (let i = 0; i < 6; i += 1) {
      recordMaterialBlockEvent(
        ws,
        composeMaterialsBlock(sections(), { maxChars: facts.length + edits.length + 5 }),
      );
    }
    const line = describeMaterialBlockHealth(summarizeMaterialBlockHealth(ws));
    expect(line).toContain("6 个回合");
    expect(line).toContain("derived_facts");
    expect(line).toContain("golden_examples");
    expect(line).toContain("100%");
    expect(line).toContain("最需关注");
  });

  it("汇总永不抛（指标文件损坏时返回空）", () => {
    const ws = makeWorkspace();
    fs.mkdirSync(path.join(ws, "lawmind", "metrics"), { recursive: true });
    fs.writeFileSync(
      path.join(ws, "lawmind", "metrics", "product-events.jsonl"),
      "garbage\n",
      "utf8",
    );
    expect(() => summarizeMaterialBlockHealth(ws)).not.toThrow();
  });
});
