#!/usr/bin/env node
/**
 * 因子账本 CLI。
 *
 *   pnpm lawmind:factor-ledger -- --session <id>
 *   pnpm lawmind:factor-ledger -- --matter <id> [--workspace <dir>] [--json]
 *   pnpm lawmind:factor-ledger -- --session <id> --limit 200
 *
 * 只读：打印账本路径与聚合指标，不改账本、不跑模型。
 * 账本正文用 `--json`；默认只打印一页纸摘要。
 */

import path from "node:path";
import {
  factorLedgerPath,
  readFactorLedgerRecords,
} from "../../src/lawmind/adapters/factor-ledger/index.js";
import {
  renderFactorLedgerDigest,
  summarizeFactorLedger,
} from "../../src/lawmind/agent/factor-metrics.js";

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(2);
}

function main(): void {
  const sessionId = argValue("--session")?.trim();
  const matterId = argValue("--matter")?.trim();
  if (!sessionId && !matterId) {
    fail(
      "用法：pnpm lawmind:factor-ledger -- (--session <id> | --matter <id>) [--workspace <dir>] [--json] [--limit N]",
    );
  }
  const workspaceDir = path.resolve(
    argValue("--workspace") ??
      process.env.LAWMIND_WORKSPACE_DIR?.trim() ??
      path.join(process.cwd(), "workspace"),
  );
  const limitRaw = argValue("--limit");
  const limit = limitRaw ? Number.parseInt(limitRaw, 10) : undefined;
  const scope = {
    ...(sessionId ? { sessionId } : {}),
    ...(matterId ? { matterId } : {}),
  };
  const records = readFactorLedgerRecords(
    workspaceDir,
    scope,
    limit !== undefined && Number.isFinite(limit) && limit > 0 ? { limit } : {},
  );
  const digest = summarizeFactorLedger(records);
  if (process.argv.includes("--json")) {
    process.stdout.write(
      `${JSON.stringify({ workspaceDir, scope, ledger: factorLedgerPath(workspaceDir, scope), digest }, null, 2)}\n`,
    );
    return;
  }
  const lines = [
    `账本：${factorLedgerPath(workspaceDir, scope)}`,
    renderFactorLedgerDigest(digest),
  ];
  process.stdout.write(`${lines.join("\n")}\n`);
}

main();
