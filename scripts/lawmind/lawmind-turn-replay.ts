#!/usr/bin/env node
/**
 * Agent 回合回放：本机真实回合的干净交付率 / 停因 / 轮数 / 反弹收敛。
 *
 *   pnpm lawmind:turn-replay                     # 默认 workspace/
 *   pnpm lawmind:turn-replay -- --workspace <dir>
 *   pnpm lawmind:turn-replay -- --since 2026-10-01      # 当地 00:00 起
 *   pnpm lawmind:turn-replay -- --json --out dist/turn-replay.json
 *   pnpm lawmind:turn-replay -- --strict --min-turns 50
 *   pnpm lawmind:turn-replay -- --workspace <run-root> --scan
 *
 * 数据源：`<workspace>/sessions/*.turns.jsonl`（桌面端收口时追加的真实回合）。
 * 没有回合时打印 SKIP；`--strict` 需要显式 `--min-turns`，避免 CI 把「还没人用」当红灯。
 *
 * 这不是准入测试。准入是 `turn-orchestrator-cassettes.test.ts`（假模型、真循环）。
 * 本脚本回答的是产品问题：律师真实回合里，有多少干净交付、为什么停、反弹后能不能收敛。
 */

import fs from "node:fs";
import path from "node:path";
import {
  buildTurnReplayReportMarkdown,
  collectTurnReplayRows,
  discoverTurnWorkspaces,
  summarizeTurnReplay,
} from "../../src/lawmind/evaluation/turn-loop-replay.js";

const USAGE = [
  "用法: pnpm lawmind:turn-replay -- [--workspace <dir>]... [--scan]",
  "        [--since YYYY-MM-DD|ISO] [--json] [--out <file>]",
  "        [--strict --min-turns <n>]",
].join("\n");

function fail(message: string): never {
  console.error(`${message}\n${USAGE}`);
  process.exit(2);
}

/** Value for `--flag`; refuses to swallow the next flag as a value. */
function optionalValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  if (index < 0) {
    return undefined;
  }
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) {
    fail(`${flag} 缺少值`);
  }
  return value;
}

function main(): void {
  const asJson = process.argv.includes("--json");
  const strict = process.argv.includes("--strict");
  const scan = process.argv.includes("--scan");

  const workspaceArgs: string[] = [];
  for (let i = 0; i < process.argv.length; i += 1) {
    const arg = process.argv[i];
    if (arg === "--workspace" || arg === "--dir") {
      const value = process.argv[i + 1];
      if (!value || value.startsWith("--")) {
        fail(`${arg} 缺少值`);
      }
      workspaceArgs.push(value);
      i += 1;
    }
  }

  const minTurnsRaw = optionalValue("--min-turns");
  const minTurns = minTurnsRaw ? Number.parseInt(minTurnsRaw, 10) : undefined;
  if (minTurnsRaw !== undefined && (!Number.isFinite(minTurns) || (minTurns ?? 0) < 0)) {
    fail("--min-turns 需要非负整数");
  }
  if (strict && minTurns === undefined) {
    fail("--strict 需要同时给 --min-turns，否则不是质量门");
  }

  const workspaceDir = path.resolve(process.cwd(), workspaceArgs[0] ?? "workspace");
  const roots = workspaceArgs.map((dir) => path.resolve(process.cwd(), dir));
  if (scan) {
    const maxDirs = 2_000;
    for (const dir of roots.length > 0 ? [...roots] : [workspaceDir]) {
      const found = discoverTurnWorkspaces(dir, { maxDirs });
      if (found.length >= maxDirs) {
        console.error(`WARN: ${dir} 的目录扫描到达上限 ${maxDirs}，可能漏掉后面的 workspace。`);
      }
      roots.push(...found);
    }
  }
  const effectiveRoots = roots.length > 0 ? [...new Set(roots)] : [workspaceDir];

  const since = optionalValue("--since");
  const out = optionalValue("--out");

  const rows = collectTurnReplayRows(effectiveRoots, since ? { since } : undefined);
  if (rows.length === 0) {
    const message = `SKIP: ${path.join(workspaceDir, "sessions")} 下没有可回放的回合记录（需要真实律师回合，不用夹具冒充）。`;
    if (asJson) {
      console.log(
        JSON.stringify(
          { generatedAt: new Date().toISOString(), skipped: true, reason: message },
          null,
          2,
        ),
      );
    } else {
      console.log(message);
    }
    process.exit(strict ? 1 : 0);
  }

  const summary = summarizeTurnReplay(rows);
  if (asJson) {
    const payload = {
      generatedAt: new Date().toISOString(),
      workspaceDir,
      workspaces: effectiveRoots,
      ...(since ? { since } : {}),
      summary,
      rows,
    };
    if (out) {
      fs.mkdirSync(path.dirname(path.resolve(process.cwd(), out)), { recursive: true });
      fs.writeFileSync(path.resolve(process.cwd(), out), `${JSON.stringify(payload, null, 2)}\n`);
      console.log(`WROTE ${out}`);
    }
    console.log(JSON.stringify(summary, null, 2));
  } else {
    const markdown = buildTurnReplayReportMarkdown(summary);
    if (out) {
      fs.mkdirSync(path.dirname(path.resolve(process.cwd(), out)), { recursive: true });
      fs.writeFileSync(path.resolve(process.cwd(), out), markdown);
      console.log(`WROTE ${out}\n`);
    }
    console.log(markdown);
  }

  if (strict && rows.length < (minTurns ?? 0)) {
    console.error(`STRICT: 只有 ${rows.length} 个回合，少于要求的 ${minTurns}。`);
    process.exit(1);
  }
}

main();
