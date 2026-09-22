import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  distributeLintEscape,
  readEscapeCandidates,
  readEscapeCorpus,
  readEscapeStance,
  readLintEscapeFiles,
} from "./lint-escape-candidates.js";

const dirs: string[] = [];

function makeWorkspace(): string {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-esc-"));
  dirs.push(ws);
  return ws;
}

afterEach(() => {
  for (const dir of dirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  dirs.length = 0;
});

describe("lint-escape-candidates readers", () => {
  it("缺文件时 present=false，不是空数组——不得被读成「逃逸率为 0」", () => {
    const ws = makeWorkspace();
    const result = readEscapeCandidates(ws);
    expect(result.present).toBe(false);
    expect(result.rows).toEqual([]);
    expect(result.totalLines).toBe(0);
    expect(result.skippedLines).toBe(0);
  });

  it("writer → reader 往返：一次漏网产生三份候选（规则 / 语料 / 立场）", () => {
    const ws = makeWorkspace();
    distributeLintEscape(ws, {
      taskId: "t1",
      ruleIds: [],
      snippet: "本合同定金为标的额的百分之三十",
    });

    const { candidates, corpus, stance } = readLintEscapeFiles(ws);
    expect(candidates.present).toBe(true);
    expect(candidates.rows).toHaveLength(1);
    expect(candidates.rows[0]?.taskId).toBe("t1");
    // 空 ruleIds 是「规则零命中」的机器可判定标记（见 engine/reviewing.ts）
    expect(candidates.rows[0]?.ruleIds).toEqual([]);

    expect(corpus.present).toBe(true);
    expect(corpus.rows).toHaveLength(1);
    expect(corpus.rows[0]?.snippet).toContain("定金");

    // 定金会被 detectStanceClauseType 识别 → 立场候选
    expect(stance.present).toBe(true);
    expect(stance.rows.length).toBeGreaterThanOrEqual(1);
    expect(stance.rows[0]?.clauseType).toBeTruthy();
  });

  it("无正文片段时不写语料，但规则候选照写", () => {
    const ws = makeWorkspace();
    distributeLintEscape(ws, { taskId: "t1", ruleIds: ["statutory.deposit_cap"] });
    const { candidates, corpus } = readLintEscapeFiles(ws);
    expect(candidates.rows).toHaveLength(1);
    // 没有 snippet 就没有 corpus 行——reader 必须如实反映，不得合成空串
    expect(corpus.present).toBe(false);
    expect(corpus.rows).toEqual([]);
  });

  it("坏行 / 半写行被跳过并计数，不抛异常", () => {
    const ws = makeWorkspace();
    const file = path.join(ws, "lawmind/lint/escape-candidates.jsonl");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(
      file,
      [
        JSON.stringify({ ts: "2026-09-20T00:00:00.000Z", taskId: "ok", ruleIds: [] }),
        '{"ts":"2026-09-20T00:00:01.000Z","ruleI',
        "garbage",
        JSON.stringify({ taskId: "no-ts", ruleIds: [] }),
        JSON.stringify([1, 2, 3]),
        JSON.stringify({ ts: "2026-09-20T00:00:02.000Z", taskId: "ok2", ruleIds: ["r1"] }),
      ].join("\n"),
      "utf8",
    );

    const result = readEscapeCandidates(ws);
    expect(result.present).toBe(true);
    expect(result.rows).toHaveLength(2);
    // 6 行非空：2 行有效 + 4 行坏（半写 / garbage / 缺 ts / 非对象）
    expect(result.totalLines).toBe(6);
    expect(result.skippedLines).toBe(4);
  });

  it("ruleIds 里的非字符串项被过滤，空数组仍是空数组", () => {
    const ws = makeWorkspace();
    const file = path.join(ws, "lawmind/lint/escape-candidates.jsonl");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(
      file,
      JSON.stringify({
        ts: "2026-09-20T00:00:00.000Z",
        taskId: "t1",
        ruleIds: ["keep", 42, null, "", "also-keep"],
      }),
      "utf8",
    );
    const result = readEscapeCandidates(ws);
    expect(result.rows[0]?.ruleIds).toEqual(["keep", "also-keep"]);
  });

  it("语料缺 snippet 的行被跳过（不得合成空片段）", () => {
    const ws = makeWorkspace();
    const file = path.join(ws, "lawmind/lint/escape-corpus.jsonl");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(
      file,
      [
        JSON.stringify({
          ts: "2026-09-20T00:00:00.000Z",
          taskId: "a",
          snippet: "有正文",
          ruleIds: [],
        }),
        JSON.stringify({
          ts: "2026-09-20T00:00:01.000Z",
          taskId: "b",
          snippet: "   ",
          ruleIds: [],
        }),
        JSON.stringify({ ts: "2026-09-20T00:00:02.000Z", taskId: "c", ruleIds: [] }),
      ].join("\n"),
      "utf8",
    );
    const result = readEscapeCorpus(ws);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.taskId).toBe("a");
    expect(result.skippedLines).toBe(2);
  });

  it("立场行缺 clauseType 时被跳过", () => {
    const ws = makeWorkspace();
    const file = path.join(ws, "lawmind/lint/escape-stance.jsonl");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(
      file,
      [
        JSON.stringify({ ts: "2026-09-20T00:00:00.000Z", clauseType: "定金", snippet: "x" }),
        JSON.stringify({ ts: "2026-09-20T00:00:01.000Z", snippet: "y" }),
      ].join("\n"),
      "utf8",
    );
    const result = readEscapeStance(ws);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.clauseType).toBe("定金");
    expect(result.skippedLines).toBe(1);
  });
});
