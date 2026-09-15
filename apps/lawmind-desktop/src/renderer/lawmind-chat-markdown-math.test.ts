import { describe, expect, it } from "vitest";
import {
  renderKatexHtml,
  tokenizeInlineLegalMarkdown,
  tryConsumeDisplayMath,
} from "./lawmind-chat-markdown-math";
import {
  consumeMarkdownTable,
  isGfmTableSeparator,
  isMarkdownTableBlockStart,
} from "./lawmind-chat-markdown-table";

describe("tokenizeInlineLegalMarkdown", () => {
  it("keeps currency and unmatched dollars as text", () => {
    const tokens = tokenizeInlineLegalMarkdown("标的额约 $100 万元，区间 $1,000 - $2,000。");
    expect(tokens).toEqual([
      { kind: "text", value: "标的额约 $100 万元，区间 $1,000 - $2,000。" },
    ]);
  });

  it("parses Codex and GitHub math delimiters", () => {
    const tokens = tokenizeInlineLegalMarkdown(
      "利率 \\(r=0.049\\)，本金 $P$，合计 $$I=Prt$$。",
    );
    expect(tokens.filter((t) => t.kind === "math")).toEqual([
      { kind: "math", tex: "r=0.049", display: false },
      { kind: "math", tex: "P", display: false },
      { kind: "math", tex: "I=Prt", display: true },
    ]);
  });

  it("does not treat math inside code spans", () => {
    const tokens = tokenizeInlineLegalMarkdown("公式是 `$x^2$` 不是正文。");
    expect(tokens).toEqual([
      { kind: "text", value: "公式是 " },
      { kind: "code", value: "$x^2$" },
      { kind: "text", value: " 不是正文。" },
    ]);
  });

  it("parses lm-session cites and leaves other brackets as text", () => {
    const tokens = tokenizeInlineLegalMarkdown(
      "见 [采购合同审查](lm-session:sess-1?a=asst-1) 与 [法条]。",
    );
    expect(tokens).toEqual([
      { kind: "text", value: "见 " },
      {
        kind: "session_link",
        label: "采购合同审查",
        sessionId: "sess-1",
        assistantId: "asst-1",
      },
      { kind: "text", value: " 与 [法条]。" },
    ]);
  });
});

describe("tryConsumeDisplayMath", () => {
  it("waits for a closing delimiter while streaming", () => {
    expect(tryConsumeDisplayMath(["$$", "E=mc^2"], 0)).toBeNull();
  });

  it("consumes a closed display block", () => {
    expect(tryConsumeDisplayMath(["$$", "E=mc^2", "$$", "完"], 0)).toEqual({
      tex: "E=mc^2",
      next: 3,
    });
  });
});

describe("markdown tables", () => {
  it("detects GFM tables without a leading pipe", () => {
    const lines = ["条款 | 我方 | 对方", "--- | ---: | ---", "违约金 | 20% | 30%"];
    expect(isGfmTableSeparator(lines[1] ?? "")).toBe(true);
    expect(isMarkdownTableBlockStart(lines, 0)).toBe(true);
    const table = consumeMarkdownTable(lines, 0);
    expect(table.rows).toEqual([
      ["条款", "我方", "对方"],
      ["违约金", "20%", "30%"],
    ]);
    expect(table.alignments[1]).toBe("right");
  });

  it("does not treat a prose pipe as a table", () => {
    expect(isMarkdownTableBlockStart(["参见第 577 条 | 违约责任", "下一句"], 0)).toBe(false);
  });
});

describe("renderKatexHtml", () => {
  it("typesets a fraction", () => {
    const html = renderKatexHtml("\\frac{1}{2}", false);
    expect(html).toContain("katex-html");
    expect(html).toContain("mfrac");
  });
});
