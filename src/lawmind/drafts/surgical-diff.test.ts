import { describe, expect, it } from "vitest";
import {
  applySpanToBody,
  buildContractBodySectionsFromText,
  disambiguateLiteralFind,
  extractMinimalEditSpan,
  formatOfficeCliFindArg,
  splitSurgicalEditSpans,
  toTrackedFindReplace,
} from "./surgical-diff.js";

describe("surgical-diff", () => {
  it("extracts a two-character change without rewriting the whole sentence", () => {
    const before = "甲方应在三十日内支付全部价款。";
    const after = "甲方应在十五日内支付全部价款。";
    const span = extractMinimalEditSpan(before, after);
    expect(span).not.toBeNull();
    expect(span?.before).toBe("三十");
    expect(span?.after).toBe("十五");
    expect(before.slice(span!.spanStart, span!.spanEnd)).toBe("三十");
  });

  it("splitSurgicalEditSpans keeps small edits as one hunk", () => {
    const spans = splitSurgicalEditSpans("本协议自签署之日起生效。", "本协议自盖章之日起生效。");
    expect(spans).toHaveLength(1);
    expect(spans[0].before).toBe("签署");
    expect(spans[0].after).toBe("盖章");
  });

  it("applySpanToBody replaces unique after→before on reject path", () => {
    const body = "甲方应在十五日内支付全部价款。";
    const next = applySpanToBody(
      body,
      { spanStart: 5, spanEnd: 7, before: "三十", after: "十五" },
      "toBefore",
    );
    expect(next).toBe("甲方应在三十日内支付全部价款。");
  });

  it("buildContractBodySectionsFromText splits paragraphs", () => {
    const sections = buildContractBodySectionsFromText("第一段内容。\n\n第二段内容。");
    expect(sections).toHaveLength(2);
    expect(sections[0].heading).toBe("第 1 段");
    expect(sections[1].body).toContain("第二段");
  });

  it("splits English contract sentences into multiple spans", () => {
    const filler =
      "This Agreement shall remain in full force and effect. Neither party may assign this Agreement without prior written consent. All notices shall be delivered in writing.";
    const before = `Party A shall pay within thirty days. ${filler} Party B shall inspect within five days.`;
    const after = `Party A shall pay within fifteen days. ${filler} Party B shall inspect within ten days.`;
    const spans = splitSurgicalEditSpans(before, after);
    expect(spans.length).toBe(2);
    expect(spans[0].before).toContain("thirty");
    expect(spans[1].before).toContain("five");
  });

  it("does not split decimals when sentence-splitting English text", () => {
    const before =
      "The price is 1.5 million dollars and the term is long enough to exceed eighty characters in total length here.";
    const after =
      "The price is 2.5 million dollars and the term is long enough to exceed eighty characters in total length here.";
    const spans = splitSurgicalEditSpans(before, after);
    // 1.5/2.5 的小数点不得造成句数错位；最小编辑即「1」→「2」，应用后正文一致。
    expect(spans.length).toBe(1);
    expect(spans[0].before).toBe("1");
    expect(spans[0].after).toBe("2");
    expect(applySpanToBody(before, spans[0], "toAfter")).toBe(after);
  });

  it("toTrackedFindReplace keeps shared prefix out of Word del/ins for cap inserts", () => {
    const fr = toTrackedFindReplace({
      before: "实际损失。",
      after: "实际损失，但累计赔偿总额不超过该项目已付软件费用。",
      bodyAfter:
        "并赔偿甲方因此而造成的实际损失，但累计赔偿总额不超过该项目已付软件费用。本条款永久有效",
    });
    expect(fr?.regex).toBe(true);
    expect(fr?.find).toMatch(/^\(\?<=.+实际损失\)。$/);
    expect(fr?.replace).toBe("，但累计赔偿总额不超过该项目已付软件费用。");
  });

  it("toTrackedFindReplace anchors end-of-paragraph inserts on the closing punct", () => {
    const fr = toTrackedFindReplace({
      before: "",
      after: "若未达标则可解除独家。",
      bodyAfter: "共同推动项目稳定发展。若未达标则可解除独家。",
    });
    expect(fr?.regex).toBe(true);
    expect(fr?.find).toMatch(/^\(\?<=.+\)。$/);
    expect(fr?.replace).toBe("。若未达标则可解除独家。");
  });

  it("toTrackedFindReplace keeps phrase swaps as short find/replace", () => {
    const fr = toTrackedFindReplace({
      before: "甲方所在地人民法院",
      after: "上海仲裁委员会",
    });
    expect(fr).toEqual({ find: "甲方所在地人民法院", replace: "上海仲裁委员会" });
  });

  it('formatOfficeCliFindArg wraps regex with r"..." per officecli', () => {
    expect(formatOfficeCliFindArg("实际损失。")).toBe("实际损失。");
    expect(formatOfficeCliFindArg("(?<=实际损失)。", true)).toBe('r"(?<=实际损失)。"');
    expect(formatOfficeCliFindArg('a"b', true)).toBe('r"a\\"b"');
  });

  it("disambiguateLiteralFind pins a repeated phrase with section lookbehind", () => {
    const bodies = [
      "在本协议有效期内及协议终止后二十四（24）个月内不得绕开。",
      "本协议有效期为二十四（24）个月。",
    ];
    const fr = disambiguateLiteralFind({
      find: "二十四（24",
      replace: "十二（12",
      sectionBody: bodies[0] ?? "",
      spanStart: bodies[0]?.indexOf("二十四（24"),
      uniquenessBodies: bodies,
    });
    expect(fr?.regex).toBe(true);
    expect(fr?.find).toContain("二十四（24");
    expect(fr?.find.startsWith("(?<=")).toBe(true);
    expect(fr?.replace).toBe("十二（12");
  });

  it("fallback replaces the duplicate occurrence nearest to spanStart (not the first)", () => {
    // 两处「五个月」：spanStart 指向第二处；旧实现 indexOf 会改第一处。
    const body = "试用期五个月。租金每五个月支付一次。";
    const spanStart = body.indexOf("五个月", 6);
    const next = applySpanToBody(
      body,
      { spanStart, spanEnd: spanStart + 3, before: "五个月", after: "三个月" },
      "toAfter",
    );
    expect(next).toBe("试用期五个月。租金每三个月支付一次。");
  });
});
