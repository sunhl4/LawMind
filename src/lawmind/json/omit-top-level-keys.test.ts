import { describe, expect, it } from "vitest";
import { parseJsonOmittingTopLevelKeys } from "./omit-top-level-keys.js";

describe("parseJsonOmittingTopLevelKeys", () => {
  it("drops a top-level array and keeps the other fields", () => {
    const history = [
      { role: "user", content: 'he said "keep {this}"' },
      { role: "assistant", content: "line\nwith brace }" },
    ];
    const raw = JSON.stringify({
      sessionId: "s1",
      conversationHistory: history,
      title: "租赁",
      turns: [{ instruction: "问违约金", status: "completed" }],
    });
    const parsed = parseJsonOmittingTopLevelKeys(raw, new Set(["conversationHistory"]));
    expect(parsed).toEqual({
      sessionId: "s1",
      title: "租赁",
      turns: [{ instruction: "问违约金", status: "completed" }],
    });
    expect(JSON.parse(raw)).toMatchObject({ conversationHistory: history });
  });

  it("omits the first, middle, and last keys", () => {
    const raw = JSON.stringify({
      sections: [{ heading: "一", blocks: ["正文"] }],
      taskId: "t1",
      reviewStatus: "pending",
      pairedOpinionSections: [{ heading: "意见" }],
    });
    expect(
      parseJsonOmittingTopLevelKeys(raw, new Set(["sections", "pairedOpinionSections"])),
    ).toEqual({
      taskId: "t1",
      reviewStatus: "pending",
    });
  });

  it("returns null for a non-object so the caller can full-parse", () => {
    expect(parseJsonOmittingTopLevelKeys("[1,2]", new Set(["a"]))).toBeNull();
    expect(parseJsonOmittingTopLevelKeys("{", new Set(["a"]))).toBeNull();
  });
});
