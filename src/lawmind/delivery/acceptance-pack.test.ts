import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildAcceptancePackMarkdown } from "./acceptance-pack.js";

describe("buildAcceptancePackMarkdown", () => {
  let tmp: string;

  afterEach(async () => {
    if (tmp) {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  it("includes governance and quality sections", async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "lawmind-accept-"));
    const md = await buildAcceptancePackMarkdown(tmp);
    expect(md).toContain("LawMind customer acceptance pack");
    expect(md).toContain("LawMind governance report");
    expect(md).toContain("Sign-off checklist");
  });
});
