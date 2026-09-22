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
    // 第一条里的共有片段「基础bug修复」被保留在修订轨之外，故拆成两处；
    // 加第二条共三处。
    expect(r.applied).toHaveLength(3);
    for (const a of r.applied) {
      expect(a.find).not.toContain("基础bug修复");
    }
    expect(r.sections[0]?.body).toBe("仅限基础bug修复不含新版本功能修复。");
    expect(r.sections[1]?.body).toContain("上海仲裁委员会");
    expect(r.sections[1]?.body).toContain("诉讼解决");
  });

  it("整句改写不再被拒：重算成最短改动后落槌，保留文字不进改动", () => {
    // 保留 explainInvalidSurgicalEdit 作为「模型自查」用的提示口径（引擎不再据此拒绝）。
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
    expect(r.ok).toBe(true);
    if (!r.ok) {
      return;
    }
    // 这一句里两处变动之间没有保留文字（改后把「胜诉方维权产生的」也去掉了），
    // 因此本身就只是一处改动；「提交」「由败诉方承担。」留在修订轨之外。
    expect(r.applied.map((a) => `${a.find}→${a.replace}`)).toEqual([
      "甲方所在地人民法院诉讼解决，胜诉方维权产生的律师→上海仲裁委员会仲裁，仲裁",
    ]);
    expect(r.applied[0]?.find.startsWith("提交")).toBe(false);
    expect(r.sections[0]?.body).toBe("提交上海仲裁委员会仲裁，仲裁费由败诉方承担。");
  });

  it("internally narrows a long find to the shortest differing span", () => {
    const r = applySurgicalTextEdits({
      sections: [
        {
          heading: "管辖",
          body: "适用中华人民共和国法律，争议提交上海仲裁委员会。",
        },
      ],
      edits: [
        {
          find: "适用中华人民共和国法律，争议提交上海仲裁委员会。",
          replace: "适用中华人民共和国法律，争议提交北京仲裁委员会。",
        },
      ],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) {
      return;
    }
    expect(r.applied[0]?.find).toBe("上海");
    expect(r.applied[0]?.replace).toBe("北京");
    expect(r.applied[0]?.note).toContain("已收窄锚定");
    expect(r.sections[0]?.body).toBe("适用中华人民共和国法律，争议提交北京仲裁委员会。");
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

  it("自动把粗粒度 find/replace 重算成最短改动（一句话只改几个字就只改那几个字）", () => {
    const body = "甲方应当在收到发票之日起十日内付款，逾期按日万分之五计息。";
    const r = applySurgicalTextEdits({
      sections: [{ heading: "付款", body }],
      edits: [
        {
          find: "甲方应当在收到发票之日起十日内付款",
          replace: "乙方应当在收到发票之日起五个工作日内付款",
        },
      ],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) {
      return;
    }
    // 两处最短改动，各自独立；没有任何一处把中间没动的字包进去。
    expect(r.applied.map((a) => `${a.find}→${a.replace}`)).toEqual(["甲→乙", "十→五个工作"]);
    expect(r.minimalSplitEdits).toBe(1);
    expect(r.applied.every((a) => a.minimalSplit === true)).toBe(true);
    expect(r.applied[0]?.note).toContain("已按最短改动拆分");
    expect(r.sections[0]?.body).toBe(
      "乙方应当在收到发票之日起五个工作日内付款，逾期按日万分之五计息。",
    );
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
    // 第二处不再被拒：重算成「在句号前插入」的纯插入，整句原文一个字都不删。
    expect(r.applied).toHaveLength(2);
    expect(r.applied[1]?.find).toBe("");
    expect(r.applied[1]?.replace).toContain("累计赔偿总额");
    expect(r.sections[0]?.body).toContain("上海仲裁委员会");
    expect(r.sections[0]?.body).toContain("并赔偿甲方因此而造成的实际损失，但累计赔偿总额");
  });
});
