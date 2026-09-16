import { describe, expect, it } from "vitest";
import {
  extractDeliveryIntent,
  formatChatQaDeliveryPromptBlock,
  formatDeliveryConstraintPromptBlock,
  isOpinionMemoDelivery,
  resolveTurnDeliveryIntent,
  DELIVERY_MARKER_CHAT_QA,
  DELIVERY_MARKER_OPINION_MEMO,
  OPINION_MEMO_PIPELINE_HINT,
} from "./delivery-intent.js";

describe("extractDeliveryIntent", () => {
  it("treats 审查意见 + 放到桌面 + 不改原稿 as an opinion memo on the desktop", () => {
    const d = extractDeliveryIntent("请根据这个合同去给我一些审查意见放到桌面，不要在源文件上修改");
    expect(d.artifactShape).toBe("opinion_memo");
    expect(d.mutateSource).toBe("forbid");
    expect(d.outputPlace).toBe("desktop");
    expect(d.chatMirror).toBe("required");
    expect(isOpinionMemoDelivery(d)).toBe(true);
  });

  it("accepts paraphrases without freezing one Chinese sentence", () => {
    const rows = [
      "意见写到桌面，原稿别动",
      "另存一份审查意见，不要改合同本身",
      "修改建议单独出一份word，不要改原稿",
      "出一份修改建议放到桌面",
      "输入到桌面，只要审查意见，不修改原稿",
      "put the comments in a new word file on the desktop, don't edit the original",
      "save review comments to the desktop as a new document, do not modify the source",
    ];
    for (const instruction of rows) {
      const d = extractDeliveryIntent(instruction);
      expect(d.artifactShape, instruction).toBe("opinion_memo");
    }
  });

  it("does not override a plain 审查这份合同 into an opinion-memo sidecar", () => {
    const d = extractDeliveryIntent("请审查这份采购合同的违约责任");
    expect(d.artifactShape).toBe("unspecified");
    expect(d.outputPlace).toBe("unspecified");
    expect(d.mutateSource).toBe("unspecified");
    expect(isOpinionMemoDelivery(d)).toBe(false);
  });

  it("does not treat 桌面端 / LawMind 桌面 as a filesystem destination", () => {
    expect(extractDeliveryIntent("桌面端怎么导出 Word").outputPlace).toBe("unspecified");
    expect(extractDeliveryIntent("打开 LawMind 桌面应用").outputPlace).toBe("unspecified");
  });

  it("keeps tracked-source when the deliverable is a redline copy", () => {
    const d = extractDeliveryIntent("出一份带审阅痕迹的修订稿，不要改原稿");
    expect(d.artifactShape).toBe("tracked_source");
    expect(d.mutateSource).toBe("forbid");
  });

  it("leaves paired default when the lawyer asks for both opinion and redline", () => {
    const d = extractDeliveryIntent("审查意见和修订稿都要");
    expect(d.artifactShape).toBe("unspecified");
  });

  it("maps 下载 / 文稿 as named places", () => {
    expect(extractDeliveryIntent("审查意见保存到下载文件夹").outputPlace).toBe("downloads");
    expect(extractDeliveryIntent("把意见书输出到文稿").outputPlace).toBe("documents");
  });
});

describe("formatDeliveryConstraintPromptBlock", () => {
  it("emits a structural marker for opinion memos", () => {
    const block = formatDeliveryConstraintPromptBlock(
      extractDeliveryIntent("给我审查意见放到桌面，不要改原稿"),
    );
    expect(block).toContain(DELIVERY_MARKER_OPINION_MEMO);
    expect(block).toContain("render_document");
    expect(block).toContain("系统桌面");
    expect(block).toContain("工具表不收窄");
    expect(block).not.toContain("成套交件");
    expect(block).not.toContain("不要 `render_tracked_draft`");
  });

  it("does not freeze a tool sequence in the pipeline hint", () => {
    expect(OPINION_MEMO_PIPELINE_HINT).toContain("改稿工具仍可用");
    expect(OPINION_MEMO_PIPELINE_HINT).not.toContain("必须走");
  });

  it("stays quiet when delivery is unspecified", () => {
    expect(formatDeliveryConstraintPromptBlock(extractDeliveryIntent("请审查这份采购合同"))).toBe(
      undefined,
    );
  });
});

describe("formatChatQaDeliveryPromptBlock", () => {
  it("asks for a chat QA deliverable on 律师函核对", () => {
    const block = formatChatQaDeliveryPromptBlock("核对我起草的律师函是否有误");
    expect(block).toContain(DELIVERY_MARKER_CHAT_QA);
    expect(block).toContain("会话");
    expect(formatChatQaDeliveryPromptBlock("请审查这份采购合同")).toBeUndefined();
  });
});

describe("resolveTurnDeliveryIntent", () => {
  const wordPin = {
    pinKind: "file" as const,
    root: "project" as const,
    relPath: "采购合同.docx",
    kind: "file" as const,
  };
  const fastLane = [
    "【交办】5 分钟合同审查",
    "交付物类型：合同审查意见",
    "- 己方立场：中立",
    "- 审查重点：管辖",
  ].join("\n");

  it("keeps 5-minute opinion-only when no Word is pinned", () => {
    const d = resolveTurnDeliveryIntent(fastLane, []);
    expect(d.artifactShape).toBe("opinion_memo");
  });

  it("does not treat 5-minute 合同审查意见 as sidecar when a Word is pinned", () => {
    const d = resolveTurnDeliveryIntent(fastLane, [wordPin]);
    expect(d.artifactShape).toBe("unspecified");
    expect(d.mutateSource).toBe("unspecified");
  });

  it("still honors 不要改原稿 with a Word pin", () => {
    const d = resolveTurnDeliveryIntent(
      "请根据这个合同去给我一些审查意见放到桌面，不要在源文件上修改",
      [wordPin],
    );
    expect(d.artifactShape).toBe("opinion_memo");
    expect(d.mutateSource).toBe("forbid");
  });
});
