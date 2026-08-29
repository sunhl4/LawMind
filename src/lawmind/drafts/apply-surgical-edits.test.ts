import { describe, expect, it } from "vitest";
import { applySurgicalTextEdits, explainInvalidSurgicalEdit } from "./apply-surgical-edits.js";

describe("applySurgicalTextEdits", () => {
  it("applies word/phrase-level find/replace", () => {
    const r = applySurgicalTextEdits({
      sections: [
        { heading: "七", body: "基础bug修复及版本升级后的功能修复。" },
        { heading: "十一", body: "由甲方所在地人民法院诉讼解决。" },
      ],
      edits: [
        {
          find: "基础bug修复及版本升级后的功能修复",
          replace: "仅限基础bug修复不含新版本功能修复",
        },
        {
          find: "甲方所在地人民法院",
          replace: "上海仲裁委员会",
        },
      ],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) {
      return;
    }
    expect(r.applied).toHaveLength(2);
    expect(r.sections[1]?.body).toContain("上海仲裁委员会");
    expect(r.sections[1]?.body).toContain("诉讼解决");
  });

  it("hard-rejects whole-sentence rewrites", () => {
    expect(
      explainInvalidSurgicalEdit("提交甲方所在地人民法院诉讼解决。", "提交上海仲裁委员会仲裁。"),
    ).toMatch(/跨度硬门禁/);
    const r = applySurgicalTextEdits({
      sections: [
        {
          heading: "十一",
          body: "提交甲方所在地人民法院诉讼解决，胜诉方维权产生的律师费由败诉方承担。",
        },
      ],
      edits: [
        {
          find: "提交甲方所在地人民法院诉讼解决，胜诉方维权产生的律师费由败诉方承担。",
          replace: "提交上海仲裁委员会仲裁，仲裁费由败诉方承担。",
        },
      ],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe("span_too_wide");
    }
  });

  it("allows many short edits and short end-anchor inserts", () => {
    const body = "甲乙丙丁。并赔偿甲方因此而造成的实际损失。受损方有权要求对方赔偿超过部分。";
    const r = applySurgicalTextEdits({
      sections: [{ heading: "一", body }],
      edits: [
        { find: "甲", replace: "A" },
        { find: "乙", replace: "B" },
        { find: "丙", replace: "C" },
        { find: "丁", replace: "D" },
        {
          find: "实际损失。",
          replace: "实际损失，但累计赔偿总额不超过该项目已付软件费用。",
        },
        {
          find: "超过部分。",
          replace: "超过部分，但累计赔偿总额不超过本合同总额。",
        },
      ],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) {
      return;
    }
    expect(r.applied).toHaveLength(6);
    expect(r.sections[0]?.body).toContain("已付软件费用");
    expect(r.sections[0]?.body).toContain("本合同总额");
  });

  it("fails when find is missing", () => {
    const r = applySurgicalTextEdits({
      sections: [{ heading: "一", body: "原文" }],
      edits: [{ find: "不存在的短词", replace: "替换" }],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe("none_applied");
    }
  });

  it("skips wide spans but still applies valid short peers", () => {
    const r = applySurgicalTextEdits({
      sections: [
        {
          heading: "十一",
          body: "由甲方所在地人民法院诉讼解决。并赔偿甲方因此而造成的实际损失。",
        },
      ],
      edits: [
        { find: "甲方所在地人民法院", replace: "上海仲裁委员会" },
        {
          find: "并赔偿甲方因此而造成的实际损失。",
          replace: "并赔偿甲方因此而造成的实际损失，但累计赔偿总额不超过该项目已付软件费用。",
        },
      ],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) {
      return;
    }
    expect(r.applied).toHaveLength(1);
    expect(r.skipped.some((s) => s.reason.includes("跨度硬门禁"))).toBe(true);
    expect(r.sections[0]?.body).toContain("上海仲裁委员会");
    expect(r.sections[0]?.body).toContain("并赔偿甲方因此而造成的实际损失。");
  });
});
