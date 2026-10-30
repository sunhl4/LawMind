import { describe, expect, it } from "vitest";
import { computeMinimalEditSpans, type MinimalChangeSpan } from "../minimal-edit-script.ts";
import { extractDocxLayout } from "../word-surface-layout.ts";
import { composeWordSurface } from "../word-surface.ts";
import { decideRuns, makeAuthorClock, replaceRange } from "./compose.ts";
import type { WordRevisionRun, WordTrackKind } from "./types.ts";
import { collectBalloons, colorsForRuns, contiguousGroupKeys } from "./view.ts";

const DATE = "2026-10-30T00:00:00Z";

function paintSpans(before: string, spans: MinimalChangeSpan[]): WordRevisionRun[] {
  let runs: WordRevisionRun[] = [{ text: before }];
  const clock = makeAuthorClock("李律师", 1, DATE);
  for (const span of spans.toReversed()) {
    runs = replaceRange(runs, span.spanStart, span.spanEnd, span.after, clock, {
      reuseInsertion: false,
    });
  }
  return runs;
}

function mark(
  id: string,
  kind: WordTrackKind,
  text: string,
  author = "李律师",
  hunkId?: string,
): WordRevisionRun {
  return {
    text,
    track: {
      kind,
      id,
      author,
      date: DATE,
      ...(hunkId ? { hunkId } : {}),
    },
  };
}

/** Spans with no unchanged character between them are one revision. */
function expectedGroups(before: string, spans: MinimalChangeSpan[]): MinimalChangeSpan[][] {
  const groups: MinimalChangeSpan[][] = [];
  for (const span of spans) {
    const prev = groups.at(-1);
    const prevSpan = prev?.at(-1);
    const gap = prevSpan ? before.slice(prevSpan.spanEnd, span.spanStart) : "gap";
    if (prev && gap.length === 0) {
      prev.push(span);
    } else {
      groups.push([span]);
    }
  }
  return groups;
}

function partsOf(group: MinimalChangeSpan[]): Array<{ change: "del" | "ins"; text: string }> {
  const parts: Array<{ change: "del" | "ins"; text: string }> = [];
  for (const span of group) {
    if (span.before) {
      const last = parts.at(-1);
      if (last?.change === "del") {
        last.text += span.before;
      } else {
        parts.push({ change: "del", text: span.before });
      }
    }
    if (span.after) {
      const last = parts.at(-1);
      if (last?.change === "ins") {
        last.text += span.after;
      } else {
        parts.push({ change: "ins", text: span.after });
      }
    }
  }
  return parts;
}

function assertPaintedGroups(before: string, after: string): void {
  const spans = computeMinimalEditSpans(before, after);
  let replay = before;
  for (const span of spans.toReversed()) {
    replay = replay.slice(0, span.spanStart) + span.after + replay.slice(span.spanEnd);
  }
  expect(replay).toBe(after);
  const runs = paintSpans(before, spans);
  const kept = runs
    .filter((run) => run.track?.kind !== "del" && run.track?.kind !== "moveFrom")
    .map((run) => run.text)
    .join("");
  const original = runs
    .filter((run) => run.track?.kind !== "ins" && run.track?.kind !== "moveTo")
    .map((run) => run.text)
    .join("");
  expect(kept).toBe(after);
  expect(original).toBe(before);
  const balloons = collectBalloons(runs, colorsForRuns(runs));
  const groups = expectedGroups(before, spans);
  expect(balloons.map((row) => row.parts ?? [{ change: row.change, text: row.text }])).toEqual(
    groups.map(partsOf),
  );
  const keys = contiguousGroupKeys(runs);
  for (const run of runs) {
    const key = keys[runs.indexOf(run)];
    if (run.track && run.track.kind !== "format") {
      const balloon = balloons.find((row) =>
        (row.revIds ?? [row.revId]).includes(run.track?.id ?? ""),
      );
      expect(key).toBe(balloon?.revId);
    }
  }
}

describe("contiguous revisions", () => {
  it("splits a long payment clause only where original text remains", () => {
    assertPaintedGroups(
      "甲方应于十日内向乙方支付本合同项下的全部款项，逾期按日万分之五支付违约金，且甲方保证其提供的资料真实、完整。",
      "甲方应于五个工作日内向乙方支付本协议项下的全部款项，逾期按日万分之三支付赔偿金，且甲方保证其提供的资料真实、准确、完整。",
    );
  });

  it("keeps the known two-site customer clause as two revisions", () => {
    const before = "十日内付款的好的客户";
    const after = "五个工作日内付款的优质的客户";
    assertPaintedGroups(before, after);
    const balloons = collectBalloons(
      paintSpans(before, computeMinimalEditSpans(before, after)),
      new Map(),
    );
    expect(balloons.map((row) => row.parts)).toEqual([
      [
        { change: "del", text: "十" },
        { change: "ins", text: "五个工作" },
      ],
      [
        { change: "del", text: "好" },
        { change: "ins", text: "优质" },
      ],
    ]);
  });

  it.each([
    ["付款。", "付款；"],
    ["甲方付款。", "甲方于五个工作日内付款。"],
    ["甲方应于十日内付款，不得拖延。", "甲方应于十日内付款。"],
    ["The Party A shall pay within 10 days.", "The Party A shall pay within five business days."],
    [
      "人民币100,000元（大写：壹拾万元整），期限为10日。",
      "人民币250,000元（大写：贰拾伍万元整），期限为5个工作日。",
    ],
    ["甲方通知甲方于十日内付款。", "甲方通知乙方于五个工作日内付款。"],
    ["「十日」内付款。", "「五个工作日」内付款。"],
  ])("groups %j → %j by unchanged text", (before, after) => {
    assertPaintedGroups(before, after);
  });

  it("does not merge across a single character, punctuation, or a space", () => {
    const runs: WordRevisionRun[] = [
      mark("1", "del", "十"),
      mark("2", "ins", "五"),
      { text: "的" },
      mark("3", "del", "好"),
      mark("4", "ins", "优质"),
      { text: "，" },
      mark("5", "del", "客户"),
      mark("6", "ins", "买方"),
      { text: " " },
      mark("7", "del", "付款"),
      mark("8", "ins", "结算"),
    ];
    expect(collectBalloons(runs, colorsForRuns(runs)).map((row) => row.revIds)).toEqual([
      ["1", "2"],
      ["3", "4"],
      ["5", "6"],
      ["7", "8"],
    ]);
  });

  it("keeps one revision when only an empty run or a drawing sits between the marks", () => {
    const runs: WordRevisionRun[] = [
      mark("1", "del", "十"),
      { text: "" },
      mark("2", "ins", "五个工作"),
      { text: "\uFFFC", preservedXml: "<w:r><w:drawing/></w:r>" },
      mark("3", "del", "日"),
      mark("4", "ins", "工作日"),
    ];
    const balloons = collectBalloons(runs, colorsForRuns(runs));
    expect(balloons).toHaveLength(1);
    expect(balloons[0]?.revIds).toEqual(["1", "2", "3", "4"]);
  });

  it("does not merge a different author, a format mark, or the next paragraph", () => {
    const first: WordRevisionRun[] = [
      mark("1", "del", "本合同"),
      mark("2", "ins", "本协议"),
      mark("3", "ins", "（甲方）", "王律师"),
      {
        text: "条款",
        track: { kind: "format", id: "4", author: "李律师", date: DATE, format: "加粗" },
      },
      mark("5", "del", "生效"),
      mark("6", "ins", "履行"),
    ];
    const second: WordRevisionRun[] = [
      mark("7", "del", "附件"),
      mark("8", "ins", "附录"),
      { text: "一" },
    ];
    expect(
      collectBalloons(first, colorsForRuns(first)).map((row) => [
        row.author,
        row.revIds ?? [row.revId],
        row.change,
      ]),
    ).toEqual([
      ["李律师", ["1", "2"], "del"],
      ["王律师", ["3"], "ins"],
      ["李律师", ["4"], "format"],
      ["李律师", ["5", "6"], "del"],
    ]);
    expect(collectBalloons(second, colorsForRuns(second)).map((row) => row.revIds)).toEqual([
      ["7", "8"],
    ]);
    // 段落之间如果被拼成一条 run 序列，段尾和段首会粘成一处。调用方必须按段收集。
    const glued = collectBalloons([...first, ...second], colorsForRuns([...first, ...second]));
    expect(glued.at(-1)?.revIds).toEqual(["5", "6", "7", "8"]);
  });

  it("keeps a format mark inside the text revision it sits in", () => {
    const runs: WordRevisionRun[] = [
      mark("1", "del", "旧"),
      {
        text: "条款",
        track: { kind: "format", id: "2", author: "李律师", date: DATE, format: "加粗" },
      },
      mark("3", "ins", "新"),
    ];
    const balloons = collectBalloons(runs, colorsForRuns(runs));
    expect(balloons).toHaveLength(1);
    expect(balloons[0]?.revIds).toEqual(["1", "2", "3"]);
    expect(contiguousGroupKeys(runs)).toEqual(["1", "1", "1"]);
  });

  it("treats an adjacent move and three touching hunks as one revision", () => {
    const runs: WordRevisionRun[] = [
      mark("1", "moveFrom", "第三条", "李律师", "h1"),
      mark("2", "moveTo", "第五条", "李律师", "h1"),
      mark("3", "del", "十", "李律师", "h2"),
      mark("4", "ins", "五", "李律师", "h2"),
      mark("5", "del", "好", "李律师", "h3"),
      mark("6", "ins", "优质", "李律师", "h3"),
    ];
    const [balloon] = collectBalloons(runs, colorsForRuns(runs));
    expect(balloon?.revIds).toEqual(["1", "2", "3", "4", "5", "6"]);
    expect(balloon?.hunkIds).toEqual(["h1", "h2", "h3"]);
    let decided = runs;
    for (const id of balloon?.revIds ?? []) {
      decided = decideRuns(decided, id, "accept");
    }
    expect(decided.some((run) => run.track)).toBe(false);
    expect(decided.map((run) => run.text).join("")).toBe("第五条五优质");
  });

  it("paints a multi-paragraph contract, a table, and a header as separate revisions", () => {
    const body =
      `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>` +
      `<w:p>` +
      `<w:r><w:t>甲方应于</w:t></w:r>` +
      `<w:del w:id="1" w:author="李律师" w:date="${DATE}"><w:r><w:delText>十</w:delText></w:r></w:del>` +
      `<w:ins w:id="2" w:author="李律师" w:date="${DATE}"><w:r><w:t>五个工作</w:t></w:r></w:ins>` +
      `<w:r><w:t>日内，向</w:t></w:r>` +
      `<w:del w:id="3" w:author="李律师" w:date="${DATE}"><w:r><w:delText>乙方</w:delText></w:r></w:del>` +
      `<w:ins w:id="4" w:author="李律师" w:date="${DATE}"><w:r><w:t>丙方</w:t></w:r></w:ins>` +
      `<w:r><w:t>支付</w:t></w:r>` +
      `<w:del w:id="5" w:author="李律师" w:date="${DATE}"><w:r><w:delText>合同</w:delText></w:r></w:del>` +
      `<w:ins w:id="6" w:author="李律师" w:date="${DATE}"><w:r><w:t>协议</w:t></w:r></w:ins>` +
      `<w:r><w:t>项下款项。</w:t></w:r>` +
      `</w:p>` +
      `<w:p>` +
      `<w:del w:id="7" w:author="李律师" w:date="${DATE}"><w:r><w:delText>本合同</w:delText></w:r></w:del>` +
      `<w:ins w:id="8" w:author="李律师" w:date="${DATE}"><w:r><w:t>本协议</w:t></w:r></w:ins>` +
      `<w:ins w:id="9" w:author="王律师" w:date="${DATE}"><w:r><w:t>（甲方）</w:t></w:r></w:ins>` +
      `<w:r><w:t>自签订之日起生效。</w:t></w:r>` +
      `</w:p>` +
      `<w:p>` +
      `<w:r><w:t>逾期</w:t></w:r>` +
      `<w:del w:id="10" w:author="李律师" w:date="${DATE}"><w:r><w:delText>按日</w:delText></w:r></w:del>` +
      `<w:ins w:id="11" w:author="李律师" w:date="${DATE}"><w:r><w:t>按自然日</w:t></w:r></w:ins>` +
      `<w:r><w:t xml:space="preserve"> </w:t></w:r>` +
      `<w:del w:id="12" w:author="李律师" w:date="${DATE}"><w:r><w:delText>万分之五</w:delText></w:r></w:del>` +
      `<w:ins w:id="13" w:author="李律师" w:date="${DATE}"><w:r><w:t>万分之三</w:t></w:r></w:ins>` +
      `<w:r><w:t>计付。</w:t></w:r>` +
      `</w:p>` +
      `<w:p>` +
      `<w:r><w:t>见</w:t></w:r>` +
      `<w:del w:id="16" w:author="李律师" w:date="${DATE}"><w:r><w:delText>附件</w:delText></w:r></w:del>` +
      `<w:ins w:id="17" w:author="李律师" w:date="${DATE}"><w:r><w:t>附录</w:t></w:r></w:ins>` +
      `</w:p>` +
      `<w:p>` +
      `<w:del w:id="18" w:author="李律师" w:date="${DATE}"><w:r><w:delText>一</w:delText></w:r></w:del>` +
      `<w:ins w:id="19" w:author="李律师" w:date="${DATE}"><w:r><w:t>二</w:t></w:r></w:ins>` +
      `<w:r><w:t>。</w:t></w:r>` +
      `</w:p>` +
      `<w:tbl><w:tr><w:tc><w:p>` +
      `<w:del w:id="14" w:author="李律师" w:date="${DATE}"><w:r><w:delText>100</w:delText></w:r></w:del>` +
      `<w:ins w:id="15" w:author="李律师" w:date="${DATE}"><w:r><w:t>200</w:t></w:r></w:ins>` +
      `<w:r><w:t>元</w:t></w:r>` +
      `</w:p></w:tc></w:tr></w:tbl>` +
      `</w:body></w:document>`;
    const header =
      `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p>` +
      `<w:del w:id="20" w:author="李律师" w:date="${DATE}"><w:r><w:delText>草案</w:delText></w:r></w:del>` +
      `<w:ins w:id="21" w:author="李律师" w:date="${DATE}"><w:r><w:t>正式稿</w:t></w:r></w:ins>` +
      `</w:p></w:body></w:document>`;
    const surface = composeWordSurface({
      fileName: "合同.docx",
      relPath: "合同.docx",
      root: "workspace",
      docxParagraphs: [],
      layout: extractDocxLayout(body).blocks,
      headerLayout: extractDocxLayout(header).blocks,
    });
    expect(surface.tracked?.map((row) => row.revIds ?? [row.revId])).toEqual([
      ["20", "21"],
      ["1", "2"],
      ["3", "4"],
      ["5", "6"],
      ["7", "8"],
      ["9"],
      ["10", "11"],
      ["12", "13"],
      ["16", "17"],
      ["18", "19"],
      ["14", "15"],
    ]);
    const middle = surface.tracked?.find((row) => row.revId === "3");
    expect(middle?.parts).toEqual([
      { change: "del", text: "乙方" },
      { change: "ins", text: "丙方" },
    ]);
    const paragraphs = (surface.blocks ?? []).flatMap((block) =>
      block.kind === "paragraph" && block.runs ? [block.runs] : [],
    );
    const decided = paragraphs.map((runs) =>
      (middle?.revIds ?? []).reduce((current, id) => decideRuns(current, id, "accept"), runs),
    );
    const left = decided.flatMap((runs) => collectBalloons(runs, colorsForRuns(runs)));
    expect(left.map((row) => row.revIds)).toEqual([
      ["1", "2"],
      ["5", "6"],
      ["7", "8"],
      ["9"],
      ["10", "11"],
      ["12", "13"],
      ["16", "17"],
      ["18", "19"],
      ["14", "15"],
    ]);
    expect(decided.map((runs) => runs.map((run) => run.text).join("")).join("")).toContain(
      "向丙方支付",
    );
    expect(
      decided.some((runs) => runs.some((run) => run.track?.id === "3" || run.track?.id === "4")),
    ).toBe(false);
  });
});
