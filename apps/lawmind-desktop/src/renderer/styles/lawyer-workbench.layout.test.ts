import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Layout iron-laws for 律师工作台.
 * Regression: the case list must not collapse to height 0.
 */
const cssPath = join(dirname(fileURLToPath(import.meta.url)), "lawyer-workbench.css");

/** First top-level rule whose selector is exactly `selector` (not a descendant). */
function topLevelBlock(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`);
  const m = css.match(re);
  expect(m, `missing top-level rule ${selector}`).toBeTruthy();
  return m?.[1] ?? "";
}

function mediaBody(css: string, query: string): string {
  const re = new RegExp(`@media\\s*\\(${query}\\)\\s*\\{([\\s\\S]*?)\\n\\}`);
  const m = css.match(re);
  expect(m, `missing @media (${query})`).toBeTruthy();
  return m?.[1] ?? "";
}

describe("lawyer-workbench layout iron-laws", () => {
  const css = readFileSync(cssPath, "utf8");

  it("workbench scrolls instead of clipping the cockpit", () => {
    const rules = topLevelBlock(css, ".lm-lawyer-workbench");
    expect(rules).toMatch(/overflow:\s*auto/);
    expect(rules).not.toMatch(/overflow:\s*hidden/);
  });

  it("case list never shrinks below a visible floor and is not a side rail", () => {
    const rules = topLevelBlock(css, ".lm-lawyer-cockpit");
    expect(rules).toMatch(/display:\s*flex/);
    expect(rules).toMatch(/flex-direction:\s*column/);
    expect(rules).toMatch(/flex:\s*1\s+0\s+auto/);
    expect(rules).toMatch(/min-height:\s*320px/);
    expect(rules).not.toMatch(/(?:^|[^-])min-height:\s*0\s*;/m);
    expect(rules).not.toMatch(/grid-template-columns:\s*280px/);
  });

  it("matter now is a vertical stack, never a card wall", () => {
    const now = css.match(/\.lm-matter-now,\s*\n\.lm-matter-volume,\s*\n\.lm-matter-archive\s*\{([^}]*)\}/);
    expect(now, "missing .lm-matter-now group").toBeTruthy();
    const body = now?.[1] ?? "";
    expect(body).toMatch(/display:\s*flex/);
    expect(body).toMatch(/flex-direction:\s*column/);
    expect(body).not.toMatch(/grid-template-columns:\s*repeat\(4/);
  });

  it("narrow windows do not put the case list back in a side rail", () => {
    const wide = mediaBody(css, "max-width:\\s*1200px");
    expect(wide).not.toMatch(/\.lm-lawyer-cockpit\s*\{[^}]*grid-template-columns:\s*280px/);
    const phone = mediaBody(css, "max-width:\\s*860px");
    expect(phone).not.toMatch(/grid-template-columns:\s*280px/);
    expect(phone).not.toMatch(/\.lm-desk-col--matters\s*\{\s*order:\s*-1/);
  });
});
