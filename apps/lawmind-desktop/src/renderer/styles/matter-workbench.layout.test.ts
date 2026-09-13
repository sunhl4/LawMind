import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const cssPath = join(dirname(fileURLToPath(import.meta.url)), "matter-review-workbench.css");

describe("matter workbench panel scroll", () => {
  const css = readFileSync(cssPath, "utf8");

  it("tabpanel fills remaining height so 概览 can scroll instead of being clipped", () => {
    expect(css).toMatch(/\.lm-workbench-tabpanel\s*\{[^}]*flex:\s*1/);
    expect(css).toMatch(/\.lm-workbench-tabpanel\s*\{[^}]*min-height:\s*0/);
    expect(css).toMatch(/\.lm-workbench-tabpanel\s*\{[^}]*overflow:\s*hidden/);
  });

  it("panel itself scrolls vertically", () => {
    expect(css).toMatch(/\.lm-workbench-panel\s*\{[^}]*overflow-y:\s*auto/);
  });

  it("matter tabs are a page row with no boxed overflow scrollbar", () => {
    expect(css).toMatch(/\.lm-workbench-tabs\.lm-tabs\s*\{[^}]*overflow-x:\s*auto/);
    expect(css).toMatch(/\.lm-workbench-tabs\.lm-tabs\s*\{[^}]*overflow-y:\s*hidden/);
    expect(css).toMatch(/\.lm-workbench-tabs\.lm-tabs\s*\{[^}]*scrollbar-width:\s*none/);
  });

  it("review matrix keeps the table as the only scroll surface", () => {
    expect(css).toMatch(
      /\.lm-workbench-panel\.lm-review-matrix\s*\{[^}]*overflow:\s*hidden/,
    );
  });

  it("daily 待办 is a compact block, not a 2x2 kitchen sink", () => {
    expect(css).toMatch(/\.lm-matter-todo-block\s*\{/);
    expect(css).toMatch(/\.lm-matter-cockpit-grid\s*\{[^}]*auto-fit/);
  });
});

describe("review matrix table scroll", () => {
  const css = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "workflow-hub.css"),
    "utf8",
  );

  it("matrix table pane fills leftover height and scrolls on both axes", () => {
    expect(css).toMatch(/\.lm-review-matrix__scroll\s*\{[^}]*flex:\s*1/);
    expect(css).toMatch(/\.lm-review-matrix__scroll\s*\{[^}]*min-height:\s*200px/);
    expect(css).toMatch(/\.lm-review-matrix__scroll\s*\{[^}]*overflow:\s*auto/);
  });
});
