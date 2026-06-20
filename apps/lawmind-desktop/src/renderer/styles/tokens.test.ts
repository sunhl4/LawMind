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
});
