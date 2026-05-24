import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildAdoptionPreviewDiff } from "./adoption-preview-diff.js";
import { suggestMemoryAdoption } from "./adoption-service.js";

describe("buildAdoptionPreviewDiff", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const d of dirs.splice(0)) {
      fs.rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    }
  });

  it("previews lawyer profile_learning append in section eight", async () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-adopt-diff-"));
    dirs.push(ws);
    fs.mkdirSync(path.join(ws, "audit"), { recursive: true });
    fs.writeFileSync(
      path.join(ws, "LAWYER_PROFILE.md"),
      "# Profile\n\n## 八、个人积累\n\n- old line\n\n---\n\n_最后更新\n",
    );
    const rec = await suggestMemoryAdoption(ws, path.join(ws, "audit"), {
      scope: "lawyer",
      kind: "lawyer.profile_learning",
      payload: "新学习要点",
    });
    const result = await buildAdoptionPreviewDiff(ws, rec.id);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.targetPath).toBe("LAWYER_PROFILE.md");
      expect(result.hunks.some((h) => h.type === "add")).toBe(true);
    }
  });

  it("returns not_found for unknown id", async () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-adopt-diff-"));
    dirs.push(ws);
    const result = await buildAdoptionPreviewDiff(ws, "missing-id");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("not_found");
    }
  });
});
