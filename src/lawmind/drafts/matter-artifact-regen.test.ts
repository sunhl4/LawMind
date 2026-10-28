import { describe, expect, it } from "vitest";
import {
  formatMatterArtifactBatchPrompt,
  formatMatterArtifactRegeneratePrompt,
  MATTER_ARTIFACT_EXTENSIONS,
} from "./matter-artifact-regen.js";

describe("matter-artifact-regen", () => {
  it("embeds the three regeneration iron rules", () => {
    const text = formatMatterArtifactRegeneratePrompt({
      skill: "case-chronology",
      name: "大事记",
      file: "project.case-chronology.json",
    });
    expect(text).toContain("case-chronology");
    expect(text).toContain("`project.case-chronology.json`");
    expect(text).toContain("请先读取，再按本次要求更新，不另建同类文件");
    expect(text).toContain("资料不足时先向我确认，不编造内容");
  });

  it("batches selected extensions with shared context", () => {
    const batch = formatMatterArtifactBatchPrompt({
      matterName: "租赁纠纷",
      description: "催收与解除",
      extensionIds: ["timeline", "chronology"],
    });
    expect(batch).toContain("租赁纠纷");
    expect(batch).toContain("催收与解除");
    expect(batch).toContain("case-timeline");
    expect(batch).toContain("case-chronology");
    expect(batch).not.toContain("case-mindmap");
  });

  it("returns null when nothing selected", () => {
    expect(formatMatterArtifactBatchPrompt({ matterName: "x", extensionIds: [] })).toBeNull();
  });

  it("keeps the three default extension ids stable", () => {
    expect(MATTER_ARTIFACT_EXTENSIONS.map((e) => e.id)).toEqual([
      "timeline",
      "mindmap",
      "chronology",
    ]);
  });
});
