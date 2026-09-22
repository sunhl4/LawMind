import fs from "node:fs";
import path from "node:path";
import {
  buildMultitaskObservabilityReport,
  multitaskObservabilityToMarkdown,
  type MultitaskObservabilityReport,
} from "../../src/lawmind/ops/multitask-observability.js";

type CliOptions = {
  workspaceDir: string;
  outDir: string;
  windowDays: number;
};

function parseArgs(argv: string[]): CliOptions {
  let workspaceDir = process.env.LAWMIND_WORKSPACE_DIR ?? path.join(process.cwd(), "workspace");
  let outDir = path.join(process.cwd(), "dist", "lawmind", "multitask-validation");
  let windowDays = 14;

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--") {
      continue;
    }
    if (token === "--help") {
      console.log(
        "Usage: node --import tsx scripts/lawmind/lawmind-multitask-observability.ts [--workspace-dir <path>] [--out-dir <path>] [--window-days <days>]",
      );
      process.exit(0);
    }
    if (token !== "--workspace-dir" && token !== "--out-dir" && token !== "--window-days") {
      throw new Error(`unknown argument: ${token}`);
    }
    const value = argv[i + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`missing value for ${token}`);
    }
    if (token === "--workspace-dir") {
      workspaceDir = path.resolve(process.cwd(), value);
    } else if (token === "--out-dir") {
      outDir = path.resolve(process.cwd(), value);
    } else {
      const parsedWindowDays = Number(value);
      if (!Number.isFinite(parsedWindowDays) || parsedWindowDays <= 0) {
        throw new Error(`invalid --window-days value: ${value}`);
      }
      windowDays = parsedWindowDays;
    }
    i += 1;
  }

  return { workspaceDir, outDir, windowDays };
}

function writeReport(
  outDir: string,
  report: MultitaskObservabilityReport,
): { jsonPath: string; mdPath: string } {
  fs.mkdirSync(outDir, { recursive: true });
  const stamp = report.runAt.replace(/[:.]/g, "-");
  const jsonPath = path.join(outDir, `observability-${stamp}.json`);
  const mdPath = path.join(outDir, `observability-${stamp}.md`);
  fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  fs.writeFileSync(mdPath, multitaskObservabilityToMarkdown(report), "utf8");
  return { jsonPath, mdPath };
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const report = buildMultitaskObservabilityReport({
    workspaceDir: opts.workspaceDir,
    windowDays: opts.windowDays,
    validationDistDir: opts.outDir,
  });
  const output = writeReport(opts.outDir, report);
  console.log("[Multitask Observability] report written:");
  console.log(`- ${output.jsonPath}`);
  console.log(`- ${output.mdPath}`);
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[Multitask Observability] failed: ${message}`);
  process.exitCode = 1;
}
