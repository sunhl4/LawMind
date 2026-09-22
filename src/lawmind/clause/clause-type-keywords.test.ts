import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  CLAUSE_TYPE_KEYWORDS,
  FORUM_MENTION_RE,
  clauseTypeMentionedIn,
  detectClauseTypeKeyword,
} from "./clause-type-keywords.js";

describe("clause-type-keywords（P0-4d 单一真相源）", () => {
  it("六个条款类型齐备，且 id 不重复", () => {
    const ids = CLAUSE_TYPE_KEYWORDS.map((r) => r.id);
    expect(ids).toEqual(["管辖", "违约金", "保密", "赔偿", "知识产权", "定金"]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("判据按顺序取首个命中（顺序即优先级）", () => {
    // 同时含「管辖」与「赔偿」的文本 → 取排在前面的管辖
    expect(detectClauseTypeKeyword("争议解决与赔偿责任")).toBe("管辖");
    expect(detectClauseTypeKeyword("违约金与赔偿责任")).toBe("违约金");
  });

  it("命中不了返回 undefined（不猜）", () => {
    expect(detectClauseTypeKeyword("普通催告函")).toBeUndefined();
  });

  it("分类用途**不**把「人民法院」当作管辖（否则会误分类赔偿责任）", () => {
    // 这是 P0-4d 的关键：分类必须窄。旧 self-check 的表含人民法院，导致漂移。
    expect(detectClauseTypeKeyword("赔偿责任由人民法院判决")).toBe("赔偿");
    expect(detectClauseTypeKeyword("由人民法院判决")).toBeUndefined();
  });

  it("clauseTypeMentionedIn 默认同样不放宽", () => {
    expect(clauseTypeMentionedIn("由人民法院判决", "管辖")).toBe(false);
    expect(clauseTypeMentionedIn("由人民法院判决", "管辖", { includeForumMentions: true })).toBe(
      true,
    );
  });

  it("includeForumMentions 只影响「管辖」，不影响其它类型", () => {
    expect(clauseTypeMentionedIn("由人民法院判决", "赔偿", { includeForumMentions: true })).toBe(
      false,
    );
    expect(clauseTypeMentionedIn("赔偿损失", "赔偿", { includeForumMentions: true })).toBe(true);
  });

  it("未知条款类型返回 false（不抛）", () => {
    expect(clauseTypeMentionedIn("任意文本", "不存在的类型")).toBe(false);
  });

  it("FORUM_MENTION_RE 只覆盖审判/仲裁机构提及", () => {
    expect(FORUM_MENTION_RE.test("由人民法院管辖")).toBe(true);
    expect(FORUM_MENTION_RE.test("提交仲裁委")).toBe(false);
  });
});

describe("P0-4d 反漂移：三个消费方不得再各自复制这张表", () => {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

  const consumers: Array<{ file: string; mustImport: string }> = [
    {
      file: "src/lawmind/historical-scan/habit-extract.ts",
      mustImport: 'from "../clause/clause-type-keywords.js"',
    },
    {
      file: "src/lawmind/stance/capture.ts",
      mustImport: 'from "../clause/clause-type-keywords.js"',
    },
    {
      file: "src/lawmind/stance/self-check.ts",
      mustImport: 'from "../clause/clause-type-keywords.js"',
    },
  ];

  for (const { file, mustImport } of consumers) {
    it(`${file} 引用共享表，且不再内联条款正则表`, () => {
      const src = readFileSync(path.join(repoRoot, file), "utf8");
      expect(src).toContain(mustImport);
      // 反例：内联了 { id: "违约金", re: /违约金/ } 这类表项
      expect(src).not.toMatch(/\{\s*id:\s*"违约金",\s*re:/);
      expect(src).not.toMatch(/\{\s*id:\s*"管辖",\s*re:/);
    });
  }
});
