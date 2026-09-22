/**
 * 结构守卫：**服务端手写 `res.writeHead(...)` 必须带上 CORS 头**。
 *
 * ## 为什么要有这道守卫
 *
 * 2026-09-22 真机故障：诊断包下载在界面上一直报「无法连接本地服务」，而服务端其实
 * 已经 200 并把 zip 写完了。根因是该路由手写 `writeHead` 时**漏了 `...c`**：
 *
 * ```ts
 * res.writeHead(200, { "content-type": "application/zip", "content-disposition": ... });  // ← 漏 ...c
 * ```
 *
 * 渲染层跑在 `http://127.0.0.1:5174`（打包后 `file://`），对本服务是**跨源**；
 * 响应缺 `access-control-allow-origin` → 浏览器在**几毫秒内**直接拦掉 → `Failed to fetch`。
 * 同路径的 JSON 预览正常（它走 `sendJson(..., c)` 会合并），所以症状看着像「服务时好时坏」，
 * 实际差别只在响应头。
 *
 * 手工审计发现了**两处**同类漏洞（诊断包 zip、审查表 xlsx），说明这不是一次手误，
 * 而是一个**容易重犯的坑**：手写响应头时忘了带上调度层给的 CORS 载体。
 * 因此用一条结构性断言把整类问题关掉 —— 新增路由时若忘了，测试直接红。
 *
 * ## 判据（宽松但足够）
 *
 * 每个 `res.writeHead(` 的头部参数区域必须出现下列之一：
 *   - `...c`（把调度层的 CORS 头展开进来）—— 绝大多数路由的做法
 *   - `...corsHeaders(...)`（自己现算，如限流兜底与本地服务入口）
 *   - `...extraHeaders`（`sendJson` 的实现，参数名不同）
 *   - 直接以 `c` 作为头部对象（`res.writeHead(204, c)`）
 *
 * 只做「有没有带」的存在性检查，不解析 AST —— 宁可粗一点，也不要为了精确而变脆。
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
const serverDir = here;

/** 允许的「带上了 CORS 载体」的写法。 */
const CORS_CARRIER = /\.\.\.c\b|\.\.\.corsHeaders|\.\.\.extraHeaders|writeHead\([^)]*,\s*c\s*\)/;

/**
 * 剥掉注释再做扫描。
 *
 * 这一步是**必需的**，不是洁癖：守卫第一版直接全文匹配，结果被**注释里的说明文字**
 * 骗过——`support.ts` 的注释写着「手写 writeHead 时不要漏 `...c`」，于是漏写 `...c`
 * 的代码照样通过（变异验证时抓到）。**守卫的字符串匹配必须只看代码。**
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

function serverSources(): string[] {
  return fs
    .readdirSync(serverDir)
    .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))
    .map((name) => path.join(serverDir, name));
}

/** 取出每个 `res.writeHead(` 到其配对的 `);` 之间的文本。 */
function writeHeadBlocks(source: string): Array<{ line: number; block: string }> {
  const out: Array<{ line: number; block: string }> = [];
  const marker = "res.writeHead(";
  let from = 0;
  for (;;) {
    const idx = source.indexOf(marker, from);
    if (idx < 0) {
      break;
    }
    const end = source.indexOf(");", idx);
    const block = end < 0 ? source.slice(idx) : source.slice(idx, end + 2);
    out.push({ line: source.slice(0, idx).split("\n").length, block });
    from = idx + marker.length;
  }
  return out;
}

describe("服务端 CORS 结构守卫", () => {
  it("每个手写 res.writeHead 都必须带上 CORS 载体（`...c` 等）", () => {
    const offenders: string[] = [];
    for (const file of serverSources()) {
      const source = stripComments(fs.readFileSync(file, "utf8"));
      for (const { line, block } of writeHeadBlocks(source)) {
        if (!CORS_CARRIER.test(block)) {
          offenders.push(`${path.basename(file)}:${line}`);
        }
      }
    }
    expect(
      offenders,
      "这些手写 writeHead 没带 CORS 头：渲染层跨源 fetch 会被浏览器直接拦掉" +
        "（界面报「无法连接本地服务」，而服务端其实已经 200）。加上 `...c` 即可。",
    ).toEqual([]);
  });

  it("守卫本身有效：漏写 `...c` 的样本必须被判为不合规（且注释里的 `...c` 不能算数）", () => {
    const bad = 'res.writeHead(200, { "content-type": "application/zip" });';
    const good = 'res.writeHead(200, { "content-type": "application/zip", ...c });';
    expect(CORS_CARRIER.test(bad)).toBe(false);
    expect(CORS_CARRIER.test(good)).toBe(true);
    expect(writeHeadBlocks(bad)).toHaveLength(1);

    // 这条是变异验证抓出来的真实假阴性：注释里写「不要漏 ...c」曾让漏写的代码通过。
    const badWithComment =
      '// 记住：手写 writeHead 不要漏 ...c\nres.writeHead(200, { "content-type": "application/zip" });';
    const stripped = stripComments(badWithComment);
    expect(writeHeadBlocks(stripped)[0]?.block ?? "").not.toMatch(CORS_CARRIER);
  });
});
