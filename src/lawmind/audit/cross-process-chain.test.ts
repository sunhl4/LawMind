import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  AUDIT_HASH_ALG_HMAC,
  resetAuditHashChainStateForTests,
  summarizeAuditIntegrity,
  type AuditEventWithIntegrity,
} from "./hash-chain.js";
import { verifyAuditFileWithAnchor } from "./root-anchor.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..", "..");

const tmpDirs: string[] = [];

afterEach(() => {
  resetAuditHashChainStateForTests();
  for (const d of tmpDirs.splice(0)) {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

/**
 * 双进程并发 emit 续链不分叉：两个真实 node 进程向同一 audit 目录写链上事件，
 * 依赖 emit 临界区的跨进程文件锁（stale 自愈）保证「读尾 → append → 外锚」原子。
 */
describe("audit hash chain across processes", () => {
  it("two concurrent processes extend one chain without forking", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lm-xproc-audit-"));
    tmpDirs.push(dir);
    const auditDir = path.join(dir, "audit");
    const keyHex = "ef".repeat(32);

    const emitEntry = pathToFileURL(
      path.join(repoRoot, "src", "lawmind", "audit", "index.ts"),
    ).href;
    const childScript = path.join(dir, "emit-child.ts");
    fs.writeFileSync(
      childScript,
      [
        `import { emit } from ${JSON.stringify(emitEntry)};`,
        "async function main() {",
        "  const [auditDir, prefix, countRaw] = process.argv.slice(2);",
        "  const count = Number(countRaw);",
        "  for (let i = 0; i < count; i++) {",
        '    await emit(auditDir, { taskId: `${prefix}-${i}`, kind: "task.created", actor: "system", integrityChain: true });',
        "  }",
        "}",
        "void main();",
        "",
      ].join("\n"),
      "utf8",
    );

    const perChild = 12;
    const runChild = (prefix: string) =>
      new Promise<void>((resolve, reject) => {
        const proc = spawn(
          process.execPath,
          ["--import", "tsx", childScript, auditDir, prefix, String(perChild)],
          {
            cwd: repoRoot,
            env: { ...process.env, LAWMIND_AUDIT_CHAIN_KEY: keyHex },
            stdio: ["ignore", "pipe", "pipe"],
          },
        );
        let stderr = "";
        proc.stderr.on("data", (d) => {
          stderr += String(d);
        });
        proc.on("exit", (code) => {
          if (code === 0) {
            resolve();
          } else {
            reject(new Error(`child ${prefix} exited ${code}: ${stderr.slice(-500)}`));
          }
        });
      });

    await Promise.all([runChild("a"), runChild("b")]);

    const key = Buffer.from(keyHex, "hex");
    const dayFiles = fs.readdirSync(auditDir).filter((n) => n.endsWith(".jsonl"));
    expect(dayFiles).toHaveLength(1);
    const dayFile = path.join(auditDir, dayFiles[0]);
    // 链序 = 文件行序（锁保证）；按行读而不是按 timestamp 排序。
    const events = fs
      .readFileSync(dayFile, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as AuditEventWithIntegrity);
    expect(events).toHaveLength(perChild * 2);
    expect(events.every((e) => e.hashAlg === AUDIT_HASH_ALG_HMAC)).toBe(true);

    const summary = summarizeAuditIntegrity(events, { key });
    expect(summary.ok).toBe(true);
    expect(summary.chainedCount).toBe(perChild * 2);

    const anchored = verifyAuditFileWithAnchor(dayFile, { key });
    expect(anchored.ok).toBe(true);
    expect(anchored.anchor?.rootHash).toBe(events[events.length - 1].eventHash);
  }, 90_000);
});
