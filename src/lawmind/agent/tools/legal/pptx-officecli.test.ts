import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveOfficeCliBin } from "../../../artifacts/officecli-bin.js";
import {
  applyPptxTextEdits,
  loadPptxVisualPreview,
  pptxPreviewCacheKey,
  pptxSlideCachePath,
  renderPptxSlideScreenshot,
} from "./pptx-officecli.js";

const dirs: string[] = [];
const bin = resolveOfficeCliBin();

afterEach(async () => {
  for (const dir of dirs.splice(0)) {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

describe("pptx-officecli helpers", () => {
  it("builds stable cache paths", () => {
    const key = pptxPreviewCacheKey("/tmp/a.pptx", 123);
    expect(key).toHaveLength(24);
    expect(pptxSlideCachePath("/ws", key, 2)).toContain(`pptx-preview/${key}/slide-2.png`);
  });
});

describe.runIf(Boolean(bin))("pptx-officecli visual (officecli present)", () => {
  it("loads slides, screenshots page 1, and applies a title edit", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "lm-pptx-vis-"));
    dirs.push(dir);
    const file = path.join(dir, "demo.pptx");
    const { buildMinimalChildEnv, runSafeCommand } =
      await import("../../../platform/safe-command.js");
    const create = await runSafeCommand({
      command: bin!,
      args: ["create", file],
      env: buildMinimalChildEnv(),
      timeoutMs: 60_000,
      stdio: ["ignore", "pipe", "pipe"],
    });
    expect(create.exitCode).toBe(0);
    await runSafeCommand({
      command: bin!,
      args: ["add", file, "/", "--type", "slide", "--prop", "title=原标题"],
      env: buildMinimalChildEnv(),
      timeoutMs: 60_000,
      stdio: ["ignore", "pipe", "pipe"],
    });
    await runSafeCommand({
      command: bin!,
      args: ["save", file],
      env: buildMinimalChildEnv(),
      timeoutMs: 30_000,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const visual = await loadPptxVisualPreview({ absPath: file });
    expect(visual.mode).toBe("visual");
    expect(visual.slideCount).toBeGreaterThanOrEqual(1);
    expect(visual.slides[0]?.shapes.some((s) => s.isTitle && s.text.includes("原标题"))).toBe(true);

    const outPng = path.join(dir, "s1.png");
    await renderPptxSlideScreenshot({
      absPath: file,
      page1Based: 1,
      outPng,
      width: 640,
      height: 360,
    });
    const png = await fs.readFile(outPng);
    expect(png.subarray(0, 4).toString("binary")).toBe("\u0089PNG");

    const titlePath = visual.slides[0]?.shapes.find((s) => s.isTitle)?.path;
    expect(titlePath).toBeTruthy();
    const applied = await applyPptxTextEdits({
      absPath: file,
      edits: [{ path: titlePath!, text: "新标题" }],
    });
    expect(applied.applied).toBe(1);
    const again = await loadPptxVisualPreview({ absPath: file });
    expect(again.slides[0]?.shapes.find((s) => s.isTitle)?.text).toContain("新标题");
  }, 120_000);
});
