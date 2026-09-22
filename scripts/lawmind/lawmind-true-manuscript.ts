/**
 * Print true-manuscript gate status. Honest skip when fixtures are absent.
 * LAWMIND_REQUIRE_TRUE_MANUSCRIPT=1 → non-zero exit on skip (nightly/local only).
 *
 * `--write-baseline`: draft `*.baseline.json` sidecars for newly dropped
 * manuscripts (never overwrites lawyer-confirmed ones).
 * `--workspace <dir>`: persist trend report to `<dir>/lawmind/metrics/`
 * (default: ./workspace) for the Doctor scorecard.
 */

import path from "node:path";
import {
  inspectTrueManuscriptGate,
  runTrueManuscriptGateCli,
  writeTrueManuscriptBaselineDrafts,
} from "../../src/lawmind/evaluation/true-manuscript-gate.js";

const argv = process.argv.slice(2);
const writeBaseline = argv.includes("--write-baseline");
let workspaceDir = path.resolve(process.cwd(), "workspace");
for (let i = 0; i < argv.length; i += 1) {
  if (argv[i] === "--workspace" && argv[i + 1]) {
    workspaceDir = path.resolve(process.cwd(), argv[i + 1]);
    i += 1;
  }
}

if (writeBaseline) {
  const gate = inspectTrueManuscriptGate();
  if (!gate.present) {
    console.log("SKIP: 真稿夹具未放入，无基线可生成。先放入脱敏 .docx / .doc / .pdf。");
    process.exit(0);
  }
  const { written, kept } = await writeTrueManuscriptBaselineDrafts(gate.dir);
  for (const name of written) {
    console.log(`DRAFT baseline: ${name}（请律师核对 mustContain / kind 后生效）`);
  }
  for (const name of kept) {
    console.log(`KEEP baseline: ${name}（已存在，未覆盖）`);
  }
  if (written.length === 0 && kept.length === 0) {
    console.log("没有可生成基线的真稿（形态检查未通过）。");
  }
}

const result = await runTrueManuscriptGateCli({ workspaceDir });
process.exit(result.exitCode);
