import { describe, expect, it } from "vitest";
import {
  collectRetrievedAnchors,
  parseArticleNumber,
  spliceRetrievedAnchors,
  type RetrievedAnchors,
} from "./lawyer-close-anchors.js";
import { constrainLawyerVisibleReply } from "./lawyer-close.js";
import type { AgentMessage } from "./types.js";

const anchors: RetrievedAnchors = {
  statutes: [
    {
      url: "https://flk.npc.gov.cn/detail/labor-63",
      blob: "中华人民共和国劳动合同法\n第六十三条 被派遣劳动者享有与用工单位的劳动者同工同酬的权利。",
    },
    {
      url: "https://127.0.0.1/secret",
      blob: "劳动合同法 第63条",
    },
  ],
  drafts: [{ title: "驾驶员劳务派遣协议", taskId: "task-1" }],
};

describe("retrieved anchors", () => {
  it("parses article numbers", () => {
    expect(parseArticleNumber("63")).toBe(63);
    expect(parseArticleNumber("六十三")).toBe(63);
    expect(parseArticleNumber("十")).toBe(10);
    expect(parseArticleNumber("一百零八")).toBe(108);
  });

  it("wraps the statute words and the draft title without rewriting the sentence", () => {
    const text =
      "派遣还在草稿里。驾驶员劳务派遣协议没有写同工同酬，见《劳动合同法》第63条。跨地区参保要单独约定。";
    const next = spliceRetrievedAnchors(text, anchors);
    expect(next).toContain("[《劳动合同法》第63条](https://flk.npc.gov.cn/detail/labor-63)");
    expect(next).toContain("[驾驶员劳务派遣协议](lm-draft:task-1)");
    expect(next).toContain("跨地区参保要单独约定。");
    expect(next).not.toContain("127.0.0.1");
  });

  it("does not wrap a cite that already has a link, or when two urls match", () => {
    const linked = "见 [《劳动合同法》第63条](https://flk.npc.gov.cn/detail/labor-63)。";
    expect(spliceRetrievedAnchors(linked, anchors)).toBe(linked);
    const ambiguous: RetrievedAnchors = {
      statutes: [
        { url: "https://flk.npc.gov.cn/a", blob: "劳动合同法 第63条" },
        { url: "https://www.pkulaw.com/chl/b", blob: "劳动合同法 第六十三条" },
      ],
      drafts: [],
    };
    const plain = "见《劳动合同法》第六十三条。";
    expect(spliceRetrievedAnchors(plain, ambiguous)).toBe(plain);
  });

  it("reads anchors from this turn's tool results and keeps the model's sentence", () => {
    const messages: AgentMessage[] = [
      {
        role: "tool",
        content: "",
        timestamp: "t",
        toolCallResponses: [
          {
            toolCallId: "c1",
            name: "search_statute",
            result: {
              ok: true,
              data: {
                hits: [
                  {
                    title: "劳动合同法",
                    url: "https://flk.npc.gov.cn/detail/labor-63",
                    snippet: "第63条 同工同酬",
                  },
                ],
              },
            },
          },
          {
            toolCallId: "c2",
            name: "draft_document",
            result: {
              ok: true,
              data: { taskId: "task-1", title: "驾驶员劳务派遣协议" },
            },
          },
        ],
      },
    ];
    const found = collectRetrievedAnchors(messages);
    const text = constrainLawyerVisibleReply(
      [
        "驾驶员劳务派遣协议里，同工同酬见《劳动合同法》第63条。",
        "guardian_fail 不要给律师看。",
      ].join("\n"),
      found,
    );
    expect(text).toContain("[驾驶员劳务派遣协议](lm-draft:task-1)里，同工同酬见");
    expect(text).toContain("[《劳动合同法》第63条](https://flk.npc.gov.cn/detail/labor-63)");
    expect(text).not.toContain("guardian");
  });
});
