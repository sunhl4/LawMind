#!/usr/bin/env node
/**
 * LawMind 律师 UI 文案 lint：扫描桌面 renderer 的用户可见文案，
 * 拦截文件路径、工程师术语与**近义词**回潮（律师主路径只剩律师语言）。
 *
 * - 扫描 apps/lawmind-desktop/src/renderer/** 的 .ts/.tsx（默认排除 *.test.*）
 * - 明显非展示上下文不计：import/export 行、注释行、含 /api/ 的路由行
 * - 存量合法用例见 scripts/lawmind/ui-copy-lint-allowlist.json
 *   （条目：{ file, pattern, lineIncludes?, reason }；file 为仓库根相对路径）
 * - 两档执法（术语表「一动作一词」的两类禁词，见 docs/LAWMIND-TERMINOLOGY.md）：
 *   1. `BANNED_PATTERNS`：硬拦截。命中即退出码 1，新文案不得引入。
 *   2. `SYNONYM_PATTERNS`：棘轮（ratchet）。律师用词的同义近义词存量还在收敛，
 *      计数冻结在 ui-copy-lint-synonym-baseline.json；**新增**即失败，降下来用 --update 收紧地板。
 *   硬拦档只放「存量已归零」的词；还有存量的近义词一律先走棘轮，不许为了绿灯破地板。
 * - 退出码：硬拦档存在未豁免命中、或棘轮档任一项超过基线 = 1；豁免/基线条目失效仅告警
 *
 *   node scripts/lawmind/lawmind-ui-copy-lint.mjs
 *   node scripts/lawmind/lawmind-ui-copy-lint.mjs --update   # 收敛后收紧棘轮地板
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const RENDERER_DIR = path.join(repoRoot, "apps/lawmind-desktop/src/renderer");
const ALLOWLIST_PATH = path.join(repoRoot, "scripts/lawmind/ui-copy-lint-allowlist.json");
const SYNONYM_BASELINE_PATH = path.join(
  repoRoot,
  "scripts/lawmind/ui-copy-lint-synonym-baseline.json",
);

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
  // ── 近义词硬拦档：以下词的 renderer 存量已归零（2026-09 实测；文书台于 2026-09-25 归零），
  //    一经引入即失败，不许再退回同义词并存。见 docs/LAWMIND-TERMINOLOGY.md。
  { id: "term.chuhuo", re: /出货/, note: "「出货」→ 交付" },
  { id: "term.paiguan", re: /派单|下单/, note: "「派单 / 下单」→ 交办" },
  { id: "term.jianchadian", re: /检查点/, note: "「检查点」→ 必核清单" },
  { id: "term.quanpan-scan", re: /全盘扫描/, note: "「全盘扫描」→ 本机查找" },
  { id: "term.daiban-center", re: /待办中心/, note: "「待办中心」→ 待我拍板 / 在办" },
  { id: "term.shenpi-center", re: /审批中心/, note: "「审批中心」→ 待我拍板" },
  { id: "term.biaozhun", re: /批稿/, note: "「批稿」→ 改稿" },
  { id: "term.ai-employee", re: /AI\s*员工|机器人/, note: "「AI 员工 / 机器人」→ 助手" },
  { id: "term.context-file", re: /上下文文件/, note: "「上下文文件」→ 材料" },
  {
    id: "term.zhinengti",
    re: /智能体/,
    note: "「智能体」→ 助手（设置搜索同义词属合法用例，登记在 allowlist）",
  },
  {
    id: "term.wenshutai",
    re: /文书台/,
    note: "「文书台」→ 改稿（Solo / Firm 统一；历史动作日志解析见 allowlist）",
  },
  {
    id: "term.fuhe",
    re: /复核/,
    note: "「复核」→ 审核（落盘前缀在引擎里，界面不得再写）",
  },
];

/**
 * 近义词棘轮档：律师用词的同义近义词，存量仍在校准（见第 32 章「现状与收敛」）。
 * 计数冻结在 ui-copy-lint-synonym-baseline.json：新增即失败，收敛后用 --update 下调地板。
 *
 * 正则里已排除「术语表明确保留」的合法用例，别把保留用法再写进基线：
 * - 批准：`已批准` 是合法的签批结果状态（approve → 已批准），故用否定后顾排除。
 * - 修订：`已修订`（reviewStatus=modified 状态）、`合同修订稿 / 修订版`（对方来稿）、
 *   `修订记录`（侧车文件对律师的说法）合法；只有「修订」作我们自己的动作时才用「改稿」。
 */
const SYNONYM_PATTERNS = [
  { id: "syn.daiban", re: /待办/, note: "「待办」→ 在办（作栏目/入口名时）" },
  { id: "syn.shenpi", re: /审批/, note: "「审批」→ 签批 / 待我拍板" },
  { id: "syn.pizhun", re: /(?<!已)批准/, note: "「批准」作动词 → 签批（「已批准」状态保留）" },
  {
    id: "syn.xiuding",
    re: /(?<!已|合同)修订(?!记录|版|稿)/,
    note: "「修订」作自己的动作 → 改稿（「已修订/合同修订稿/修订记录」保留）",
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

/**
 * 明显非用户可见的行：模块导入、注释、API 路由串。
 *
 * 例外：`export const LABEL = "复核"` 这类**单行导出的字符串常量**是真实文案载体，
 * 不能当「非展示上下文」放过——否则一句 `export const X = "复核"` 就能绕过整张禁词表。
 * 只放开这一种形状（`export const/let/var NAME = "字面量"`），其余 export 行照旧跳过。
 */
function isSuppressedLine(line) {
  const t = line.trim();
  if (/^import\s/.test(t)) {
    return true;
  }
  if (/^export\s/.test(t) && !/^export\s+(?:const|let|var)\s+\w+\s*(?::[^=]*)?=\s*["'`]/.test(t)) {
    return true;
  }
  if (/^(\/\/|\/\*|\*)/.test(t)) {
    return true;
  }
  // 纯路由行跳过。同一行里若有中文律师文案，不能因为提到 /api/ 就整行免检。
  if (t.includes("/api/") && !/[\u3400-\u9fff]/.test(t)) {
    return true;
  }
  return false;
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

/** 棘轮地板：{ note, generatedAt, counts: { <patternId>: <冻结命中数> } }。 */
function loadSynonymBaseline() {
  if (!fs.existsSync(SYNONYM_BASELINE_PATH)) {
    console.error(
      `! 缺少 ${path.relative(repoRoot, SYNONYM_BASELINE_PATH)}：棘轮档没有地板可依。` +
        "请先跑 `pnpm lawmind:ui-copy-lint -- --update` 生成基线。",
    );
    process.exit(1);
  }
  const parsed = JSON.parse(fs.readFileSync(SYNONYM_BASELINE_PATH, "utf8"));
  return parsed;
}

/** 收集命中：硬拦档走 allowlist 豁免，棘轮档按 pattern 计数。 */
function collect(files, patterns, allowlist) {
  const findings = [];
  const exempted = [];
  for (const file of files) {
    const rel = path.relative(repoRoot, file);
    const lines = fs.readFileSync(file, "utf8").split("\n");
    // 多行 import/export 的延续行同样不是文案：起始行被豁免但不以 ; 收尾时，
    // 直到语句收尾（;）为止的延续行一并跳过（否则 `} from "…/assistants/roster.ts"` 会误命中路径禁词）。
    let inModuleStatement = false;
    lines.forEach((line, idx) => {
      const t = line.trim();
      if (inModuleStatement) {
        if (t.endsWith(";")) {
          inModuleStatement = false;
        }
        return;
      }
      if (isSuppressedLine(line)) {
        // export const/let/var 可能携带文案（对象字面量、模板串），不做多行跳过。
        const opensModuleStatement =
          (/^import\s/.test(t) ||
            (/^export\s/.test(t) && !/^export\s+(?:const|let|var)\s/.test(t))) &&
          !t.endsWith(";");
        if (opensModuleStatement) {
          inModuleStatement = true;
        }
        return;
      }
      for (const { id, re, note } of patterns) {
        if (!re.test(line)) {
          continue;
        }
        const finding = { file: rel, line: idx + 1, pattern: id, note, lineText: line.trim() };
        if (isExempted(allowlist, finding)) {
          exempted.push(finding);
        } else {
          findings.push(finding);
        }
      }
    });
  }
  return { findings, exempted };
}

function main() {
  const update = process.argv.includes("--update");
  const allowlist = loadAllowlist();
  const files = walk(RENDERER_DIR).toSorted();

  // ① 硬拦档：命中即失败。
  const hard = collect(files, BANNED_PATTERNS, allowlist);
  for (const f of hard.findings) {
    console.error(`✗ ${f.file}:${f.line}  [${f.pattern}] ${f.note}`);
    console.error(`    ${f.lineText}`);
  }
  const stale = allowlist.filter(
    (entry) => !hard.exempted.some((f) => f.file === entry.file && f.pattern === entry.pattern),
  );
  if (stale.length > 0) {
    console.warn("! 以下豁免条目已失效（对应文案已不存在），请顺手移除：");
    for (const entry of stale) {
      console.warn(`    ${entry.file}  [${entry.pattern}]`);
    }
  }

  // ② 棘轮档：存量冻结，只拦「新增」。
  const baseline = loadSynonymBaseline();
  const counts = baseline.counts ?? {};
  const syn = collect(files, SYNONYM_PATTERNS, allowlist);
  const actual = new Map();
  for (const f of syn.findings) {
    if (!actual.has(f.pattern)) {
      actual.set(f.pattern, []);
    }
    actual.get(f.pattern).push(f);
  }
  const regressions = [];
  const improvements = [];
  for (const { id } of SYNONYM_PATTERNS) {
    const hits = actual.get(id) ?? [];
    const floor = typeof counts[id] === "number" ? counts[id] : 0;
    if (hits.length > floor) {
      regressions.push({ id, hits, floor });
    } else if (hits.length < floor) {
      improvements.push({ id, from: floor, to: hits.length });
    }
  }

  if (update) {
    const nextCounts = {};
    let total = 0;
    for (const { id } of SYNONYM_PATTERNS) {
      const count = (actual.get(id) ?? []).length;
      nextCounts[id] = count;
      total += count;
    }
    const next = { ...baseline, generatedAt: new Date().toISOString(), counts: nextCounts };
    fs.writeFileSync(SYNONYM_BASELINE_PATH, `${JSON.stringify(next, null, 2)}\n`);
    console.log(
      `ui-copy-lint: 棘轮地板已更新（${SYNONYM_PATTERNS.length} 项，合计 ${total} 处存量）。`,
    );
    if (hard.findings.length > 0) {
      console.error(`硬拦截档仍有 ${hard.findings.length} 处未豁免命中，见上。`);
      process.exit(1);
    }
    return;
  }

  for (const { id, hits, floor } of regressions) {
    const { note } = SYNONYM_PATTERNS.find((p) => p.id === id);
    console.error(`✗ ${id} 新增近义词回潮：${hits.length} 处 > 地板 ${floor} 处。${note}`);
    for (const h of hits) {
      console.error(`    ${h.file}:${h.line}  ${h.lineText}`);
    }
  }
  if (improvements.length > 0) {
    console.log("· 棘轮档已低于地板，可收紧（跑 `pnpm lawmind:ui-copy-lint -- --update`）：");
    for (const { id, from, to } of improvements) {
      console.log(`    ${id}: ${from} → ${to}`);
    }
  }

  const floorTotal = SYNONYM_PATTERNS.reduce((a, { id }) => a + (counts[id] ?? 0), 0);
  console.log(
    `ui-copy-lint: 扫描 ${files.length} 个文件；硬拦档未豁免命中 ${hard.findings.length} 处（豁免 ${hard.exempted.length} 处）；` +
      `棘轮档存量 ${syn.findings.length} / 地板 ${floorTotal} 处。`,
  );
  if (hard.findings.length > 0) {
    console.error(
      "律师可见文案命中硬拦禁词；请改用律师语言，或在 ui-copy-lint-allowlist.json 登记豁免理由。",
    );
  }
  if (regressions.length > 0) {
    console.error(
      "棘轮档出现新增近义词。请改用术语表的词；确实是合法保留用法时，收窄 SYNONYM_PATTERNS 的正则并注明理由。",
    );
  }
  if (hard.findings.length > 0 || regressions.length > 0) {
    process.exit(1);
  }
}

main();
