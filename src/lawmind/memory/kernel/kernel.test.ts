import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  commitMemory,
  confirmMemory,
  listMemoryLibrary,
  restoreMemory,
  revokeMemory,
} from "./gateway.js";
import { resetMemoryImportCache } from "./migrate.js";
import { formatExplicitPrecedentRecall, formatKernelMemoryForPrompt } from "./query.js";
import { replaceMemoryRecord } from "./store.js";

const dirs: string[] = [];

function workspace(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lm-memory-kernel-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  resetMemoryImportCache();
  for (const dir of dirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("memory kernel", () => {
  it("确认新的单槽写法后，旧句不再进入提示词", () => {
    const ws = workspace();
    commitMemory(ws, {
      kind: "habit",
      scope: "lawyer",
      key: "habit.voice",
      body: "付款期限写三十日整",
      origin: "lawyer",
      confirmNow: true,
    });
    commitMemory(ws, {
      kind: "habit",
      scope: "lawyer",
      key: "habit.voice",
      body: "付款期限写四十五日整",
      origin: "lawyer",
      confirmNow: true,
    });
    commitMemory(ws, {
      kind: "habit",
      scope: "lawyer",
      key: "habit.review",
      body: "待确认的句子禁止写仲裁",
      origin: "review",
      confirmNow: false,
    });
    const prompt = formatKernelMemoryForPrompt(ws, { query: "这份合同的付款期限怎么写" });
    expect(prompt).toContain("四十五日整");
    expect(prompt).not.toContain("三十日整");
    expect(prompt).not.toContain("禁止写仲裁");
    const revoked = listMemoryLibrary(ws, "revoked");
    expect(revoked.some((row) => row.body.includes("三十日整"))).toBe(true);
  });

  it("对立当事人的旧案事实和立场不进入本案提示词", () => {
    const ws = workspace();
    fs.mkdirSync(path.join(ws, "cases", "case-b"), { recursive: true });
    fs.writeFileSync(
      path.join(ws, "cases", "case-b", "CASE.md"),
      [
        "# 案",
        "",
        "## 1. 基本信息",
        "",
        "- 客户 / clientId：客户乙",
        "- 对方当事人：客户甲",
        "",
      ].join("\n"),
      "utf8",
    );
    fs.mkdirSync(path.join(ws, "cases", "case-a"), { recursive: true });
    fs.writeFileSync(
      path.join(ws, "cases", "case-a", "CASE.md"),
      [
        "# 旧案",
        "",
        "## 1. 基本信息",
        "",
        "- 诉讼地位：甲方",
        "",
        "## 2. 当事人",
        "",
        "- 甲方: 客户甲",
        "- 乙方: 客户乙",
        "",
        "## 7. 风险",
        "",
        "- 对立旧案赔偿上限壹佰万元整",
        "",
      ].join("\n"),
      "utf8",
    );
    fs.mkdirSync(path.join(ws, "cases", "case-c"), { recursive: true });
    fs.writeFileSync(
      path.join(ws, "cases", "case-c", "CASE.md"),
      [
        "# 可参照",
        "",
        "## 1. 基本信息",
        "",
        "- 诉讼地位：甲方",
        "",
        "## 2. 当事人",
        "",
        "- 甲方: 客户丙",
        "- 乙方: 客户丁",
        "",
        "## 7. 风险",
        "",
        "- 可参照旧案赔偿上限贰万元整",
        "",
      ].join("\n"),
      "utf8",
    );
    commitMemory(ws, {
      kind: "stance",
      scope: "lawyer",
      key: "stance.赔偿",
      body: "立场句赔偿上限壹佰万元整",
      origin: "lawyer",
      clientId: "客户甲",
      counterparty: "客户乙",
      evidenceMatterIds: ["case-a", "case-old"],
      confidence: 0.8,
      confirmNow: true,
    });
    const prompt = formatKernelMemoryForPrompt(ws, {
      matterId: "case-b",
      query: "赔偿上限怎么写",
    });
    expect(prompt).not.toContain("壹佰万元整");
    const named = formatExplicitPrecedentRecall(ws, {
      matterId: "case-b",
      precedentMatterIds: ["case-a", "case-c"],
      query: "赔偿",
    });
    expect(named).not.toContain("壹佰万元整");
    expect(named).toContain("贰万元整");
    expect(named).not.toContain("立场句");
  });

  it("取代或撤回后，律师档案热区不再留着这句", async () => {
    const ws = workspace();
    const first = commitMemory(ws, {
      kind: "habit",
      scope: "lawyer",
      key: "habit.review",
      body: "付款期限写三十日整",
      origin: "lawyer",
      confirmNow: false,
    });
    await confirmMemory(ws, first.id, { key: "habit.voice", scope: "lawyer" });
    const second = commitMemory(ws, {
      kind: "habit",
      scope: "lawyer",
      key: "habit.review",
      body: "付款期限写四十五日整",
      origin: "review",
      confirmNow: false,
    });
    await confirmMemory(ws, second.id, { key: "habit.voice", scope: "lawyer" });
    const afterSupersede = fs.readFileSync(path.join(ws, "LAWYER_PROFILE.md"), "utf8");
    expect(afterSupersede).toContain("四十五日整");
    expect(afterSupersede).not.toContain("三十日整");
    revokeMemory(ws, second.id);
    const afterRevoke = fs.readFileSync(path.join(ws, "LAWYER_PROFILE.md"), "utf8");
    expect(afterRevoke).not.toContain("四十五日整");
    expect(afterRevoke).not.toContain("三十日整");
    expect(listMemoryLibrary(ws, "revoked").some((row) => row.body.includes("四十五日整"))).toBe(
      true,
    );
    await restoreMemory(ws, second.id);
    const restored = fs.readFileSync(path.join(ws, "LAWYER_PROFILE.md"), "utf8");
    expect(restored).toContain("四十五日整");
    expect(restored).not.toContain("三十日整");
    expect(formatKernelMemoryForPrompt(ws, { query: "付款期限" })).toContain("四十五日整");
  });

  it("把已撤回的句子再写进档案后，会重新生效", () => {
    const ws = workspace();
    const row = commitMemory(ws, {
      kind: "habit",
      scope: "lawyer",
      key: "habit.voice",
      body: "付款期限写三十日整",
      origin: "lawyer",
      confirmNow: true,
    });
    fs.writeFileSync(
      path.join(ws, "LAWYER_PROFILE.md"),
      "# 律师\n\n## 八、个人积累\n\n- 付款期限写三十日整\n",
      "utf8",
    );
    revokeMemory(ws, row.id);
    fs.writeFileSync(
      path.join(ws, "LAWYER_PROFILE.md"),
      "# 律师\n\n## 八、个人积累\n\n- 付款期限写三十日整\n",
      "utf8",
    );
    const prompt = formatKernelMemoryForPrompt(ws, { query: "付款期限" });
    expect(prompt).toContain("三十日整");
    expect(fs.readFileSync(path.join(ws, "LAWYER_PROFILE.md"), "utf8")).toContain("三十日整");
  });

  it("撤回后从有效列表消失，确认才从待确认变成有效", async () => {
    const ws = workspace();
    const pending = commitMemory(ws, {
      kind: "habit",
      scope: "lawyer",
      key: "habit.format",
      body: "摘要先写结论",
      origin: "lawyer",
      confirmNow: false,
    });
    expect(formatKernelMemoryForPrompt(ws, { query: "摘要" })).not.toContain("先写结论");
    const confirmed = await confirmMemory(ws, pending.id);
    expect(confirmed?.confirmation).toBe("confirmed");
    expect(formatKernelMemoryForPrompt(ws, { query: "摘要" })).toContain("先写结论");
    revokeMemory(ws, pending.id);
    expect(formatKernelMemoryForPrompt(ws, { query: "摘要" })).not.toContain("先写结论");
    expect(listMemoryLibrary(ws, "revoked").some((row) => row.id === pending.id)).toBe(true);
  });

  it("档案后写入的句子，下一次导入会进入有效记忆", () => {
    const ws = workspace();
    fs.writeFileSync(path.join(ws, "LAWYER_PROFILE.md"), "# 律师\n\n## 八、个人积累\n\n", "utf8");
    expect(formatKernelMemoryForPrompt(ws, { query: "付款" })).not.toContain("四十五日");
    fs.writeFileSync(
      path.join(ws, "LAWYER_PROFILE.md"),
      "# 律师\n\n## 八、个人积累\n\n- 付款期限写四十五日整\n",
      "utf8",
    );
    const prompt = formatKernelMemoryForPrompt(ws, { query: "付款期限" });
    expect(prompt).toContain("四十五日整");
  });

  it("确认时改成写法槽，会替换同槽旧句，并可只限本案", async () => {
    const ws = workspace();
    commitMemory(ws, {
      kind: "habit",
      scope: "lawyer",
      key: "habit.voice",
      body: "语气保持克制旧口径",
      origin: "lawyer",
      confirmNow: true,
    });
    const pending = commitMemory(ws, {
      kind: "habit",
      scope: "lawyer",
      key: "habit.review",
      body: "语气改为更克制新口径",
      origin: "review",
      sourceMatterId: "case-b",
      confirmNow: false,
    });
    await confirmMemory(ws, pending.id, { key: "habit.voice", scope: "lawyer" });
    const globalPrompt = formatKernelMemoryForPrompt(ws, { query: "语气" });
    expect(globalPrompt).toContain("新口径");
    expect(globalPrompt).not.toContain("旧口径");

    const local = commitMemory(ws, {
      kind: "habit",
      scope: "lawyer",
      key: "habit.review",
      body: "这单付款写六十日整",
      origin: "review",
      sourceMatterId: "case-b",
      confirmNow: false,
    });
    await confirmMemory(ws, local.id, { scope: "matter", scopeId: "case-b" });
    expect(formatKernelMemoryForPrompt(ws, { query: "付款", matterId: "case-a" })).not.toContain(
      "六十日整",
    );
    expect(formatKernelMemoryForPrompt(ws, { query: "付款", matterId: "case-b" })).toContain(
      "六十日整",
    );
  });

  it("审核来的待确认，不改范围就只留在来源案件", async () => {
    const ws = workspace();
    const pending = commitMemory(ws, {
      kind: "habit",
      scope: "lawyer",
      key: "habit.review",
      body: "这单把付款放宽到九十日整",
      origin: "review",
      sourceMatterId: "case-b",
      confirmNow: false,
    });
    await confirmMemory(ws, pending.id);
    expect(formatKernelMemoryForPrompt(ws, { query: "付款" })).not.toContain("九十日整");
    expect(formatKernelMemoryForPrompt(ws, { query: "付款", matterId: "case-b" })).toContain(
      "九十日整",
    );
    expect(formatKernelMemoryForPrompt(ws, { query: "付款", matterId: "case-a" })).not.toContain(
      "九十日整",
    );
  });

  it("问风险时能召回没写风险二字的本案风险句", () => {
    const ws = workspace();
    commitMemory(ws, {
      kind: "matter_fact",
      scope: "matter",
      scopeId: "case-b",
      key: "matter.risk",
      body: "逾期利息按日万分之五",
      origin: "engine",
      sourceMatterId: "case-b",
      confirmNow: true,
    });
    const prompt = formatKernelMemoryForPrompt(ws, {
      query: "这份协议的风险在哪",
      matterId: "case-b",
    });
    expect(prompt).toContain("万分之五");
    expect(
      formatKernelMemoryForPrompt(ws, { query: "这份协议的风险在哪", matterId: "case-a" }),
    ).not.toContain("万分之五");
  });

  it("两个案件同一写法才生成待确认的通用习惯，不自动进提示词", async () => {
    const ws = workspace();
    const first = commitMemory(ws, {
      kind: "habit",
      scope: "matter",
      scopeId: "case-a",
      key: "habit.voice",
      body: "语气保持克制",
      origin: "lawyer",
      sourceMatterId: "case-a",
      confirmNow: false,
    });
    await confirmMemory(ws, first.id, { scope: "matter", scopeId: "case-a", key: "habit.voice" });
    expect(formatKernelMemoryForPrompt(ws, { query: "语气" })).not.toContain("语气保持克制");
    const second = commitMemory(ws, {
      kind: "habit",
      scope: "matter",
      scopeId: "case-b",
      key: "habit.voice",
      body: "语气保持克制",
      origin: "lawyer",
      sourceMatterId: "case-b",
      confirmNow: false,
    });
    await confirmMemory(ws, second.id, { scope: "matter", scopeId: "case-b", key: "habit.voice" });
    expect(formatKernelMemoryForPrompt(ws, { query: "语气" })).not.toContain("语气保持克制");
    const pending = listMemoryLibrary(ws, "habits").filter((row) => row.origin === "consolidation");
    expect(pending).toHaveLength(1);
    expect(pending[0]?.confirmation).toBe("pending");
    const different = commitMemory(ws, {
      kind: "habit",
      scope: "matter",
      scopeId: "case-c",
      key: "habit.voice",
      body: "语气可以更强",
      origin: "lawyer",
      sourceMatterId: "case-c",
      confirmNow: false,
    });
    await confirmMemory(ws, different.id, {
      scope: "matter",
      scopeId: "case-c",
      key: "habit.voice",
    });
    expect(
      listMemoryLibrary(ws, "habits").filter((row) => row.origin === "consolidation"),
    ).toHaveLength(1);
  });

  it("档案把旧句改成新句后，旧句不再进入提示词", () => {
    const ws = workspace();
    fs.writeFileSync(
      path.join(ws, "LAWYER_PROFILE.md"),
      "# 律师\n\n## 八、个人积累\n\n- 付款期限写三十日整\n",
      "utf8",
    );
    formatKernelMemoryForPrompt(ws, { query: "付款" });
    fs.writeFileSync(
      path.join(ws, "LAWYER_PROFILE.md"),
      "# 律师\n\n## 八、个人积累\n\n- 付款期限写四十五日整\n",
      "utf8",
    );
    const prompt = formatKernelMemoryForPrompt(ws, { query: "付款期限" });
    expect(prompt).toContain("四十五日整");
    expect(prompt).not.toContain("三十日整");
  });

  it("已取代的立场行不会被同步写回当前", () => {
    const ws = workspace();
    const first = commitMemory(ws, {
      kind: "stance",
      scope: "lawyer",
      key: "stance.付款",
      body: "付款期限写三十日整",
      origin: "stance",
      confirmNow: true,
    });
    commitMemory(ws, {
      kind: "stance",
      scope: "lawyer",
      key: "stance.付款",
      body: "付款期限写四十五日整",
      origin: "stance",
      confirmNow: true,
    });
    replaceMemoryRecord(ws, {
      id: first.id,
      kind: "stance",
      scope: "lawyer",
      key: "stance.付款",
      body: "付款期限写三十日整",
      confirmation: "confirmed",
      validity: "current",
      origin: "stance",
    });
    const current = listMemoryLibrary(ws, "habits").filter((row) => row.key === "stance.付款");
    expect(current.map((row) => row.body)).toEqual(["付款期限写四十五日整"]);
    expect(listMemoryLibrary(ws, "revoked").some((row) => row.id === first.id)).toBe(true);
  });
});
