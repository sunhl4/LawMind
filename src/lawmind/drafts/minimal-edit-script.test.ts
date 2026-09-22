import { describe, expect, it } from "vitest";
import {
  MINIMAL_EDIT_MAX_UNCHANGED_RUN,
  auditMinimalEditSpans,
  computeMinimalEditSpans,
  longestUnchangedRunInside,
  type MinimalChangeSpan,
} from "./minimal-edit-script.js";

/** 把重算出的改动按位置回放到原文上；用于验证「不许发明改动、不许丢字」。 */
function replay(before: string, spans: MinimalChangeSpan[]): string {
  let out = "";
  let cursor = 0;
  for (const span of spans) {
    out += before.slice(cursor, span.spanStart);
    out += span.after;
    cursor = span.spanEnd;
  }
  return out + before.slice(cursor);
}

describe("computeMinimalEditSpans", () => {
  it("一句话里只改几个字：保留中间没动的字，不整句删写", () => {
    const before = "甲方应当在收到发票之日起十日内付款，逾期按日万分之五计息。";
    const after = "乙方应当在收到发票之日起五个工作日内付款，逾期按日万分之五计息。";

    const spans = computeMinimalEditSpans(before, after);

    // 两处小改动，各自独立；中间「应当在收到发票之日起」一个字都不进改动。
    expect(spans.length).toBeGreaterThanOrEqual(2);
    for (const span of spans) {
      expect(span.before).not.toContain("应当在收到发票之日起");
      expect(span.after).not.toContain("应当在收到发票之日起");
    }
    // 逐字最短：共有的「方」「日」留在修订轨之外，只标真正变动的字
    // （这正是 Word 自带修订轨的逐字比对行为）。
    expect(spans.map((s) => `${s.before}→${s.after}`)).toEqual(["甲→乙", "十→五个工作"]);
    // 回放必须逐字等于改后文本（不发明、不丢字）。
    expect(replay(before, spans)).toBe(after);
  });

  it("同一句多处分隔开的小改动，切成互不重叠的多处", () => {
    const before = "第一条 本合同自生效之日起三十日内履行完毕，逾期对方可解除。";
    const after = "第二条 本合同自生效之日起六十日内履行完毕，逾期对方可终止。";

    const spans = computeMinimalEditSpans(before, after);

    expect(spans.length).toBe(3);
    expect(replay(before, spans)).toBe(after);
    for (let i = 1; i < spans.length; i += 1) {
      expect(spans[i].spanStart).toBeGreaterThanOrEqual(spans[i - 1].spanEnd);
    }
    // 中间「本合同自生效之日起」「履行完毕，逾期对方可」保持不动。
    const covered = spans.map((s) => s.before).join("|");
    expect(covered).not.toContain("本合同自生效之日起");
    expect(covered).not.toContain("履行完毕");
  });

  it("纯插入：一个字都不删，只把新内容插进去", () => {
    const before = "赔偿甲方的实际损失。";
    const after = "赔偿甲方的实际损失，但累计赔偿总额不超过该项目已付软件费用。";
    const spans = computeMinimalEditSpans(before, after);
    expect(spans).toHaveLength(1);
    // 句末「。」原封不动：新内容插在它前面，改动里没有任何删除。
    expect(spans[0].before).toBe("");
    expect(spans[0].after).toBe("，但累计赔偿总额不超过该项目已付软件费用");
    expect(replay(before, spans)).toBe(after);
  });

  it("纯删除：一个字都不增，只删掉多余部分", () => {
    const before = "甲方应在十日内付款，并承担由此产生的全部费用。";
    const after = "甲方应在十日内付款。";
    const spans = computeMinimalEditSpans(before, after);
    expect(spans).toHaveLength(1);
    expect(spans[0].after).toBe("");
    // 「。」保留在外，只多删了前面那个顿号。
    expect(spans[0].before).toBe("，并承担由此产生的全部费用");
    expect(replay(before, spans)).toBe(after);
  });

  it("整句真换掉（没有任何共有片段）时，本身即一处合法改动，不因长度被拦", () => {
    const before = "提交甲方所在地人民法院诉讼解决。";
    const after = "提交上海仲裁委员会仲裁。";
    const spans = computeMinimalEditSpans(before, after);
    expect(replay(before, spans)).toBe(after);
    // 「提交」「。」保留在外；真改动只有中间那段。
    expect(spans).toHaveLength(1);
    expect(spans[0].before).toBe("甲方所在地人民法院诉讼解决");
    expect(longestUnchangedRunInside(spans[0])).toBeLessThan(MINIMAL_EDIT_MAX_UNCHANGED_RUN);
  });

  it("英文按字符最短：边界上的共有字母留在修订轨外", () => {
    const before = "The Buyer shall pay within ten (10) days after invoice.";
    const after = "The Seller shall pay within thirty (30) days after invoice.";
    const spans = computeMinimalEditSpans(before, after);
    expect(replay(before, spans)).toBe(after);
    // Buyer→Seller 只标真正不同的字；共有的 "er" 与后半句整段都不进改动。
    // 逐字最短对英文一视同仁（不做「整词替换」的特殊处理）：
    // ten (10)→thirty (30) 里共有的首字母 t 与结尾 0) 都留在修订轨外。
    expect(spans.map((s) => `${s.before}→${s.after}`)).toEqual(["Buy→Sell", "en (1→hirty (3"]);
    const covered = spans.map((s) => s.before).join("|");
    expect(covered).not.toContain("shall pay within");
    expect(covered).not.toContain("days after invoice");
  });

  it("identical text produces no changes", () => {
    expect(computeMinimalEditSpans("甲方应付款。", "甲方应付款。")).toEqual([]);
  });

  it("empty sides are handled", () => {
    expect(replay("", computeMinimalEditSpans("", "新增条款。"))).toBe("新增条款。");
    expect(replay("删掉的条款。", computeMinimalEditSpans("删掉的条款。", ""))).toBe("");
  });

  it("构造结果永远通过最低限度复核（随机对照）", () => {
    const pieces = ["甲方", "应当", "在", "十日内", "五个工作日内", "付款", "，", "。", "乙方"];
    let seed = 7;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    const pick = () => pieces[Math.floor(rand() * pieces.length)];
    for (let i = 0; i < 200; i += 1) {
      const before = Array.from({ length: 1 + Math.floor(rand() * 12) }, pick).join("");
      const after = Array.from({ length: 1 + Math.floor(rand() * 12) }, pick).join("");
      const spans = computeMinimalEditSpans(before, after);
      expect(replay(before, spans)).toBe(after);
      const audit = auditMinimalEditSpans({ before, after, spans });
      expect(audit.violations).toEqual([]);
    }
  });
});

describe("auditMinimalEditSpans", () => {
  it("flags a hand-made span that swallows unchanged text", () => {
    const before = "甲方应当在收到发票之日起十日内付款。";
    const after = "乙方应当在收到发票之日起五个工作日内付款。";
    // 手工给出的「整句一小段」写法：把没动的一长段也包进了改动。
    const handMade = [
      {
        spanStart: 0,
        spanEnd: 18,
        before: before.slice(0, 18),
        after: after.slice(0, before.slice(0, 18).length),
      },
    ];
    const audit = auditMinimalEditSpans({ before, after, spans: handMade });
    expect(audit.ok).toBe(false);
    expect(audit.violations[0]?.reason).toContain("没动的字");
    // 同一对文本，重算结果本身没有违规。
    expect(audit.canonical.length).toBeGreaterThanOrEqual(2);
  });

  it("flags overlapping and out-of-range spans", () => {
    const before = "abcdefgh";
    const after = "abcdXfgh";
    const audit = auditMinimalEditSpans({
      before,
      after,
      spans: [
        { spanStart: 3, spanEnd: 6, before: "def", after: "dXf" },
        { spanStart: 5, spanEnd: 7, before: "fg", after: "gh" },
      ],
    });
    expect(audit.ok).toBe(false);
    expect(audit.violations.some((v) => v.reason.includes("重叠"))).toBe(true);
  });
});
