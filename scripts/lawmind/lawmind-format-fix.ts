#!/usr/bin/env node
/**
 * 格式自动修 · 可跑示例。
 *
 *   pnpm lawmind:format-fix -- --file cases/m/回稿.docx
 *   pnpm lawmind:format-fix -- --file cases/m/回稿.docx --mode from-scratch
 *   pnpm lawmind:format-fix -- --file cases/m/回稿.docx --lawmind 3,4 --out 回稿_格式修订.docx
 *
 * 做的事（A 层，只写副本）：
 *   1. 体检：先出一份「哪不行」清单；
 *   2. 只改正文字体、字号、固定行距、首行缩进，写成 Word 格式修订（rPrChange/pPrChange）；
 *   3. 原有 w:ins / w:del 逐条对账，丢一条就失败，不出副本；
 *   4. 再体检一次，打印「改前 → 改后」。
 *
 * 不做的事（B/C 层）：标题层级与编号重排、页边距、成文日期位置、改措辞/金额/法条。
 */

import fs from "node:fs/promises";
import path from "node:path";
import {
  auditDocumentFormat,
  renderFormatAuditText,
  type FormatAuditMode,
} from "../../src/lawmind/drafts/document-format-audit.js";
import {
  applyFormatFixesToDocxFile,
  planFormatFixes,
} from "../../src/lawmind/drafts/format-fix.js";
import { readDocxDocumentLayout } from "../../src/lawmind/drafts/word-surface.js";

const USAGE = [
  "用法: pnpm lawmind:format-fix -- --file <path.docx> [options]",
  "        --mode imported|from-scratch|retemplate   默认 imported（跟随原文）",
  "        --lawmind 3,4        仅 imported：LawMind 写过的段落序号（0 基）",
  "        --out <path.docx>    副本路径，默认 <原名>_格式修订.docx",
  "        --author <name>      修订署名，默认 LawMind",
  "        --dry-run            只出计划，不写文件",
].join("\n");

function flag(name: string): string | undefined {
  const at = process.argv.indexOf(name);
  if (at < 0) {
    return undefined;
  }
  const value = process.argv[at + 1];
  return value && !value.startsWith("--") ? value : undefined;
}

function fail(message: string): never {
  console.error(`${message}\n${USAGE}`);
  process.exit(2);
}

const file = flag("--file");
if (!file) {
  fail("缺少 --file");
}
const mode = (flag("--mode") ?? "imported") as FormatAuditMode;
if (!["imported", "from-scratch", "retemplate"].includes(mode)) {
  fail(`不认识的 --mode：${mode}`);
}
const lawmind = flag("--lawmind")
  ?.split(",")
  .map((part) => Number(part.trim()))
  .filter((value) => Number.isInteger(value) && value >= 0);
const author = flag("--author") ?? "LawMind";
const dryRun = process.argv.includes("--dry-run");
const outArg = flag("--out");
const absIn = path.resolve(file);
const absOut = outArg ? path.resolve(outArg) : absIn.replace(/\.docx$/i, "") + "_格式修订.docx";

async function main(): Promise<void> {
  await fs.access(absIn);
  const layout = await readDocxDocumentLayout(absIn);
  const before = auditDocumentFormat({
    page: layout.page,
    blocks: layout.blocks,
    mode,
    ...(lawmind?.length ? { lawmindParagraphs: lawmind } : {}),
  });

  console.log(renderFormatAuditText(before));
  console.log("");

  const plan = planFormatFixes({
    mode,
    page: layout.page,
    blocks: layout.blocks,
    ...(lawmind?.length ? { lawmindParagraphs: lawmind } : {}),
  });
  console.log(
    `【自动修计划】${plan.fixes.length} 段；目标：${[
      plan.target.rFontsXml ? "原文 rFonts" : plan.target.fontFamily,
      plan.target.halfPt ? `${plan.target.halfPt / 2}pt` : undefined,
      plan.target.line ? "固定行距" : undefined,
      plan.target.firstIndentChars != null
        ? `首行缩进 ${plan.target.firstIndentChars} 字`
        : undefined,
    ]
      .filter(Boolean)
      .join(" · ")}`,
  );
  for (const fix of plan.fixes.slice(0, 10)) {
    console.log(
      `  - 第 ${fix.paragraphIndex + 1} 段 [${fix.kinds.join(", ")}] ${fix.text.slice(0, 30)}…`,
    );
  }
  console.log(`【明确不改】${plan.skippedKinds.join("；")}`);
  console.log("");

  if (dryRun) {
    console.log("--dry-run：未写文件。");
    return;
  }
  if (plan.fixes.length === 0) {
    console.log("没有可自动改的段落，未写副本。");
    return;
  }

  const result = await applyFormatFixesToDocxFile({
    inputAbs: absIn,
    outputAbs: absOut,
    mode,
    author,
    ...(lawmind?.length ? { lawmindParagraphs: lawmind } : {}),
  });
  if (!result.ok) {
    console.error(`✗ ${result.error ?? "自动修失败"}`);
    process.exitCode = 1;
    return;
  }
  if ((result.appliedParagraphs ?? 0) === 0) {
    console.log(`没有写副本：${result.warning ?? "体检有项但一段都没定位到（不改比改错强）。"}`);
    return;
  }

  console.log(
    `【已写副本】${absOut}\n  改动 ${result.appliedParagraphs ?? 0} 段 / ${
      result.appliedRuns ?? 0
    } 个 run；原有修订 ${
      result.revisions?.verified
        ? `${result.revisions.beforeCount} 条 → ${result.revisions.afterCount} 条（原有全在）`
        : "无法核验"
    }`,
  );
  if (result.warning) {
    console.log(`  提示：${result.warning}`);
  }

  const afterLayout = await readDocxDocumentLayout(absOut);
  const after = auditDocumentFormat({
    page: afterLayout.page,
    blocks: afterLayout.blocks,
    mode,
    ...(lawmind?.length ? { lawmindParagraphs: lawmind } : {}),
  });
  console.log("");
  console.log("【改后再体检】");
  console.log(renderFormatAuditText(after));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
