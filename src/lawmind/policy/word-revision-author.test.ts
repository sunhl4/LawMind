import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_WORD_REVISION_AUTHOR,
  normalizeWordRevisionAuthor,
  resolveWordRevisionAuthor,
} from "./word-revision-author.js";
import { readWorkspacePolicyFile } from "./workspace-policy.js";

describe("word revision author", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("defaults to LawMind and keeps a written name", () => {
    expect(resolveWordRevisionAuthor(undefined)).toBe(DEFAULT_WORD_REVISION_AUTHOR);
    expect(resolveWordRevisionAuthor("  ")).toBe("LawMind");
    expect(resolveWordRevisionAuthor("张律师")).toBe("张律师");
    expect(normalizeWordRevisionAuthor("  李律师  ")).toBe("李律师");
  });

  it("strips characters that would break revision.author and clamps length", () => {
    expect(normalizeWordRevisionAuthor("张=\n律师")).toBe("张律师");
    expect(normalizeWordRevisionAuthor("=")).toBeUndefined();
    expect(normalizeWordRevisionAuthor("名".repeat(80))?.length).toBe(64);
  });

  it("round-trips through lawmind.policy.json and treats a blank as unset", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lm-rev-author-"));
    dirs.push(dir);
    fs.writeFileSync(
      path.join(dir, "lawmind.policy.json"),
      `${JSON.stringify({ schemaVersion: 1, wordRevisionAuthor: "王律师" })}\n`,
      "utf8",
    );
    expect(readWorkspacePolicyFile(dir)?.wordRevisionAuthor).toBe("王律师");
    expect(resolveWordRevisionAuthor(readWorkspacePolicyFile(dir)?.wordRevisionAuthor)).toBe(
      "王律师",
    );

    fs.writeFileSync(
      path.join(dir, "lawmind.policy.json"),
      `${JSON.stringify({ schemaVersion: 1, wordRevisionAuthor: "   " })}\n`,
      "utf8",
    );
    expect(readWorkspacePolicyFile(dir)?.wordRevisionAuthor).toBeUndefined();
    expect(resolveWordRevisionAuthor(readWorkspacePolicyFile(dir)?.wordRevisionAuthor)).toBe(
      "LawMind",
    );
  });
});
