#!/usr/bin/env node
/**
 * LawMind 律师 UI 文案 lint：扫描桌面 renderer 的用户可见文案，
 * 拦截文件路径与工程师术语回潮（律师主路径只剩律师语言）。
 *
 * - 扫描 apps/lawmind-desktop/src/renderer/** 的 .ts/.tsx（默认排除 *.test.*）
 * - 明显非展示上下文不计：import/export 行、注释行、含 /api/ 的路由行
 * - 存量合法用例见 scripts/lawmind/ui-copy-lint-allowlist.json
 *   （条目：{ file, pattern, lineIncludes?, reason }；file 为仓库根相对路径）
 * - 退出码：存在未豁免命中 = 1；豁免条目失效仅告警
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const RENDERER_DIR = path.join(repoRoot, "apps/lawmind-desktop/src/renderer");
const ALLOWLIST_PATH = path.join(repoRoot, "scripts/lawmind/ui-copy-lint-allowlist.json");

const BANNED_PATTERNS = [
  { id: "path.assistants-dir", re: /assistants\//, note: "助手档案目录路径（assistants/…）" },
  { id: "path.profile-md", re: /[A-Za-z_]*PROFILE\.md/, note: "档案文件名（*PROFILE.md）" },
  { id: "path.memory-md", re: /\bMEMORY\.md\b/, note: "记忆文件名 MEMORY.md" },
  { id: "path.rules-md", re: /\bRULES\.md\b/, note: "规则文件名 RULES.md" },
  { id: "path.case-md", re: /\bCASE\.md\b/, note: "案件档案文件名 CASE.md" },
  {
    id: "path.workspace-md-rel",
    re: /\b(?:drafts|cases|matters|workspace)\/[\w.%-]*\.md\b/,
    note: "工作区相对路径（drafts/…、cases/… 等 *.md）",
  },
  { id: "term.agent-output", re: /产出\s*Agent/, note: "「产出 Agent」工程师表述" },
  { id: "term.reasoning-graph-coverage", re: /推理图覆盖率/, note: "内部指标术语「推理图覆盖率」" },
  { id: "term.sidecar", re: /侧车/, note: "sidecar「侧车」工程师黑话" },
  {
    id: "term.prompt-inject",
    re: /已注入|未注入|始终注入|注入记忆/,
    note: "提示词「注入」机制词（改用「已记住/已写入」类律师语言）",
  },
  { id: "term.system-prompt", re: /\bsystem\s+prompt\b/i, note: "「system prompt」工程师术语" },
  {
    id: "term.gate",
    re: /门禁/,
    note: "工程师门禁术语（对律师面改用「核对/检查」）",
  },
  {
    id: "term.reasoning-graph",
    re: /推理图/,
    note: "工程师推理图术语（对律师面改用「法律分析」）",
  },
  {
    id: "term.gate-failure",
    re: /gate\s+失败/,
    note: "工程师 gate 失败（改用「核对失败」）",
  },
];

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walk(full));
    } else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.(ts|tsx)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

/** 明显非用户可见的行：模块导入导出、注释、API 路由串。 */
function isSuppressedLine(line) {
  const t = line.trim();
  if (/^(import|export)\s/.test(t)) {
    return true;
  }
  if (/^(\/\/|\/\*|\*)/.test(t)) {
    return true;
  }
  return t.includes("/api/");
}

function loadAllowlist() {
  if (!fs.existsSync(ALLOWLIST_PATH)) {
    return [];
  }
  const parsed = JSON.parse(fs.readFileSync(ALLOWLIST_PATH, "utf8"));
  return Array.isArray(parsed.entries) ? parsed.entries : [];
}

function isExempted(allowlist, finding) {
  return allowlist.some(
    (entry) =>
      entry.file === finding.file &&
      entry.pattern === finding.pattern &&
      (entry.lineIncludes === undefined || finding.lineText.includes(entry.lineIncludes)),
  );
}

function main() {
  const allowlist = loadAllowlist();
  const files = walk(RENDERER_DIR).toSorted();
  const findings = [];
  const exempted = [];

  for (const file of files) {
    const rel = path.relative(repoRoot, file);
    const lines = fs.readFileSync(file, "utf8").split("\n");
    lines.forEach((line, idx) => {
      if (isSuppressedLine(line)) {
        return;
      }
      for (const { id, re, note } of BANNED_PATTERNS) {
        if (!re.test(line)) {
          continue;
        }
        const finding = {
          file: rel,
          line: idx + 1,
          pattern: id,
          note,
          lineText: line.trim(),
        };
        if (isExempted(allowlist, finding)) {
          exempted.push(finding);
        } else {
          findings.push(finding);
        }
      }
    });
  }

  const stale = allowlist.filter(
    (entry) => !exempted.some((f) => f.file === entry.file && f.pattern === entry.pattern),
  );

  for (const f of findings) {
    console.error(`✗ ${f.file}:${f.line}  [${f.pattern}] ${f.note}`);
    console.error(`    ${f.lineText}`);
  }
  if (stale.length > 0) {
    console.warn("! 以下豁免条目已失效（对应文案已不存在），请顺手移除：");
    for (const entry of stale) {
      console.warn(`    ${entry.file}  [${entry.pattern}]`);
    }
  }
  console.log(
    `ui-copy-lint: 扫描 ${files.length} 个文件，未豁免命中 ${findings.length} 处，豁免 ${exempted.length} 处。`,
  );
  if (findings.length > 0) {
    console.error(
      "律师可见文案命中禁词；请改用律师语言，或在 ui-copy-lint-allowlist.json 登记豁免理由。",
    );
    process.exit(1);
  }
}

main();
