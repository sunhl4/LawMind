import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const tokensPath = join(dirname(fileURLToPath(import.meta.url)), "tokens.css");

function definedTokens(css: string): Set<string> {
  const root = css.match(/:root\s*\{([\s\S]*?)\}/);
  if (!root) {
    return new Set();
  }
  return new Set([...root[1].matchAll(/--([a-zA-Z0-9-]+)\s*:/g)].map((m) => m[1]));
}

function readRendererCssFiles(): Array<{ path: string; content: string }> {
  const stylesDir = dirname(fileURLToPath(import.meta.url));
  const cssFiles = [
    join(stylesDir, "../styles.css"),
    join(stylesDir, "animations.css"),
    join(stylesDir, "buttons.css"),
    join(stylesDir, "callouts.css"),
    join(stylesDir, "chat.css"),
    join(stylesDir, "desk-layout.css"),
    join(stylesDir, "file-workbench.css"),
    join(stylesDir, "matter-review-workbench.css"),
    join(stylesDir, "modal-forms.css"),
    join(stylesDir, "settings.css"),
    join(stylesDir, "shell-header.css"),
    join(stylesDir, "utilities.css"),
    join(stylesDir, "legacy-rest.css"),
    join(stylesDir, "model-picker.css"),
    join(stylesDir, "workflow-hub.css"),
    // 在办/自动化/指挥台样式模块此前漏扫，token 漂移会静默进包。
    join(stylesDir, "agents-workbench.css"),
    join(stylesDir, "automations.css"),
    join(stylesDir, "agent-fleet.css"),
    // 案件导航/决策仪式/会议室同样纳入 token 扫描。
    join(stylesDir, "cockpit-nav.css"),
    join(stylesDir, "decision-ceremony.css"),
    join(stylesDir, "meeting-workbench.css"),
  ];
  return cssFiles.map((path) => ({ path, content: readFileSync(path, "utf8") }));
}

describe("styles/tokens.css", () => {
  it("defines aliases used by shell/chat/workbench CSS", () => {
    const defined = definedTokens(readFileSync(tokensPath, "utf8"));
    for (const token of [
      "text-muted",
      "border-subtle",
      "surface-elevated",
      "bg-elevated",
      "radius-md",
      "lm-border",
      "lm-surface-elevated",
      "lm-text",
      "lm-muted",
      "fs-2xs",
      "fs-sm",
      "fs-md",
      "fs-3xl",
      "fw-semibold",
      "space-0",
      "space-7",
      "space-16",
      "danger",
      "danger-hover",
      "danger-dim",
      "danger-border",
      "danger-text",
      "danger-on",
      "grad-danger",
      "grad-danger-hover",
      "shadow-danger",
      "on-brand",
      "lm-danger",
    ]) {
      expect(defined.has(token), `--${token}`).toBe(true);
    }
  });

  it("styles.css references only defined token aliases (no orphan --lm-* in grep sample)", () => {
    const defined = definedTokens(readFileSync(tokensPath, "utf8"));
    const used = readRendererCssFiles().flatMap(({ content }) =>
      [...content.matchAll(/var\(--([a-zA-Z0-9-]+)/g)].map((m) => m[1]),
    );
    for (const token of new Set(used)) {
      expect(defined.has(token), `renderer css uses undefined --${token}`).toBe(true);
    }
  });

  it("fallback vars only guard defined tokens", () => {
    const defined = definedTokens(readFileSync(tokensPath, "utf8"));
    const fallbackRefs = readRendererCssFiles().flatMap(({ path, content }) =>
      [...content.matchAll(/var\(--([a-zA-Z0-9-]+)\s*,\s*#[0-9a-fA-F]{3,8}\)/g)].map((m) => ({
        path,
        token: m[1],
      })),
    );
    for (const ref of fallbackRefs) {
      expect(defined.has(ref.token), `${ref.path} fallback token --${ref.token} missing in tokens.css`).toBe(
        true,
      );
    }
  });

  it("destructive buttons use seal-red danger tokens, not candy pink", () => {
    const stylesDir = dirname(fileURLToPath(import.meta.url));
    const buttons = readFileSync(join(stylesDir, "buttons.css"), "utf8");
    expect(buttons).toContain("var(--grad-danger)");
    expect(buttons).toContain("var(--danger-on)");
    expect(buttons).not.toMatch(/#f28585|#e05555|#f89595/);
  });

  it("side file explorer scroll children keep natural height (no flex-shrink clip)", () => {
    const stylesDir = dirname(fileURLToPath(import.meta.url));
    const moduleCss = readFileSync(join(stylesDir, "file-workbench.css"), "utf8");
    const bundledCss = readFileSync(join(stylesDir, "../styles.css"), "utf8");
    const rule = /\.lm-files-explorer-scroll\s*>\s*\*\s*\{[^}]*flex-shrink:\s*0/;
    expect(moduleCss, "file-workbench.css").toMatch(rule);
    expect(bundledCss, "styles.css (run pnpm lawmind:sync:renderer-css)").toMatch(rule);
  });

  it("bundled styles.css keeps a single tokenized danger callout", () => {
    const bundledCss = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../styles.css"), "utf8");
    const dangerBlocks = bundledCss.match(/\.lm-callout-danger\s*\{[^}]+\}/g) ?? [];
    expect(dangerBlocks.length).toBeGreaterThanOrEqual(1);
    expect(bundledCss).not.toMatch(/#ff9494|#f28585|#e05555/);
    expect(bundledCss).toContain("color-mix(in srgb, var(--danger)");
  });
});
