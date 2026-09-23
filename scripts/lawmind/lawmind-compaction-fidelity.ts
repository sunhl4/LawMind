#!/usr/bin/env node
/**
 * 压缩保真度基准 CLI。
 *
 *   pnpm lawmind:compaction-fidelity                 # 打印一页纸报告
 *   pnpm lawmind:compaction-fidelity -- --json       # 机器可读（供 CI / 趋势）
 *   pnpm lawmind:compaction-fidelity -- --out dist/compaction-fidelity.md
 *   pnpm lawmind:compaction-fidelity -- --rounds 6   # 加压到 6 轮
 *
 * 退出码：critical 事实有丢失 → 1（可用于 CI 门禁）。
 *
 * **这不是现场证据**：语料与金标均为自撰合成（见 `compaction-fidelity-cases.ts`）。
 * 真实评测集需要律师在真案上标注「必需存活的事实」。
 */

import fs from "node:fs";
import path from "node:path";
import {
  buildFidelityReportMarkdown,
  runAllCompactionFidelity,
} from "../../src/lawmind/evaluation/compaction-fidelity.js";

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const asJson = process.argv.includes("--json");
  const roundsRaw = argValue("--rounds");
  const rounds = roundsRaw ? Number.parseInt(roundsRaw, 10) : undefined;
  const out = argValue("--out");

  const reports = await runAllCompactionFidelity(
    typeof rounds === "number" && Number.isFinite(rounds) && rounds > 0 ? { rounds } : undefined,
  );

  const markdown = buildFidelityReportMarkdown(reports);
  const payload = { generatedAt: new Date().toISOString(), reports };

  if (out) {
    const target = path.resolve(out);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, `${markdown}\n`, "utf8");
    process.stdout.write(`[compaction-fidelity] 报告已写入 ${target}\n`);
  }

  process.stdout.write(`${asJson ? JSON.stringify(payload, null, 2) : markdown}\n`);

  const failed = reports.filter((r) => !r.passes);
  if (failed.length > 0) {
    process.stderr.write(
      `[compaction-fidelity] 未通过：${failed
        .map((r) => `${r.caseId}（关键事实丢失 ${r.critical.lost.join("、")}）`)
        .join("；")}\n`,
    );
    process.exitCode = 1;
  }
}

void main();
