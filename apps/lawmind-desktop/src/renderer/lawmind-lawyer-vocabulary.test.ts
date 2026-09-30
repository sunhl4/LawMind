import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  LAWYER_VOCABULARY,
  RETIRED_LAWYER_SYNONYMS,
  RETIRED_SYNONYM_ALLOWED_PATH_FRAGMENTS,
} from "./lawmind-lawyer-vocabulary.js";

const rendererDir = path.dirname(new URL(import.meta.url).pathname);
const desktopDir = path.resolve(rendererDir, "../..");
/**
 * 同时扫引擎：`src/lawmind` 里有直接发给律师的文案（例：自动办件收件箱的
 * 摘要与失败说明）。把它排除在外，守卫就只覆盖了一半裂缝。
 */
const repoRoot = path.resolve(desktopDir, "../..");
const engineDir = path.join(repoRoot, "src", "lawmind");

/** 递归列出待检查的文件。跳过测试与产物目录。 */
function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist" || entry.name === "test-results") {
        continue;
      }
      walk(full, out);
      continue;
    }
    if (!/\.(tsx?|spec\.ts)$/.test(entry.name)) {
      continue;
    }
    if (/\.test\.tsx?$/.test(entry.name)) {
      continue;
    }
    out.push(full);
  }
  return out;
}

function isAllowed(file: string): boolean {
  return RETIRED_SYNONYM_ALLOWED_PATH_FRAGMENTS.some((frag) => file.includes(frag));
}

describe("律师可见词汇", () => {
  it("每个对象只有一个对外名字（退休同义词不得复活）", () => {
    // 这条守卫针对的是**真实发生过的漂移**：定时任务在设置导航与主界面叫
    // 「自动办件」，而它自己的面板内部叫「我的交办任务」——同一个功能两个名字，
    // 律师得猜它们是不是一回事。改完后用它挡住回退。
    const offenders: string[] = [];
    for (const file of [...walk(desktopDir), ...walk(engineDir)]) {
      if (isAllowed(file)) {
        continue;
      }
      const text = fs.readFileSync(file, "utf8");
      for (const synonym of Object.keys(RETIRED_LAWYER_SYNONYMS)) {
        if (text.includes(synonym)) {
          offenders.push(`${path.relative(repoRoot, file)} 仍出现「${synonym}」`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("自动办件这个对象在面板里只用同一个名字", () => {
    // 上一条是全局扫描；这条盯住出过问题的那一个文件，失败信息更直接。
    const panel = path.join(rendererDir, "LawmindAutomationsPanel.tsx");
    const text = fs.readFileSync(panel, "utf8");
    expect(text).toContain(LAWYER_VOCABULARY.automation);
    for (const synonym of Object.keys(RETIRED_LAWYER_SYNONYMS)) {
      expect(text).not.toContain(synonym);
    }
  });

  it("一级导航仍然只有那几个人话词（没有把内部词漏出去）", () => {
    // 盘点时确认过的现状，钉住它——避免以后顺手把内部说法加进顶栏。
    const header = fs.readFileSync(
      path.join(rendererDir, "app", "LawmindAppHeader.tsx"),
      "utf8",
    );
    for (const label of ["对话", "工作台"]) {
      expect(header).toContain(label);
    }
    expect(header).not.toContain("在办");
    for (const internal of ["守护", "判断分级", "编制"]) {
      expect(header).not.toContain(internal);
    }
  });

  it("退休同义词的允许名单是具体的（不能变成放行一切的宽口径）", () => {
    // 允许名单一旦写成空串或 "/"，这条守卫就形同虚设。
    for (const frag of RETIRED_SYNONYM_ALLOWED_PATH_FRAGMENTS) {
      expect(frag.length).toBeGreaterThan(8);
    }
  });
});
