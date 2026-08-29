import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  findSimilarCaseMemories,
  formatSimilarCaseRecallBlock,
  recallAtK,
} from "./similar-case-recall.js";

const dirs: string[] = [];

afterEach(() => {
  for (const d of dirs.splice(0)) {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

describe("similar-case-recall", () => {
  it("ranks overlapping CASE.md from other matters", async () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-sim-"));
    dirs.push(ws);
    fs.mkdirSync(path.join(ws, "cases", "alpha"), { recursive: true });
    fs.mkdirSync(path.join(ws, "cases", "beta"), { recursive: true });
    fs.writeFileSync(
      path.join(ws, "cases", "alpha", "CASE.md"),
      "# CASE\n\n## 争点\n\n- 股权转让对赌条款争议\n",
      "utf8",
    );
    fs.writeFileSync(
      path.join(ws, "cases", "beta", "CASE.md"),
      "# CASE\n\n## 争点\n\n- 房屋租赁押金纠纷\n",
      "utf8",
    );
    const hits = await findSimilarCaseMemories({
      workspaceDir: ws,
      instruction: "请分析这份股权转让协议的对赌风险",
      currentMatterId: "beta",
      limit: 2,
      minScore: 0.1,
    });
    expect(hits.some((h) => h.matterId === "alpha")).toBe(true);
    expect(formatSimilarCaseRecallBlock(hits)).toContain("相关旧案经验");
  });

  it("weighted scoring prefers 争点 section over progress noise (Recall@1)", async () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-sim-w-"));
    dirs.push(ws);
    fs.mkdirSync(path.join(ws, "cases", "signal"), { recursive: true });
    fs.mkdirSync(path.join(ws, "cases", "noise"), { recursive: true });
    fs.mkdirSync(path.join(ws, "cases", "current"), { recursive: true });
    // Signal: key legal terms in 核心争点
    fs.writeFileSync(
      path.join(ws, "cases", "signal", "CASE.md"),
      [
        "# CASE",
        "",
        "## 1. 基本信息",
        "- 案由: 合同",
        "",
        "## 4. 核心争点",
        "- 股权转让对赌条款效力与业绩补偿",
        "",
        "## 9. 进度",
        "- 已开会",
      ].join("\n"),
      "utf8",
    );
    // Noise: same tokens scattered only in progress log (low weight) + filler bigrams
    fs.writeFileSync(
      path.join(ws, "cases", "noise", "CASE.md"),
      [
        "# CASE",
        "",
        "## 1. 基本信息",
        "- 案由: 劳动",
        "",
        "## 4. 核心争点",
        "- 加班费计算基数争议",
        "",
        "## 9. 进度",
        "- 客户提到股权转让对赌条款效力与业绩补偿仅作闲聊",
        "- 进行相关关于这个那个进行相关关于",
      ].join("\n"),
      "utf8",
    );
    fs.writeFileSync(path.join(ws, "cases", "current", "CASE.md"), "# CASE\n", "utf8");

    const instruction = "股权转让对赌条款效力与业绩补偿风险";
    const hits = await findSimilarCaseMemories({
      workspaceDir: ws,
      instruction,
      currentMatterId: "current",
      limit: 2,
      minScore: 0.05,
    });
    expect(hits[0]?.matterId).toBe("signal");
    expect(
      recallAtK([{ expectedMatterId: "signal", rankedIds: hits.map((h) => h.matterId) }], 1),
    ).toBe(1);
  });
});
