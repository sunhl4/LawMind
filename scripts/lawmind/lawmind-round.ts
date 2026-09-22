#!/usr/bin/env node
/**
 * 跑一轮真实办件（影子演练）——第二十期 P0–P5 的「燃料」生成器。
 *
 * ## 为什么需要它
 *
 * 决策层文档（`docs/lawmind/LAWMIND-DECISION-LAYER-PLAN.md` §3.5）实测发现：
 * `escape-*.jsonl` 三个文件**从未产生过任何记录**，因此 P1（规则编译）、
 * P3（校准器）、P4（棘轮）都卡在「没有真实办件数据」。
 *
 * 本脚本不伪造数据——它跑的是**真实引擎链路**（`createLawMindEngine` 的
 * plan → confirm → research → draft → review），只是把「律师改稿」这一动作
 * 由脚本扮演。产物全部落进工作区，随后可被 `pnpm lawmind:decision-samples` 读到。
 *
 * ## 为什么一轮要跑三种交办
 *
 * `engine/reviewing.ts:169` 的触发条件是
 * `needsLintForEscape = status !== "approved" || rewriteDelta > 0`，
 * 而产物是 `lint_findings` 还是 `lawyer_edit` 取决于 `runLegalLint` 是否命中：
 *
 * | 交办 | 期望产物 | 在决策语料里的信号 |
 * | ---- | ----------------------------- | ------------------ |
 * | 审查意见书 | lint 有命中 + 律师改 | `rule_hit`（编译器工作证据） |
 * | 催告函 | lint 零命中 + 律师改 | **`rule_miss`（编译器漏网，最有价值）** |
 * | 对照：干净批准 | **什么都不写** | 证明结构性原因，不是推论 |
 *
 * 第三种是**对照组**：它必须产出零记录，否则「为什么不产生数据」这个结论就是错的。
 *
 * ## 用法
 *
 *   pnpm lawmind:round                      # 跑一轮，工作区 workspace/rounds/<日期>-<slug>/
 *   pnpm lawmind:round -- --keep            # 保留工作区（默认也保留，--keep 仅为显式）
 *   pnpm lawmind:round -- --workspace <dir> # 指定工作区
 *
 * 跑完后：
 *
 *   pnpm lawmind:decision-samples -- --workspace workspace/rounds/<日期>-<slug>
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { persistDraft } from "../../src/lawmind/drafts/index.js";
import { createLawMindEngine } from "../../src/lawmind/engine/factory.js";
import { captureDraftEditLearning } from "../../src/lawmind/learning/draft-edit-learning.js";
import { readEditExamplesDetailed } from "../../src/lawmind/learning/edit-examples.js";
import { runLegalLint } from "../../src/lawmind/lint/run-lint.js";
import { DRILL_MARKER_FILE } from "../../src/lawmind/metrics/decision-samples.js";
import { readLintEscapeFiles } from "../../src/lawmind/metrics/lint-escape-candidates.js";
import { summarizeProductMetrics } from "../../src/lawmind/metrics/product-metrics.js";
import { collectDerivedFacts } from "../../src/lawmind/reasoning/derived-facts.js";
import { createWorkspaceAdapter } from "../../src/lawmind/retrieval/index.js";
import type { ArtifactDraft } from "../../src/lawmind/types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");

// ─────────────────────────────────────────────
// 真实案件设定（不是占位符）
// ─────────────────────────────────────────────

const MATTER_ID = "matter-2026-0917-jinghui";
const MATTER_TITLE = "精汇机械诉朗行电子设备采购合同纠纷";
const CLIENT = "北京精汇机械有限公司";
const COUNTERPARTY = "苏州朗行电子科技有限公司";

const brief = {
  instruction:
    `审查甲方（${CLIENT}）与乙方（${COUNTERPARTY}）之间的设备采购合同（合同编号 JH-2026-0917），` +
    "指出对甲方不利的条款并出具合同审查意见书。",
  audience: "客户",
} as const;

// ─────────────────────────────────────────────
// 审查意见书正文（干净文本：机械核对应零命中）
// ─────────────────────────────────────────────

// ─────────────────────────────────────────────
// 交办 B 的正文：真正的「机械核对零命中」
// ─────────────────────────────────────────────

/**
 * 一封措辞规范、要素齐备的催告函。`letter.demand` 上机械核对**零命中**
 * （已实测：`runLegalLint(..., { deliverableType: "letter.demand" })` → 0 findings）。
 *
 * 律师仍会改它——因为改的是**口径与力度**，不是机械缺陷。这产出 `rule_miss`：
 * 机械核对看不出问题，但律师动了手。这是真实场景里最常见的一类漏网。
 */
const DEMAND_LETTER_BODY = [
  "苏州朗行电子科技有限公司：",
  "",
  "就我方当事人北京精汇机械有限公司与贵司签订的《采购合同》（合同编号 JH-2026-0917），" +
    "贵司应于 2026 年 11 月 30 日前向我方当事人交付全部精密检测设备共 12 台。" +
    "截至本函发出之日，我方当事人尚未收到任何设备。",
  "",
  "现催告贵司于收到本函之日起十日内完成全部设备的交付。" +
    "逾期仍未交付的，我方当事人将依合同第五条主张违约责任，并保留解除合同及要求赔偿损失的权利。",
  "",
  "特此函告。",
].join("\n");

/**
 * 律师对催告函的实质修改：把「保留权利」改成有具体期限与后果的通牒。
 *
 * **刻意保持机械干净**——这是关键：`outcome: "lawyer_edit"` 的两个条件是
 * 「审核时那份文本零命中」**且**「该稿经历过改稿（`rewriteAmplitude` 幅度 > 0）」。
 * 若改后稿引入了 `第X条` 引用或裸百分比，lint 会命中，outcome 就变成 `lint_findings`，
 * 拿不到 `lawyer_edit`。这本身就是本轮实测到的一条口径约束。
 */
const DEMAND_LETTER_REVISION =
  "苏州朗行电子科技有限公司：\n\n" +
  "北京市衡平律师事务所接受北京精汇机械有限公司（以下称「委托方」）委托，" +
  "就贵司与其之间设备采购合同迟延交付一事，特此函告：\n\n" +
  "一、按合同约定，贵司应于 2026 年 11 月 30 日前向委托方交付精密检测设备共十二台。" +
  "截至本函发出之日，委托方未收到任何设备，贵司已构成迟延履行。\n\n" +
  "二、现要求贵司于 2026 年 10 月 5 日前完成全部交付，" +
  "并按约定支付自迟延之日起至实际交付之日止的违约金。\n\n" +
  "三、逾期未履行的，委托方将解除合同，并同时主张违约金与实际损失，" +
  "不因合同解除而免除贵司的赔偿责任。\n\n" +
  "四、请贵司于收到本函之日起三日内书面回复履约计划。\n\n" +
  "特此函告。\n\n" +
  "北京市衡平律师事务所\n陈叙 律师\n2026 年 9 月 21 日";

// ─────────────────────────────────────────────
// 工具
// ─────────────────────────────────────────────

function parseArgs(argv: string[]): { workspace: string; slug: string } {
  let workspace = "";
  let slug = "purchase-contract";
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--workspace" && argv[i + 1]) {
      workspace = path.resolve(argv[++i]);
    } else if (argv[i] === "--slug" && argv[i + 1]) {
      slug = argv[++i]!;
    }
  }
  if (!workspace) {
    const day = new Date().toISOString().slice(0, 10);
    workspace = path.join(repoRoot, "workspace", "rounds", `${day}-${slug}`);
  }
  return { workspace, slug };
}

function writeOnce(file: string, content: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, "utf8");
}

function hr(title: string): void {
  console.log("");
  console.log("─".repeat(72));
  console.log(title);
  console.log("─".repeat(72));
}

// ─────────────────────────────────────────────
// 主流程
// ─────────────────────────────────────────────

async function main(): Promise<void> {
  const { workspace, slug } = parseArgs(process.argv.slice(2));
  fs.mkdirSync(workspace, { recursive: true });

  // 演练标记：这批 JSONL 与真实飞轮同形，**必须**能自证是演练，
  // 否则「跑了 N 轮」会在报表上与「真实办了 N 件」长得一样（见 D9 / `decision-samples.ts`）。
  writeOnce(
    path.join(workspace, DRILL_MARKER_FILE),
    `${JSON.stringify(
      {
        drill: true,
        slug,
        generatedAt: new Date().toISOString(),
        note: "本工作区由 `pnpm lawmind:round`（影子演练）创建：数据可用于判断机制是否跑通，不得用于推断规则覆盖率、律师改稿习惯或真实案件分布。",
      },
      null,
      2,
    )}\n`,
  );

  hr(`第 0 步 · 准备真实案件（${workspace}）`);

  // 案件档案：CASE.md 会被工作区适配器当作 memo 来源读进去（真实检索路径）
  writeOnce(
    path.join(workspace, "cases", MATTER_ID, "CASE.md"),
    [
      `# ${MATTER_TITLE}`,
      "",
      "## 1. 基本信息",
      `- 案件：${MATTER_ID}`,
      `- 委托方（甲方）：${CLIENT}`,
      `- 相对方（乙方）：${COUNTERPARTY}`,
      "- 案由：设备采购合同纠纷（目前处于合同签署前审查阶段）",
      "- 合同编号：JH-2026-0917",
      "- 合同总价款：1,032,000 元",
      "",
      "## 2. 当事人",
      `- 甲方（买方）：${CLIENT}`,
      `- 乙方（卖方）：${COUNTERPARTY}`,
      "",
      "## 3. 事实摘要",
      "甲方拟向乙方采购精密检测设备 12 台（型号 LX-880）。",
      "双方已交换合同文本，甲方尚未签署，委托本所审查合同条款。",
      "",
      "## 4. 材料清单",
      "- 采购合同（JH-2026-0917）全文，共九条",
      "- 设备技术规格书",
      "",
    ].join("\n"),
  );

  // 合同原文作为案件材料（同时拷进案件目录）
  const contractSrc = path.join(repoRoot, "fixtures/lawmind-round/purchase-contract.md");
  const contractText = fs.readFileSync(contractSrc, "utf8");
  writeOnce(path.join(workspace, "cases", MATTER_ID, "materials", "采购合同.md"), contractText);

  // 律师画像（让 system prompt 注入有真实内容）
  writeOnce(
    path.join(workspace, "LAWYER_PROFILE.md"),
    [
      "# 律师画像",
      "",
      "## 一、基本信息",
      "- **姓名**：陈叙",
      "- **执业机构**：北京衡平律师事务所",
      "- **专业方向**：商事合同、设备买卖与产品质量争议",
      "",
      "## 八、工作习惯",
      "- 风险表述要落到**具体金额与后果**，不接受「可能存在风险」这类空泛表述",
      "- 对外意见书默认受众是客户法务，不是法院",
      "",
    ].join("\n"),
  );

  console.log(`案件：${MATTER_ID}`);
  console.log(`材料：采购合同（${contractText.length} 字）`);

  // ── 对照组：直接对合同原文跑机械核对 ───────────────────────────────
  hr("第 1 步 · 对照组：机械核对直接跑在**合同原文**上（衡量编译器覆盖）");

  const contractLint = runLegalLint(contractText, undefined, undefined, undefined, {
    deliverableType: "contract.review",
  });
  console.log(
    `命中 ${contractLint.findings.length} 条（blocker ${contractLint.blockerCount} / warning ${contractLint.warningCount}）`,
  );
  for (const f of contractLint.findings) {
    console.log(`  [${f.severity}] ${f.ruleId} — ${f.message}`);
  }
  console.log("");
  console.log("口径说明：这是「规则直接读真实合同文本」的覆盖测量，不是交付物核对。");

  // ── 盲区探测：这一轮现场发现的漏网 ────────────────────────────────
  hr("第 1.5 步 · 盲区探测：把「本该抓到但没抓到」的实体缺陷列出来");

  // 本合同最严重的实体缺陷：定金 310,000 / 标的额 1,032,000 = 30.04% > 20% 上限。
  // 合同**只写了绝对金额**，从未写「30%」——而规则只认显式百分比。
  const depositAmount = 310_000;
  const contractValue = 1_032_000;
  const impliedPct = (depositAmount / contractValue) * 100;
  const depositHitOnContract = contractLint.findings.some(
    (f) => f.ruleId === "statutory.deposit_cap",
  );
  console.log("定金上限核对（民法典第586条，上限 20%）：");
  console.log(
    `  合同写法：定金 ${depositAmount.toLocaleString("en-US")} 元，标的额 ${contractValue.toLocaleString("en-US")} 元`,
  );
  console.log(`  实际比例：${impliedPct.toFixed(2)}% —— 超上限`);
  console.log(
    `  statutory.deposit_cap：${depositHitOnContract ? "命中 ✓" : "**未命中（静默放过）**"}`,
  );
  console.log("");
  console.log("  为什么：规则用 `定金[^。]{0,24}?(\\d+)%` 匹配**显式百分比**，");
  console.log("  从不从「定金金额 ÷ 标的额」反算比例——而真实合同普遍只写金额。");
  console.log("");
  console.log("  这是本轮最有价值的产出：**编译器最该拦的那一条，恰好是它抓不到的那一条。**");

  // 对照：同一个缺陷，「算好的事实」能补上吗？
  const depositFacts = collectDerivedFacts(contractText, {
    deliverableType: "contract.review",
    limit: 8,
  });
  console.log("");
  if (depositFacts.length > 0) {
    console.log("  对照：**派生事实**（第二类：该算的算好，喂给模型）");
    for (const f of depositFacts) {
      console.log("");
      console.log(`    [${f.kind}]`);
      console.log(`      ${f.statement}`);
      console.log(`      算式：${f.arithmetic.split("\n").join("；")}`);
      if (f.citations.length > 0) {
        console.log(`      出处：${f.citations.join("、")}`);
      }
    }
    console.log("");
    console.log("  ↑ 规则漏了，但把该算的算好塞给模型，这些数字就不会缺席。");
    console.log("    且它们只给**数字、算式与出处**，不下「该条款无效」这类法律结论——");
    console.log("    那是模型与律师的判断，不是算术的产物。");
  } else {
    console.log("  派生事实：本材料上算不出可证明的数字（不是「没问题」，是「算不出来就不说」）。");
  }

  // 正面证据：规则确实抓到了别的实体缺陷
  const arbitrationHit = contractLint.findings.find((f) => f.ruleId === "form.or_arbitrate_or_sue");
  console.log("");
  console.log(
    `  对照（规则确实抓到的）：${arbitrationHit ? `${arbitrationHit.ruleId} — ${arbitrationHit.message}` : "（无）"}`,
  );

  // ── 误报探测：合同类规则用在信函类交付物上 ────────────────────────
  hr("第 1.6 步 · 误报探测：把**合同类**规则用在信函上（反向问题）");

  // 机械核对的输入是 `draftTextFromUnknown(draft)` —— **title + summary + heading + body**
  // 拼起来的全文，不只是正文（见 `lint/run-lint.ts:114`）。
  // 于是「给一封催告函写个含『乙方』的摘要」会触发**合同**主体成对规则。
  const falsePositiveProbe = "催告乙方按约交付设备";
  const probeAssembled = ["催告函", falsePositiveProbe, "正文", DEMAND_LETTER_BODY].join(" ");
  const probeLint = runLegalLint(probeAssembled, undefined, undefined, undefined, {
    deliverableType: "letter.demand",
  });
  console.log("  交付物类型：letter.demand（信函，不是合同）");
  console.log(`  摘要写法：「${falsePositiveProbe}」——信函里称对方为「乙方」是常见写法`);
  console.log(
    `  机械核对：${probeLint.findings.map((f) => `${f.ruleId}(${f.severity})`).join("、") || "（无）"}`,
  );
  console.log("");
  console.log("  为什么是误报：`consistency.party_pair` 要求正文同时出现甲方与乙方——");
  console.log("  那是**合同**的主体成对性检查。一封催告函只需指明收件人，");
  console.log("  摘要写「乙方」并不构成「合同主体只见乙方」。");
  console.log("");
  console.log("  这一条不会被静默丢掉：飞轮会把 `ruleIds` 与**触发它的原文片段**一起记下");
  console.log("  （见第 6 步的 escape-candidates / escape-corpus），即一条现成的规则候选。");

  // ── 改稿范例通道 ──────────────────────────────────────────────────
  hr("第 1.7 步 · 改稿范例通道（素材，不是闸）");

  console.log("  律师改稿时，系统同时做两件不同的事：");
  console.log("    偏好通道：压成 ≤160 字 → 待确认 → 落 LAWYER_PROFILE（**指令**，每轮都在场）");
  console.log(
    "    范例通道：(改前, 改后) **完整对照** → edits/edit-examples.jsonl（**素材**，按需检索）",
  );
  console.log("");
  console.log("  范例通道是本轮新增：此前完整的对照被压成一句话就丢了，");
  console.log("  而那句话只能告诉模型「要这样写」，教不会「这种场合长这样」。");

  // ── 真实引擎链路 ──────────────────────────────────────────────────
  hr("第 2 步 · 真实引擎链路：plan → confirm → research → draft");

  const engine = createLawMindEngine({
    workspaceDir: workspace,
    adapters: [createWorkspaceAdapter(workspace)],
  });

  const intent = engine.plan(brief.instruction, { audience: brief.audience });
  console.log(`intent.kind=${intent.kind} risk=${intent.riskLevel} output=${intent.output}`);
  console.log(`deliverableType=${intent.deliverableType ?? "(未推断)"}`);
  console.log(`requiresConfirmation=${intent.requiresConfirmation}`);

  await engine.confirm(intent.taskId, {
    actorId: "lawyer:chen-xu",
    note: "已确认，按审查意见书办理",
  });

  const bundle = await engine.research(intent);
  console.log(
    `检索：sources=${bundle.sources.length} claims=${bundle.claims.length} riskFlags=${bundle.riskFlags.length}`,
  );
  if (bundle.missingItems.length > 0) {
    console.log(`        missingItems=${bundle.missingItems.slice(0, 3).join(" | ")}`);
  }

  const engineDraft = engine.draft(intent, bundle, { title: "采购合同审查意见书" });
  console.log(
    `引擎草稿：sections=${engineDraft.sections.length} template=${engineDraft.templateId ?? "(无)"}`,
  );
  const engineDraftLint = runLegalLint(
    engineDraft.sections.map((s) => `${s.heading}\n${s.body}`).join("\n"),
    undefined,
    undefined,
    undefined,
    { deliverableType: engineDraft.deliverableType },
  );
  console.log(
    `引擎草稿机械核对：${engineDraftLint.findings.length} 条` +
      (engineDraftLint.findings.length > 0
        ? ` → ${engineDraftLint.findings
            .map((f) => f.ruleId)
            .slice(0, 4)
            .join("、")}`
        : ""),
  );

  // ── 交办 A：engine 草稿 → 律师改 → 期望 rule_hit ──────────────────
  hr("第 3 步 · 交办 A：审核引擎草稿（律师实质修改）");
  await engine.review(engineDraft, {
    actorId: "lawyer:chen-xu",
    status: "modified",
    note: "补齐当事人信息与争议解决条款的风险说明",
    labels: ["争点遗漏", "风险未标注"],
  });
  console.log(`已审核：taskId=${engineDraft.taskId} status=modified`);
  console.log(
    `该草稿机械核对 ${engineDraftLint.findings.length} 条 → 预期记入 ${engineDraftLint.findings.length > 0 ? "rule_hit" : "rule_miss"}`,
  );

  // 质量快照：P3 校准器的**特征**来源。缺它则数据集为空（有标签也没特征）——
  // 这是本轮实测到的又一处「少接一根线，整条下游就没数据」。
  const aQuality = await engine.recordQuality(engineDraft.taskId, {
    labels: ["争点遗漏", "风险未标注"],
    latencyMs: 8420,
  });
  console.log(`质量快照（A）：${aQuality ? "已写入" : "**未写入**"} workspace/quality/`);

  // ── 交办 B：干净催告函 → 律师改口径 → 得到 rule_miss ─────────────
  hr("第 4 步 · 交办 B：干净催告函（律师改口径）→ 目标 rule_miss");

  const cleanTaskId = `task-round-rulemiss-${Date.now().toString(36)}`;
  const cleanDraft: ArtifactDraft = {
    taskId: cleanTaskId,
    matterId: MATTER_ID,
    title: "催告函",
    // 摘要刻意用中性写法：含「乙方」会触发 `consistency.party_pair`（合同主体成对规则），
    // 于是 outcome 变成 lint_findings 而非 lawyer_edit。见第 1.6 步的误报探测。
    summary: "致苏州朗行电子科技有限公司的履约催告",
    sections: [{ heading: "正文", body: DEMAND_LETTER_BODY, citations: [] }],
    reviewNotes: [],
    reviewStatus: "pending",
    output: "docx",
    templateId: "letter-demand-default",
    deliverableType: "letter.demand",
    createdAt: new Date().toISOString(),
  };

  const cleanLint = runLegalLint(DEMAND_LETTER_BODY, undefined, undefined, undefined, {
    deliverableType: "letter.demand",
  });
  console.log(`干净催告函机械核对：${cleanLint.findings.length} 条`);
  for (const f of cleanLint.findings) {
    console.log(`  [${f.severity}] ${f.ruleId} — ${f.message}`);
  }

  // 草稿落盘（与真实路径一致：草稿落盘 → 审核）
  persistDraft(workspace, cleanDraft);

  // 模拟律师改稿：整段换成通牒式表述，并记录改稿幅度。
  //
  // `rewriteAmplitude` 是 `outcome: "lawyer_edit"` 的**必要条件**（见
  // `engine/reviewing.ts` 的内层判断）：没有它，即便改后稿机械干净也不会记录。
  // 桌面端由改稿台写入；此处脚本显式构造同一形态。
  const beforeChars = cleanDraft.sections[0].body.length;
  cleanDraft.sections[0].body = DEMAND_LETTER_REVISION;
  cleanDraft.rewriteAmplitude = {
    absCharDelta: Math.abs(DEMAND_LETTER_REVISION.length - beforeChars),
    absParagraphDelta: 4,
    ratio: DEMAND_LETTER_REVISION.length / Math.max(1, beforeChars),
    at: new Date().toISOString(),
  };
  persistDraft(workspace, cleanDraft);

  // 审核时 lint 读的是**这一版（改后）文本**；它必须机械干净，否则 outcome 变 lint_findings。
  const revisedLint = runLegalLint(DEMAND_LETTER_REVISION, undefined, undefined, undefined, {
    deliverableType: "letter.demand",
  });
  console.log(`改后稿机械核对：${revisedLint.findings.length} 条`);
  for (const f of revisedLint.findings) {
    console.log(`  [${f.severity}] ${f.ruleId} — ${f.message}`);
  }

  await engine.review(cleanDraft, {
    actorId: "lawyer:chen-xu",
    status: "modified",
    note:
      "改成通牒式：要有明确期限、明确金额、明确解除后果，并落我所落款。" +
      "「保留权利」这种话对方不会当回事。",
    labels: ["语气过弱", "风险未标注"],
  });
  console.log(`已审核：taskId=${cleanTaskId} status=modified`);
  console.log(
    `原稿 ${cleanLint.findings.length} 条命中 / 改后稿 ${revisedLint.findings.length} 条命中` +
      ` → 预期 outcome=${revisedLint.findings.length === 0 ? "lawyer_edit" : "lint_findings"}`,
  );
  const bQuality = await engine.recordQuality(cleanTaskId, {
    labels: ["语气过弱", "风险未标注"],
    latencyMs: 3180,
  });
  // B 是脚本直接构造的交付物，未走 engine.plan → 没有 TaskRecord →
  // `recordQualityImpl` 正确地拒绝写入质量快照。这是**对的行为**，不是缺陷：
  // 质量快照的前提是这个任务在引擎里存在。要让它也有特征，得让 B 也走一遍 plan。
  console.log(
    `质量快照（B）：${bQuality ? "已写入" : "未写入（B 未经 engine.plan，无 TaskRecord——引擎正确地拒绝）"}`,
  );

  // ── 改稿范例通道：与桌面端改稿台**同一个函数** ────────────────────
  //
  // 桌面端在 `lawmind-server-route-review.ts` 的正文 PATCH 里调 `captureDraftEditLearning`，
  // 它同时走两条通道（偏好 + 范例）。这里显式调同一个函数，
  // 因为 `engine.review()` 只改审核状态，不经正文保存路径。
  const captured = await captureDraftEditLearning({
    workspaceDir: workspace,
    auditDir: path.join(workspace, "audit"),
    taskId: cleanTaskId,
    before: [{ heading: "正文", body: DEMAND_LETTER_BODY }],
    after: [{ heading: "正文", body: DEMAND_LETTER_REVISION }],
    deliverableType: "letter.demand",
    matterId: MATTER_ID,
    reviewNote: "改成通牒式：要有明确期限、明确解除后果，并落我所落款。",
  });
  const examples = readEditExamplesDetailed(workspace);
  console.log("");
  console.log("改稿捕获（同一处改动，两条通道）：");
  console.log(`  偏好通道：${captured.length} 条待确认候选（压成 ≤160 字的指令）`);
  console.log(`    例：${captured[0]?.payload.slice(0, 78) ?? "（无）"}…`);
  console.log(
    `  范例通道：${examples.rows.length} 条范例对（保留完整对照）· 该条 ${examples.rows[0]?.before.length ?? 0} → ${examples.rows[0]?.after.length ?? 0} 字`,
  );
  console.log("");
  console.log("  ↑ 这就是本轮要修的那一环：同一处改动，以前只留下上面那句短文本，");
  console.log("    现在同时留下完整对照——**素材通道**。");

  // ── 对照组 C：干净批准 → 必须零写入 ──────────────────────────────
  hr("第 5 步 · 对照组 C：干净批准（不得产生任何逃逸记录）");

  const approvedTaskId = `task-round-approved-${Date.now().toString(36)}`;
  const approvedDraft: ArtifactDraft = {
    taskId: approvedTaskId,
    matterId: MATTER_ID,
    title: "催告函",
    summary: "催告乙方按约交货",
    sections: [
      {
        heading: "正文",
        body:
          "苏州朗行电子科技有限公司：\n\n" +
          "就我方当事人北京精汇机械有限公司与贵司签订的《采购合同》（合同编号 JH-2026-0917），" +
          "贵司应于 2026 年 11 月 30 日前交付全部设备。截至本函发出之日，我方尚未收到任何设备。\n\n" +
          "现正式催告贵司于收到本函之日起 10 日内完成全部设备的交付。" +
          "逾期未交付的，我方将依合同第五条主张违约责任，并保留解除合同的权利。\n\n" +
          "特此函告。",
        citations: [],
      },
    ],
    reviewNotes: [],
    reviewStatus: "pending",
    output: "docx",
    templateId: "letter-demand-default",
    deliverableType: "letter.demand",
    createdAt: new Date().toISOString(),
  };
  persistDraft(workspace, approvedDraft);
  await engine.review(approvedDraft, {
    actorId: "lawyer:chen-xu",
    status: "approved",
    note: "内容无误，直接出稿",
  });
  console.log(`已审核：taskId=${approvedTaskId} status=approved（无改稿幅度）`);
  console.log("预期：零写入——因为 needsLintForEscape 为 false");

  // ── 体检 ─────────────────────────────────────────────────────────
  hr("第 6 步 · 一轮下来到底产生了什么");

  const escape = readLintEscapeFiles(workspace);
  const metrics = summarizeProductMetrics(workspace);

  const rows: Array<[string, string, string]> = [
    [
      "escape-candidates.jsonl",
      escape.candidates.present ? "有" : "无",
      String(escape.candidates.rows.length),
    ],
    ["escape-corpus.jsonl", escape.corpus.present ? "有" : "无", String(escape.corpus.rows.length)],
    ["escape-stance.jsonl", escape.stance.present ? "有" : "无", String(escape.stance.rows.length)],
  ];
  console.log("逃逸飞轮（运行前三个文件全部不存在）：");
  for (const [name, present, rowsCount] of rows) {
    console.log(`  ${name.padEnd(26)} ${present}  ${rowsCount} 行`);
  }

  console.log("");
  console.log("产品指标：");
  console.log(`  事件总数 ${metrics.total}（文件 ${metrics.totalLines} 行）`);
  console.log(`  first_pass ok/fail: ${metrics.firstPassOk} / ${metrics.firstPassFail}`);
  console.log(`  rewrites: ${metrics.rewrites}`);
  const escapeOutcomes = Object.entries(metrics.byOutcome)
    .filter(([k]) => k === "lawyer_edit" || k === "lint_findings")
    .map(([k, v]) => `${k}=${v}`)
    .join(" ");
  console.log(`  lint_escape 分解: ${escapeOutcomes || "（无）"}`);

  console.log("");
  console.log("按飞轮**真实口径**（lint 读的是审核时那份文本 = 改后稿）：");
  console.log(
    `  交办 A（引擎草稿，改后仍 ${engineDraftLint.findings.length} 条命中）→ lint_findings`,
  );
  const bOutcome = revisedLint.findings.length === 0 ? "lawyer_edit" : "lint_findings";
  const bNote =
    revisedLint.findings.length === 0 ? "（最终稿机械干净且改过）" : "（改后稿仍有命中）";
  console.log(
    `  交办 B（原稿 ${cleanLint.findings.length} 条 / 改后稿 ${revisedLint.findings.length} 条）→ ${bOutcome}${bNote}`,
  );
  console.log("  对照 C（干净批准）→ 零记录（对照组，符合预期）");
  console.log("");
  console.log("⚠️ 飞轮的**结构性局限**（本轮实测）：它 lint 的是改后稿，");
  console.log("   所以「agent 原稿有缺陷、律师在提交前改掉」这一类它**看不见**。");
  console.log("   上面第 1.5 步的定金盲区就是这一类——它只能靠**对原稿另跑一次**才发现。");

  hr("下一步");
  console.log(
    `  pnpm lawmind:decision-samples -- --workspace ${path.relative(repoRoot, workspace)}`,
  );
  console.log("");
  console.log("该命令会把这一轮的产物归一成决策语料，并打印 P2/P3/P4/P5 四段状态。");
  console.log("");
  console.log("注意：产物是**追加**的（JSONL append-only，与真实飞轮一致）。");
  console.log("      对同一工作区重复跑会累积样本。要干净重来就先删掉该目录。");
  console.log("");
  console.log("⚠️ 这批数据是**演练**，不是真实办件：");
  console.log("   - 可以据此判断「机制是否跑通」；");
  console.log("   - **不能**据此推断规则覆盖率或律师改稿习惯——那需要真实案源分布。");
  console.log("");
}

main().catch((err: unknown) => {
  console.error("[LawMind] round failed:", err instanceof Error ? (err.stack ?? err.message) : err);
  process.exitCode = 1;
});
