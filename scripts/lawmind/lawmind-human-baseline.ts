/**
 * Human-baseline blind evaluation CLI.
 *
 * Prints PASS / FAIL / INSUFFICIENT / SKIP — honest skip when the fixture set is
 * absent, insufficient when fewer than 10 paired drafts exist. Never pretends a
 * small or missing set is a pass.
 *
 *   pnpm lawmind:human-baseline
 *   pnpm lawmind:human-baseline --write-rubric    # draft rubrics for new cases
 *   pnpm lawmind:human-baseline --write-blind     # anonymised A/B packets
 *   pnpm lawmind:human-baseline --workspace <dir>
 *
 * LAWMIND_REQUIRE_HUMAN_BASELINE=1 → non-zero exit unless status is pass
 * (nightly / local only; never the default CI gate).
 */

import path from "node:path";
import { runHumanBaseline } from "../../src/lawmind/evaluation/human-baseline.js";

const argv = process.argv.slice(2);
const writeRubric = argv.includes("--write-rubric");
const writeBlind = argv.includes("--write-blind");
let workspaceDir = path.resolve(process.cwd(), "workspace");
for (let i = 0; i < argv.length; i += 1) {
  if (argv[i] === "--workspace" && argv[i + 1]) {
    workspaceDir = path.resolve(process.cwd(), argv[i + 1]);
    i += 1;
  }
}

const require = ["1", "true", "yes"].includes(
  (process.env.LAWMIND_REQUIRE_HUMAN_BASELINE ?? "").trim().toLowerCase(),
);

const result = await runHumanBaseline({
  require,
  workspaceDir,
  writeRubricDrafts: writeRubric,
  writeBlindPackets: writeBlind,
});

console.log(result.report.reportZh);

if (result.report.cases > 0) {
  console.log("");
  console.log("同题双稿（确定性层，非盲评）：");
  for (const s of result.scores) {
    const tag =
      s.verdict === "lawmind_above" ? "本机更优" : s.verdict === "tie" ? "持平" : "律师更优";
    console.log(
      `  ${s.caseId} [${s.taskType}] ${tag}` +
        ` 覆盖 律师 ${Math.round(s.lawyer.weightedCoverage * 100)}% / 本机 ${Math.round(
          s.lawmind.weightedCoverage * 100,
        )}%` +
        (s.rubricIsDraft ? "（量规为草稿）" : ""),
    );
  }
}

if (result.report.skipped.length > 0) {
  console.log("");
  console.log("未纳入（夹具不完整）：");
  for (const s of result.report.skipped) {
    console.log(`  ${s.caseId}: ${s.reason}`);
  }
}

if (result.report.blind.labeled === 0 && result.report.status !== "skip") {
  console.log("");
  console.log(
    "盲评层待补：把匿名包（--write-blind 生成 blind-<caseId>.json）交给律师或独立评审模型，" +
      "在盲评标签里填 preferred（A / B / tie）。确定性层不能替代盲评。",
  );
}

process.exit(result.exitCode);
