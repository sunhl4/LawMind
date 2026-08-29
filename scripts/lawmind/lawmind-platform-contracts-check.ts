import fs from "node:fs";
import path from "node:path";

const REQUIRED_SYMBOLS = [
  "TaskExecutionState",
  "ExecutionState",
  "GateDecision",
  "GateDecisionKind",
  "GateCategory",
];

const REQUIRED_HEALTH_DOCTOR_FIELDS = [
  "matterConsistency",
  "rateLimit",
  "skipApiAuthWarn",
  "judgmentHardControls",
];

function main(): void {
  const repoRoot = process.cwd();
  const contractsTs = path.join(repoRoot, "src/lawmind/platform/contracts.ts");
  const contractsMd = path.join(repoRoot, "docs/lawmind/LAWMIND-PLATFORM-CONTRACTS.md");
  if (!fs.existsSync(contractsTs) || !fs.existsSync(contractsMd)) {
    throw new Error("platform contracts files missing");
  }
  const ts = fs.readFileSync(contractsTs, "utf8");
  const md = fs.readFileSync(contractsMd, "utf8");
  const missing: string[] = [];
  for (const symbol of REQUIRED_SYMBOLS) {
    if (!ts.includes(symbol)) {
      missing.push(`contracts.ts missing ${symbol}`);
    }
    if (!md.includes(symbol)) {
      missing.push(`LAWMIND-PLATFORM-CONTRACTS.md missing ${symbol}`);
    }
  }
  if (missing.length > 0) {
    throw new Error(missing.join("; "));
  }
  for (const field of REQUIRED_HEALTH_DOCTOR_FIELDS) {
    if (!md.includes(field)) {
      missing.push(`LAWMIND-PLATFORM-CONTRACTS.md missing health doctor field ${field}`);
    }
  }
  if (missing.length > 0) {
    throw new Error(missing.join("; "));
  }
  console.log("[platform-contracts] ok");
}

main();
