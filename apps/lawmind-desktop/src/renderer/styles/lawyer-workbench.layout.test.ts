import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Layout iron-laws for 律师工作台.
 * Regression: dock crushed `.lm-lawyer-cockpit` to height 0
 * so users only saw 快捷入口 and thought cases were missing.
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

  it("cockpit never shrinks below a visible floor", () => {
    const rules = topLevelBlock(css, ".lm-lawyer-cockpit");
    expect(rules).toMatch(/flex:\s*1\s+0\s+auto/);
    expect(rules).toMatch(/min-height:\s*320px/);
    expect(rules).not.toMatch(/(?:^|[^-])min-height:\s*0\s*;/m);
    expect(rules).toMatch(/grid-template-columns:\s*repeat\(3/);
  });

  it("≤1200px does not stack 快捷入口 into a single column that eats the cockpit", () => {
    const body = mediaBody(css, "max-width:\\s*1200px");
    expect(body).not.toMatch(/\.lm-desk-quick\s*,/);
    expect(body).not.toMatch(/\.lm-desk-quick\s*\{\s*[^}]*grid-template-columns:\s*1fr/);
    expect(body).toMatch(/\.lm-desk-quick\s*\{[^}]*grid-template-columns:\s*repeat\(3/);
    expect(body).not.toMatch(/\.lm-desk-quick-btn\s*\{[^}]*min-height:\s*88px/);
    expect(body).not.toMatch(/\.lm-lawyer-cockpit\s*,/);
    expect(body).not.toMatch(/\.lm-lawyer-cockpit\s*\{[^}]*grid-template-columns:\s*1fr/);
  });

  it("phone-narrow stacks cockpit with 本案列表 first", () => {
    const body = mediaBody(css, "max-width:\\s*860px");
    expect(body).toMatch(/\.lm-lawyer-cockpit\s*\{[^}]*grid-template-columns:\s*1fr/);
    expect(body).toMatch(/\.lm-desk-col--matters\s*\{\s*order:\s*-3/);
  });
});
