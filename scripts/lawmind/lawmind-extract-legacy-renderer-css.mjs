#!/usr/bin/env node
/**
 * Build styles/legacy-rest.css from git HEAD styles.css for selectors missing
 * from current renderer CSS modules (fixes UI regressions after modular split).
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rendererDir = path.resolve(__dirname, "../../apps/lawmind-desktop/src/renderer");
const stylesDir = path.join(rendererDir, "styles");
const outPath = path.join(stylesDir, "legacy-rest.css");

const MODULE_FILES = [
  "animations.css",
  "buttons.css",
  "callouts.css",
  "chat.css",
  "desk-layout.css",
  "file-workbench.css",
  "matter-review-workbench.css",
  "modal-forms.css",
  "model-picker.css",
  "settings.css",
  "shell-header.css",
  "utilities.css",
  "workflow-hub.css",
];

function readHeadStyles() {
  return execFileSync("git", ["show", "HEAD:apps/lawmind-desktop/src/renderer/styles.css"], {
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  });
}

function readCurrentCssAggregate() {
  const parts = MODULE_FILES.map((f) => fs.readFileSync(path.join(stylesDir, f), "utf8"));
  const styles = fs.readFileSync(path.join(rendererDir, "styles.css"), "utf8");
  const inline = styles.replace(/\/\* ── imported:[\s\S]*$/m, "");
  return `${inline}\n${parts.join("\n")}`;
}

function definedClassNames(css) {
  const names = new Set();
  for (const m of css.matchAll(/\.(lm-[a-zA-Z0-9_-]+)/g)) {
    names.add(m[1]);
  }
  return names;
}

/** Split CSS into top-level rules (handles @media blocks). */
function splitTopLevelRules(css) {
  const rules = [];
  let i = 0;
  while (i < css.length) {
    while (i < css.length && /\s/.test(css[i])) {
      i++;
    }
    if (i >= css.length) {
      break;
    }
    if (css[i] === "/") {
      const end = css.indexOf("*/", i);
      if (end < 0) {
        break;
      }
      rules.push({ kind: "comment", text: css.slice(i, end + 2) });
      i = end + 2;
      continue;
    }
    const start = i;
    let depth = 0;
    while (i < css.length) {
      const ch = css[i];
      if (ch === "{") {
        depth++;
      } else if (ch === "}") {
        depth--;
        if (depth === 0) {
          i++;
          break;
        }
      }
      i++;
    }
    rules.push({ kind: "rule", text: css.slice(start, i).trimEnd() });
  }
  return rules;
}

function ruleClassNames(ruleText) {
  const pre = ruleText.split("{")[0] ?? "";
  return [...pre.matchAll(/\.(lm-[a-zA-Z0-9_-]+)/g)].map((m) => m[1]);
}

function main() {
  const headCss = readHeadStyles();
  const currentCss = readCurrentCssAggregate();
  const defined = definedClassNames(currentCss);
  const headRules = splitTopLevelRules(headCss);

  const out = ["/* Restored from git HEAD — selectors missing from modular CSS */"];
  let restored = 0;
  let lastComment = "";

  for (const item of headRules) {
    if (item.kind === "comment") {
      if (item.text.includes("──")) {
        lastComment = item.text;
      }
      continue;
    }
    const classes = ruleClassNames(item.text);
    if (classes.length === 0) {
      continue;
    }
    const missing = classes.filter((c) => !defined.has(c));
    if (missing.length === 0) {
      continue;
    }
    if (lastComment && !out.at(-1)?.includes(lastComment)) {
      out.push("", lastComment);
      lastComment = "";
    }
    out.push(item.text);
    for (const c of missing) {
      defined.add(c);
    }
    restored++;
  }

  fs.writeFileSync(outPath, `${out.join("\n")}\n`, "utf8");
  console.log(
    `[lawmind-extract-legacy-renderer-css] wrote ${path.relative(process.cwd(), outPath)} (${restored} rules)`,
  );
}

main();
