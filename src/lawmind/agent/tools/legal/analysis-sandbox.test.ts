/**
 * 代码执行沙箱的文件接口与围栏。
 *
 * 这轮补的三支笔（`listFiles` / `readText` / `writeText`）解决的是「写代码也干不成」：
 * 沙箱此前只能读表格三件套（xlsx/csv/json），列不了目录，也写不了文本——于是
 * 「把某文件夹里 200 份材料过一遍建清单」这类批量活儿无解。
 *
 * 同时把围栏收严（对齐 SECURITY.md）：工作区外、软链、治理数据都不许摸。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runAnalysisScriptInVm } from "./analysis-sandbox.js";

const dirs: string[] = [];

function tmp(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

async function run(workspaceDir: string, source: string) {
  return runAnalysisScriptInVm({ source, workspaceDir });
}

describe("analysis sandbox 批量整理材料（真实事故的 200 份材料场景）", () => {
  it("listFiles 递归列目录 + readText 逐个读 + writeText 落清单", async () => {
    const ws = tmp("lm-sbx-batch-");
    const materials = path.join(ws, "cases", "甲案", "materials");
    fs.mkdirSync(materials, { recursive: true });
    // 60 份，形状与那次事故一致（整包被收进来的子文件夹）。
    for (let i = 1; i <= 60; i += 1) {
      fs.mkdirSync(path.join(materials, "岚江公司"), { recursive: true });
      fs.writeFileSync(
        path.join(materials, "岚江公司", `材料${String(i).padStart(3, "0")}.txt`),
        `第 ${i} 份：违约金条款`,
        "utf8",
      );
    }
    // 点文件与软链必须被跳过。
    fs.writeFileSync(path.join(materials, ".DS_Store"), "junk", "utf8");

    const result = await run(
      ws,
      `
const listed = await listFiles("cases/甲案/materials", { recursive: true });
const files = listed.entries.filter((e) => e.kind === "file");
let hit = 0;
for (const f of files) {
  const text = await readText(f.path);
  if (text.includes("违约金")) hit += 1;
}
const index = files.map((f) => f.path).sort().join("\\n");
const written = await writeText("材料清单.txt", index);
return { fileCount: files.length, hit, written, truncated: listed.truncated };
`,
    );

    expect(result.value).toMatchObject({ fileCount: 60, hit: 60, truncated: false });
    const data = result.value as { written: { path: string; chars: number } };
    expect(data.written.path).toBe("artifacts/analysis/材料清单.txt");
    const writtenAbs = path.join(ws, data.written.path);
    expect(fs.existsSync(writtenAbs)).toBe(true);
    const lines = fs.readFileSync(writtenAbs, "utf8").trim().split("\n");
    expect(lines).toHaveLength(60);
    expect(lines[0]).toContain("材料001.txt");
    // 点文件不进清单。
    expect(fs.readFileSync(writtenAbs, "utf8")).not.toContain(".DS_Store");
    // files 也回传给调用方，便于落进在办。
    expect(result.files?.[0]?.path).toBe("artifacts/analysis/材料清单.txt");
  });

  it("listFiles 默认不递归；recursive 时按深度走（路径为工作区相对，可直接读）", async () => {
    const ws = tmp("lm-sbx-depth-");
    fs.mkdirSync(path.join(ws, "top", "sub"), { recursive: true });
    fs.writeFileSync(path.join(ws, "top", "a.txt"), "a", "utf8");
    fs.writeFileSync(path.join(ws, "top", "sub", "b.txt"), "b", "utf8");

    const shallow = await run(ws, `return (await listFiles("top")).entries.map((e) => e.path);`);
    expect(shallow.value).toEqual(["top/a.txt", "top/sub"]);

    const deep = await run(
      ws,
      `return (await listFiles("top", { recursive: true })).entries.map((e) => e.path);`,
    );
    expect(deep.value).toEqual(["top/a.txt", "top/sub", "top/sub/b.txt"]);
    // 列出来的路径能直接读。
    const read = await run(ws, `return await readText("top/sub/b.txt");`);
    expect(read.value).toBe("b");
  });

  it("listFiles 不给路径时列工作区根", async () => {
    const ws = tmp("lm-sbx-root-");
    fs.writeFileSync(path.join(ws, "x.txt"), "x", "utf8");
    const result = await run(ws, `return (await listFiles()).entries.map((e) => e.path);`);
    expect(result.value).toContain("x.txt");
  });
});

describe("analysis sandbox 围栏", () => {
  it("越出工作区的路径一律拒绝", async () => {
    const ws = tmp("lm-sbx-escape-");
    const outside = tmp("lm-sbx-outside-");
    fs.writeFileSync(path.join(outside, "secret.txt"), "secret", "utf8");

    for (const source of [
      `return await readText("../../etc/hosts");`,
      `return await readText("${path.join(outside, "secret.txt")}");`,
      `return await listFiles("${outside}");`,
      `return await writeText("${path.join(outside, "x.txt")}", "x");`,
    ]) {
      await expect(run(ws, source), source).rejects.toThrow();
    }
  });

  it("软链不跟：指向工作区外的软链读不到", async () => {
    const ws = tmp("lm-sbx-symlink-");
    const outside = tmp("lm-sbx-symlink-out-");
    fs.writeFileSync(path.join(outside, "secret.txt"), "secret", "utf8");
    fs.symlinkSync(path.join(outside, "secret.txt"), path.join(ws, "link.txt"));

    await expect(run(ws, `return await readText("link.txt");`)).rejects.toThrow();
    // 列目录时软链被跳过，不会把外面的名字漏出来。
    const listed = await run(ws, `return (await listFiles()).entries.map((e) => e.path);`);
    expect(listed.value).toEqual([]);
  });

  it("治理/真相源不进沙箱（tasks/、matters/、RULES.md、策略）", async () => {
    const ws = tmp("lm-sbx-governance-");
    fs.mkdirSync(path.join(ws, "matters", "甲案"), { recursive: true });
    fs.writeFileSync(path.join(ws, "matters", "甲案", "desk-writes.jsonl"), "{}\n", "utf8");
    fs.mkdirSync(path.join(ws, "tasks"), { recursive: true });
    fs.writeFileSync(path.join(ws, "tasks", "t1.json"), "{}", "utf8");
    fs.mkdirSync(path.join(ws, "cases", "甲案"), { recursive: true });
    fs.writeFileSync(path.join(ws, "cases", "甲案", "RULES.md"), "# 规则", "utf8");
    fs.writeFileSync(path.join(ws, "lawmind.policy.json"), "{}", "utf8");
    fs.mkdirSync(path.join(ws, "audit"), { recursive: true });
    fs.writeFileSync(path.join(ws, "audit", "x.jsonl"), "{}\n", "utf8");
    fs.mkdirSync(path.join(ws, "lawmind"), { recursive: true });
    fs.writeFileSync(path.join(ws, "lawmind", "settings.json"), "{}", "utf8");

    for (const rel of [
      "matters/甲案/desk-writes.jsonl",
      "tasks/t1.json",
      "cases/甲案/RULES.md",
      "lawmind.policy.json",
      "audit/x.jsonl",
      "lawmind/settings.json",
    ]) {
      await expect(
        run(ws, `return await readText(${JSON.stringify(rel)});`),
        rel,
      ).rejects.toThrow();
    }
  });

  it("writeText 的路径策略：只给文件名落 artifacts/analysis；越界响亮报错", async () => {
    const ws = tmp("lm-sbx-write-");
    fs.mkdirSync(path.join(ws, "cases", "甲案", "materials"), { recursive: true });
    const outside = tmp("lm-sbx-write-out-");

    // 只给文件名 → artifacts/analysis/
    const named = await run(ws, `return await writeText("清单.txt", "x");`);
    expect((named.value as { path: string }).path).toBe("artifacts/analysis/清单.txt");

    // 显式 artifacts/ 前缀 → 按原路径
    const explicit = await run(ws, `return await writeText("artifacts/分析/对照.txt", "x");`);
    expect((explicit.value as { path: string }).path).toBe("artifacts/分析/对照.txt");

    // 其它落点一律报错，不静默重定向。
    for (const target of [
      "cases/甲案/materials/想写这里.txt",
      "../outside.txt",
      path.join(outside, "x.txt"),
      "lawmind/审计.txt",
      "artifacts/analysis-scripts/evil.js",
    ]) {
      await expect(
        run(ws, `return await writeText(${JSON.stringify(target)}, "x");`),
        target,
      ).rejects.toThrow();
    }
    expect(fs.existsSync(path.join(ws, "cases", "甲案", "materials", "想写这里.txt"))).toBe(false);
    expect(fs.existsSync(path.join(outside, "x.txt"))).toBe(false);
    expect(fs.existsSync(path.join(ws, "artifacts", "analysis-scripts", "evil.js"))).toBe(false);
  });

  it("writeText 拒绝非法文件名与超大内容", async () => {
    const ws = tmp("lm-sbx-write-guard-");
    await expect(run(ws, `return await writeText(".env", "SECRET=1");`)).rejects.toThrow();
    await expect(run(ws, `return await writeText("", "x");`)).rejects.toThrow();
    await expect(
      run(ws, `return await writeText("大文件.txt", "x".repeat(2_000_001));`),
    ).rejects.toThrow();
  });

  it("readText 拒绝二进制、目录与超大文件", async () => {
    const ws = tmp("lm-sbx-readtext-");
    fs.writeFileSync(path.join(ws, "bin.dat"), Buffer.from([1, 0, 2, 0]), "utf8");
    fs.mkdirSync(path.join(ws, "artifacts"), { recursive: true });
    fs.writeFileSync(path.join(ws, "artifacts", "big.txt"), "x".repeat(200_001), "utf8");

    await expect(run(ws, `return await readText("bin.dat");`)).rejects.toThrow();
    await expect(run(ws, `return await readText("artifacts");`)).rejects.toThrow();
    await expect(run(ws, `return await readText("artifacts/big.txt");`)).rejects.toThrow();
    // 正常文本读得到。
    fs.writeFileSync(path.join(ws, "ok.txt"), "正常内容", "utf8");
    const ok = await run(ws, `return await readText("ok.txt");`);
    expect(ok.value).toBe("正常内容");
  });

  it("脚本仍不能碰 fs/require/process（沙箱语言面没放宽）", async () => {
    const ws = tmp("lm-sbx-lang-");
    for (const source of [
      `const fs = require("node:fs"); return 1;`,
      `return typeof process;`,
      `return await fetch("https://example.com");`,
      `return eval("1+1");`,
    ]) {
      await expect(run(ws, source), source).rejects.toThrow();
    }
  });
});
