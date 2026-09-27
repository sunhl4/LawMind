#!/usr/bin/env node
/**
 * 引擎出口测试不许 vi.stubGlobal("fetch")。
 * outbound-proxy 在没有 fetchImpl 时走 node:http（DNS 钉扎），全局 fetch mock 会被绕过，
 * 假端点变成真网络调用。改用 127.0.0.1 cassette，或给工厂传入 fetchImpl。
 * 见 docs/lawmind/manual/35-testing-practice.md §35.10。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const root = path.join(repoRoot, "src/lawmind");
const callRe = /vi\.stubGlobal\(\s*["']fetch["']/;

function walk(dir, out) {
  for (const name of fs.readdirSync(dir)) {
    const abs = path.join(dir, name);
    const stat = fs.statSync(abs);
    if (stat.isDirectory()) {
      walk(abs, out);
    } else if (name.endsWith(".test.ts") || name.endsWith(".test.tsx")) {
      out.push(abs);
    }
  }
}

const files = [];
walk(root, files);
const hits = [];
for (const file of files) {
  const lines = fs.readFileSync(file, "utf8").split("\n");
  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) {
      return;
    }
    if (callRe.test(line)) {
      hits.push(`${path.relative(repoRoot, file)}:${index + 1}`);
    }
  });
}

if (hits.length > 0) {
  console.error("引擎测试仍在 stub 全局 fetch（出口代理会绕过它，假端点变成真网络）：");
  for (const hit of hits) {
    console.error(`  ${hit}`);
  }
  console.error("改用 127.0.0.1 cassette，或给工厂传入 fetchImpl。");
  process.exit(1);
}

console.log(`[no-global-fetch-stub] ok (${files.length} engine test files)`);
