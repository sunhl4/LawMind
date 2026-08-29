import { describe, expect, it } from "vitest";
import { readPinnedWordExcerpt } from "./word-revision-document-excerpt.js";

describe("readPinnedWordExcerpt", () => {
  it("returns empty when the pin is not on disk", async () => {
    const text = await readPinnedWordExcerpt({
      workspaceDir: "/tmp/does-not-exist-lm-excerpt",
      pins: [
        {
          pinKind: "file",
          root: "workspace",
          relPath: "missing.docx",
          kind: "file",
        },
      ],
    });
    expect(text).toBe("");
  });
});
