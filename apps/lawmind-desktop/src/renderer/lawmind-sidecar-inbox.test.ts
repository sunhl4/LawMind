import { describe, expect, it } from "vitest";
import { sidecarInboxBannerText, sidecarSourceLabel } from "./lawmind-sidecar-inbox";

describe("sidecar inbox copy", () => {
  it("names the source and desk verb", () => {
    expect(sidecarSourceLabel("word")).toBe("Word");
    expect(
      sidecarInboxBannerText({
        relativePath: "inbox/sidecar-word-1.md",
        title: "违约金",
        source: "word",
        verb: "review",
        prompt: "审这份：\n\n条款",
        charCount: 2,
        mtimeMs: 1,
      }),
    ).toBe("Word 送来一份选区，可用「审这份」继续。");
  });
});
