# 第 49 章 实现精读：工具层

第 23 章讲的是「每个工具干什么」。这一章讲**工具是怎么被组装起来、怎么写一个工具、以及有哪些共用的机制**。

`src/lawmind/agent/tools/` 有 66 个实现文件。这一章不逐个列（第 23 章已按用途分过组），而是按**机制**讲。

## 49.1 组装：一个注册表的诞生

入口是 `createLegalToolRegistry(opts)`（`tools/legal-tools.ts`）。它的组装顺序是固定的：

```text
① 建一个空 ToolRegistry
② 一个大的 tools 数组（约 50 个工具，分七组写在一起）
③ tools.push(lawMindDeepResearchTool)          ← 无条件
④ if (allowWebSearch) push 三个联网工具
⑤ if (enableCollaboration && baseConfig) push 七个协作工具
⑥ tools.push(...engineTools)
⑦ for (const tool of tools) registry.register(tool)
```

`opts` 只有四个字段：`allowWebSearch`、`enableCollaboration`、`baseConfig`、`collaborationDepth`。

### 两个设计点

**第一：常驻工具 vs 工厂工具。**

大 `tools` 数组里的几乎都是**模块级常量**（比如 `export const searchMatter: AgentTool = {...}`），而协作工具是**工厂函数**（`createDelegateTaskTool({ baseConfig, currentDepth, policy })`）。

区别的原因是**要不要绑定会话配置**：

| 类型 | 形态                              | 为什么                                                                |
| ---- | --------------------------------- | --------------------------------------------------------------------- |
| 常量 | `export const xxxTool: AgentTool` | 无状态，可以直接复用                                                  |
| 工厂 | `createXxxTool(deps)`             | 需要 `baseConfig`（含工作区、模型、时间用户）、协作策略、当前委派深度 |

所以**你加工具时先问自己「它需不需要知道本轮配置」**——需要就写成工厂。

**第二：协作工具的策略是 best-effort 构建的。**

```text
try { collabPolicy = buildCollaborationPolicyFromAssistants(loadAssistantProfiles(root)); }
catch { collabPolicy = undefined; }
```

也就是说：**读不到助手档案也不影响主链路**，协作策略退化成默认值。这与「MCP 挂载失败不影响核心工具表」（第 5 章）是同一种姿态：**可选能力的初始化失败不该拖垮主干**。

### 三个 barrel 的分工

| 文件                           | 作用                                                                          |
| ------------------------------ | ----------------------------------------------------------------------------- |
| `tools/index.ts`               | 对外的公共面（注册表 + 治理 + 协作工具）                                      |
| `tools/engine-tools.ts`        | 引擎桥工具的 barrel + `engineTools` 数组                                      |
| `tools/collaboration-tools.ts` | 协作工具的 barrel（**已拆到 `coordination/`，这里只为保持 import 路径稳定**） |

`collaboration-tools.ts` 的头部注释写明：「本文件保留为 re-export，以维持外部 import 路径稳定。」——这是一种**兼容层**写法：实现搬家了，但老路径还在。

## 49.2 每个工具的共同形状

看任何一个工具的实现，都能看到同样的骨架：

```ts
export const someTool: AgentTool = {
  definition: {
    name: "some_tool",
    description: "给模型看的一句话说明",
    category: "search" | "analyze" | "draft" | "matter" | "review" | "system" | "collaboration",
    parameters: { /* ToolParameterSchema */ },
    requiresApproval?: boolean,
    riskLevel?: "low" | "medium" | "high",
  },
  async execute(params, ctx) {
    // 1. 取参数（含默认值回落）
    // 2. 校验（不合法直接 return { ok: false, error }）
    // 3. 干活
    // 4. return { ok: true, data: {...} }
  },
};
```

**结果形状只有两种**：

| 成功 | `{ ok: true, data: {...} }`          |
| ---- | ------------------------------------ |
| 失败 | `{ ok: false, error: "给人看的话" }` |

没有异常抛出的路（除了被中间件包装的意外）。这个约定让**模型能可靠地判断成功失败**——它看到的是 `ok` 字段，不是异常栈。

### 案件作用域：那条一行不差的模式

`MATTER_SCOPE_REQUIRED` 里的工具都有这两行（我核对过多个文件，写法完全一致）：

```ts
const matterId = (params.matter_id as string) || ctx.matterId;
if (!matterId) {
  return matterRequiredResult(ctx.workspaceDir);
}
```

**它是「参数优先 → 本轮上下文兜底 → 都没有就软失败」三段式。**

`matter-required.ts` 的 `matterRequiredResult` 返回一个**结构化软失败**：

```ts
{ ok: false, error: "未指定案件 ID。", needsMatter: true, matters: [...], message: "可选案件（最多 20）：..." }
```

注意它有 `needsMatter: true` 与 `matters` 列表——**不只是报错，还告诉模型/界面「有哪些案件可选」**。注释解释了为什么：

> Structured soft fail so the model/UI can prompt the lawyer to pick a matter.

也就是说，这个失败是**可操作的**：界面可以据此弹出选择，模型可以据此追问。这是好错误设计的样板。

### 参数校验的两个层次

**第一层：中间件**（`argSchemaMiddleware`）按 `parameters` 做的通用校验。

**第二层：工具自己**。有一些共享的校验助手，比如 `engine-tool-shared.ts` 里的：

| 导出                                        | 作用                                                  |
| ------------------------------------------- | ----------------------------------------------------- |
| `MAX_INSTRUCTION_LENGTH = 4000`             | 指令长度上限                                          |
| `MAX_TITLE_LENGTH = 200`                    | 标题上限                                              |
| `MAX_AUDIENCE_LENGTH = 100`                 | 受众上限                                              |
| `MAX_TEMPLATE_ID_LENGTH = 96`               | 模板 id 上限                                          |
| `asNonEmptyString(value, field, maxLength)` | 通用字符串校验（抛 `${field} 必须是字符串` / 长度错） |

还有一个模板 id 的正则（`TEMPLATE_ID_RE`）：`^(word|ppt|upload)/[a-zA-Z0-9][a-zA-Z0-9._-]{1,95}$`——**必须是这三类前缀之一**。

## 49.3 四组共享助手

`tools/` 根目录有四个「不实现工具、只服务工具」的文件。

### `matter-required.ts`

只有 `matterRequiredResult(workspaceDir)` 与类型。见上。

### `render-tool-messages.ts`

**渲染失败的分类与话术**，导出 `classifyRenderFailure` 与 `RenderFailureCategory`。

七种分类（**靠错误文本匹配**）：

| 分类                 | 匹配什么                                    |
| -------------------- | ------------------------------------------- |
| `approval_required`  | 含「尚未通过审核」「未通过审核」「pending」 |
| `citation_gate`      | 含「引用」「citation」「未锚定」「援引」    |
| `acceptance_gate`    | 含「出稿检查」「acceptance」「blockers=」   |
| `missing_draft`      | 含「找不到」「没有可渲染」                  |
| `unsupported_format` | 含「不支持渲染格式」                        |
| `render_engine`      | 含「模板」「docx」「渲染失败」              |
| `unknown`            | 兜底（空错误也归这里）                      |

每个分类配一段**面向模型的行动指引**（`CATEGORY_HINT`）。比如 `approval_required` 的提示会告诉模型「请在对话中请律师明确同意导出后，用 `render_document` 并传 `approve=true`；或请律师到桌面「在办」批准该草稿」。

**为什么要有这个文件**：渲染失败有一堆原因，如果只把原始错误抛给模型，它不知道该干什么。分类 + 行动指引把「失败」变成了「下一步」。

### `engine-tool-shared.ts`

引擎桥的共享助手（含 `createLawMindEngine` 的封装、检索适配器装配、参数校验助手）。

**注意它导出了 `buildLawMindRetrievalAdaptersFromEnvForTest`**——说明有一个「为了测试而导出」的函数。这是刻意的口子。

### `legal/ingest-helpers.ts` / `platform/ingest-helpers.ts`

摄取结果的统一封装：`ingestFailure`、`ingestSuccess`、`toolFailureFromIngest`、`toolDataFromIngestSuccess`。

**为什么需要两层**：摄取（读文件）这一层有自己的成功/失败语义（含 `IngestSourceType`、`IngestStage`），要映射成工具的 `{ ok, data }`。有这一层，**所有读文件的工具报告的失败原因格式一致**。

## 49.4 文件访问的四道围栏

读一个文件不只是一次 `fs.readFile`。有序的四道检查：

| 道                  | 在哪                                  | 拦什么                                      |
| ------------------- | ------------------------------------- | ------------------------------------------- |
| ① 工作区相对路径    | `runtime/workspace-path.ts`           | 空、路径穿越（`..`）、逃出根                |
| ② realpath + 黑名单 | `runtime/workspace-io-fence.ts`       | **符号链接指向根外**、`.` 开头（如 `.env`） |
| ③ 治理路径          | `runtime/protected-workspace-rels.ts` | 策略、审计、会话、任务、`RULES.md`          |
| ④ 分析脚本白名单    | `runtime/analysis-script-path.ts`     | 只允许特定目录下的脚本                      |

`workspace-io-fence.ts` 的头部注释讲清了它为什么必要：

> Realpath + deny-list fence for agent file I/O that does not go through `read_host_file`. **Workspace-relative resolvers only check `path.resolve`**, so a symlink (or `.env` sitting in a mounted folder) would otherwise reach the model.

翻译：**第一道围栏只看「解析后的路径在不在根里」，符号链接能绕过它。** 所以需要第二道做 realpath。

这个分层很值得学：**路径检查（字面）和文件检查（真实）是两件事**。第一道拦「明显越界」，第二道拦「伪装成不越界」。

## 49.5 沙箱：一个「客房」而不是「牢房」

`legal/analysis-sandbox.ts` 是 `run_analysis` / `run_compute` 的执行环境。头部注释一句话概括了它的性质：

```text
Guest VM for run_analysis / run_compute.
Host I/O: readTable / readCsv / readJson / stats / writeTable / emitChart.
Language: ordinary JS plus safe globals (Math/JSON/Date/…).
No fs, child_process, fetch, or network. Not an OS jail — string codegen is off.
```

四个要点：

**第一：它是「客房」不是「牢房」。** 注释自己写明「Not an OS jail」。它提供的是**可用性**（让模型能当场写脚本算数、读表、出图），不是**安全隔离**。真正的隔离靠别的层（子进程沙箱、工具管线）。

**第二：宿主 I/O 是一份小 API。** 只有六个：读表、读 CSV、读 JSON、统计、写表、出图。脚本**不能**直接 `fs`。

**第三：语言是普通 JS + 安全全局。** 用的是 Node 的 `vm` 模块，且**关掉了字符串代码生成**（`string codegen is off`）——这是防「用 `Function` 或 `eval` 逃出沙箱」的常规手段。

**第四：它仍然受那四道围栏约束。** 从 import 看，它引用了 `isDeniedHostPath`、`isAllowedAnalysisScriptRel`、`isProtectedAnalysisScriptRel`、`isProtectedWorkspaceRel`、`fenceAgentFilePath`、`resolveWorkspaceRelativePath`。

**也就是说：沙箱是「计算环境的隔离」，不是「文件权限的隔离」。** 文件权限仍由那四道围栏管——**两层各管一段**。

### 谁用它

`run-compute-tool.ts`（`COMPUTE_SOURCE_MAX_CHARS = 80_000`）与 `run-analysis-tool.ts`。前者是「当场写脚本算」；后者是「跑预置脚本」（需要策略开 `allowAnalysisScripts`）。

`run-compute-tool.ts` 还导出 `summarizeComputeForLawyer`——把结果翻译成律师语言（「已出核算对照 表.xlsx」这种），因为**模型写脚本这件事本身不该暴露给律师**。

## 49.6 确定性计算：`calculate`

`legal/calculate-lib.ts` 是「必须算对」的那一类工具的实现。头部注释两条：

```text
Deterministic legal math. Results always include formula + inputs for the file.
LPR / 牌价 must be supplied by the lawyer — never invented.
```

**第二条是关键**：LPR（贷款市场报价利率）和牌价**必须由律师提供**，系统不自己查、不编。因为这类数据有时间性，编一个就是错案。

十二种运算（`CalculateOp`）：

| 运算                    | 干什么                   |
| ----------------------- | ------------------------ |
| `interest`              | 利息（按给定利率）       |
| `interest_lpr`          | LPR 利息（要律师给 LPR） |
| `date_span`             | 日期跨度                 |
| `limitation`            | 时效                     |
| `column_sum`            | 列求和                   |
| `weighted_average`      | 加权平均                 |
| `liquidated_damages`    | 违约金                   |
| `economic_compensation` | 经济补偿（N/N+1/2N）     |
| `overtime_pay`          | 加班费                   |
| `double_wage`           | 双倍工资                 |
| `litigation_fee`        | 诉讼费                   |
| `legal_period`          | 法定期间                 |

结果类型（`CalculateResult`）**固定带四样**：`op`、`value`、`formula`、`inputs`。

**为什么带 `formula` 和 `inputs`**：因为第 21 章那两条验收标准——「金额必须带来源公式」「届满日必须有公式」。**工具直接产出公式，交付物才能写得出来。**

前三个（劳动、期间）的实现在 `src/lawmind/labor/`，诉讼费在 `legal/calculate-litigation-fee.ts`。所以 `calculate` 本身是**调度器**，算法在各自的领域模块里。

## 49.7 两个 worker：把一段活交给「看不见对话的子会话」

`draft-worker-tool.ts` 与 `explore-folder-tool.ts` 共用同一个模式。

`draft-worker-tool` 的**描述文本**（给模型看的）把规则说得很清楚：

> 并行写稿工：根据任务书起草一份文书片段。**子会话看不到对话历史，必须传入自包含任务书**。工会自己读 path/钉选源文件，并可用只读工具（`list_dir` / `analyze_document` / `search_statute` / `search_case_law`）。返回草稿片段、引用出处和待补缺口。不要用于改原件。多章可并行多次调用，由父会话汇总后再 `draft_document`。

拆解这段话，里面规定了六件事：

| 规定                                 | 为什么                                |
| ------------------------------------ | ------------------------------------- |
| 看不到对话历史                       | 所以任务书必须自包含                  |
| 自己能读文件                         | 不用父会话把内容塞进任务书            |
| 只能用四个只读工具                   | 见 `DRAFT_WORKER_READONLY_TOOL_NAMES` |
| 返回三样（片段、引用出处、待补缺口） | 出处的责任在 worker，不在父会话       |
| 不要用于改原件                       | 改稿是另一条路（最短改动）            |
| 多章可并行                           | 所以「多写几章」能提速                |

**参数里的 `goal` 是必填**，而它的说明是「要做的事（自包含，不要只写「帮我看看」）」——**把「任务书要写清楚」这个要求写进了参数说明**。

`explore-folder-tool` 是同一套（`EXPLORE_FOLDER_READONLY_TOOL_NAMES`），只是它的产出是「看清目录 + 摘录要点」。

**这一模式的价值**：写一份长文书时，父会话的上下文不会被中间稿挤爆；而且多个章节可以并行。

## 49.8 文件操作：先解算，再落盘

`legal/workspace-file-ops.ts` 是「工作区内搬移/改名/复制」的实现，也是那一类**可撤销**操作的样板。

它的导出暴露了设计：

| 导出                                                | 作用                                 |
| --------------------------------------------------- | ------------------------------------ |
| `FILE_OPS_MAX_OPS`                                  | 单次操作数上限                       |
| `FILE_OPS_MAX_COPY_FILES`                           | 复制文件数上限                       |
| `FILE_OPS_MAX_COPY_TOTAL_BYTES`                     | 复制总量上限                         |
| `solveFileOps(...)`                                 | **解算**（算出要做哪些操作，不落盘） |
| `applySolvedFileOps(...)`                           | 应用（真正落盘）                     |
| `crossedMatterIds(...)`                             | 有没有跨案件                         |
| `isSameOrInside`、`measureTree`、`ScopedPathRef` 等 | 路径与体积工具                       |
| `formatAppliedLines`                                | 给律师看的「做了什么」               |

**「解算 / 应用」两段分离**是这个文件的核心设计：

- 解算阶段把所有校验做完（上限、路径、跨案件），**任何一条不合法就整体拒绝**。
- 应用阶段只做已经解算好的动作。

这和 `cross-document-edits.ts` 的「先全批预检再落笔」（第 44 章）是**同一个模式**。这个仓库在「批量改东西」这件事上反复用这个模式，理由一致：**做了一半比完全没做更难收拾。**

`crossedMatterIds` 单独存在，说明「跨案件」是一个需要显式识别的情况——搬材料到别的案件不是普通操作。

## 49.9 表格与图表：三个不能混的东西

| 工具                  | 实现                                               | 产出                                 |
| --------------------- | -------------------------------------------------- | ------------------------------------ |
| `analyze_spreadsheet` | `spreadsheet-tools.ts` + `xlsx-workbook.ts`        | 读表（列、类型、统计）               |
| `write_spreadsheet`   | 同上                                               | 写 xlsx（`MAX_XLSX_ROWS_PER_SHEET`） |
| `render_chart`        | `chart-tool.ts` + `chart-spec.ts` + `chart-svg.ts` | 出图（声明式规格 → SVG）             |

**`chart-spec.ts` 与 `chart-svg.ts` 是两个文件**：前者定义「图表规格长什么样」（模型填的），后者负责把规格渲染成 SVG。**模型不写 SVG**，它填规格。

`chart-tool.ts` 还导出 `LM_CHART_FENCE_HINT` 与 `persistChartSpec`——前者是给模型看的「怎么在正文里嵌入图表」的提示（用一个代码围栏标记），后者把规格落盘。

## 49.10 八组工具，一句话各是什么

按 `legal-tools.ts` 里注释的分组，把 66 个文件归一下位：

| 组           | 文件                                                                                                                                | 一句话                                        |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| 检索         | `search-tools.ts`、`search-authority.ts`、`precedent-search-tool.ts`                                                                | 工作区/案件/法源/类案/先例                    |
| 文件读写     | `file-tools.ts`、`list-dir-tool.ts`、`read-folder-documents-tool.ts`、`explore-folder-tool.ts`、`compare-documents.ts`              | 读、列、批量读、探查、对比                    |
| 本机         | `host-tools.ts`                                                                                                                     | 授权后的本机查找/读取/收进/命令               |
| 案件与工作台 | `matter-tools.ts`、`desk-tools.ts`                                                                                                  | 摘要/列案/读档案/加笔记 + 事件/期限/谈话/卷宗 |
| 材料整理     | `organize-materials-tool.ts`、`relocate-materials-tool.ts`、`workspace-file-ops-tool.ts`                                            | 提计划/执行/搬移/文件操作                     |
| 表格图表计算 | `spreadsheet-tools.ts`、`chart-tool.ts`、`calculate-tool.ts`、`run-compute-tool.ts`、`run-analysis-tool.ts`、`analysis-sandbox*.ts` | 见上两节                                      |
| 交付物       | `review-table-tool.ts`、`xlsx-workbook.ts`、`compute-deliverable.ts`                                                                | 审查表与核算产物                              |
| 邮件         | `mail-tools.ts`                                                                                                                     | 收件匣、附件、准备外发、发送                  |
| 流程与状态   | `list-more-tools.ts`、`update-plan-tool.ts`、`read-skill-tool.ts`、`audit-tools.ts`、`draft-worker-tool.ts`                         | 渐进披露、计划、技能、审计、并行写稿          |
| 引擎桥       | `engine/*.ts`（7 个）                                                                                                               | 五阶段流水线的工具化 + 模板 + 治理 + 跨文书   |

再加根目录四个：`lawmind-web-search.ts`、`lawmind-legal-web-search.ts`、`lawmind-url-dossier.ts`、`lawmind-deep-research.ts`（联网与研究），以及 `collaboration-tools.ts`（协作，实现在 `coordination/`）。

## 49.11 引擎桥工具（`engine/`）

七个文件，是「经典五阶段流水线」的工具化封装：

| 文件                                                           | 导出                                                                                                                     |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `engine-pipeline-tools.ts`                                     | `planTask`、`researchTask`、`updateDraft`、`applySurgicalEdits`、`draftDocument`、`renderDocument`、`renderTrackedDraft` |
| `engine-workflow-tool.ts`                                      | `executeWorkflow`                                                                                                        |
| `engine-template-tools.ts`                                     | `registerTemplate`、`listTemplates`、`setTemplateEnabled`                                                                |
| `engine-governance-tools.ts`                                   | `openWorkQueueItem`、`requestApprovalTool`、`recordDeadlineTool`、`appendSessionSummaryTool`                             |
| `engine-tool-shared.ts`                                        | 引擎工厂与检索适配器装配                                                                                                 |
| `engine-governance-shared.ts`                                  | 治理类共享                                                                                                               |
| `apply-surgical-edits-tool.ts`、`cross-document-edits-tool.ts` | 改稿工具（薄壳，调 `drafts/`）                                                                                           |

**注意 `engine-pipeline-tools.ts` 有 1570 行**——它在文件大小棘轮里登记着（冻结上限 1570）。这是全仓最大的工具文件之一，因为它把五个阶段的工具都放在一起。

**`apply-surgical-edits-tool.ts` 是薄壳**：真正的实现在 `drafts/apply-surgical-edits.ts`（第 44 章）。工具层只做参数处理与结果包装。

**这个「薄壳」模式很值得学**：算法在领域模块里、工具层只做适配。所以想测算法不用起工具，想测工具不用关心算法。

## 49.12 写一个新工具的清单

结合上面所有机制，一个完整的新工具要动这些地方：

```text
① 实现：src/lawmind/agent/tools/legal/<名字>.ts（或 engine/）
   - 常量还是工厂？需要本轮配置就写工厂
   - 参数校验用 asNonEmptyString 这类助手
   - 需要案件就写那两行三段式
   - 返回 { ok, data } 或 { ok: false, error }
② 注册：加进 legal-tools.ts 的 tools 数组（或 engineTools）
③ 名字集合：判断属不属于 tool-name-sets.ts 的五个集合
④ 披露：不该开局广告就给 governance.ts 的 DISCLOSED_TOOL_HINTS 加一条
⑤ 保留名：核心工具加进 reserved-tool-names.ts
⑥ 沙箱：会跑重活或写文件考虑加进 `dangerous-tool-policy.ts` 的名单
⑦ 治理元数据：governance.ts 会按集合自动推导，不用手工写
⑧ 测试：同目录 <名字>.test.ts
⑨ cassette：参与编排行为的要加断言（第 35 章）
```

**第 ⑦ 条容易被忽略**：治理元数据（风险级别、运行模式、案件范围）**大部分是自动推导的**（`resolveToolRiskLevel` / `resolveMatterScope` / `resolveRuntimeMode`），所以你把工具加进正确的集合就等于写好了治理信息。

## 49.13 已知坑（本章相关）

- **常驻工具与工厂工具的区别是「要不要本轮配置」。** 加工具前先想清楚。
- **协作工具的初始化是 best-effort。** 读不到助手档案不影响主链路。
- **`collaboration-tools.ts` 只是兼容 re-export**，实现在 `coordination/`。
- **`matterRequiredResult` 是结构化软失败**（带 `needsMatter` 与候选列表），不是纯报错。
- **四道围栏各管一段。** 第一道只看字面路径，符号链接要靠第二道。
- **分析沙箱是「客房」不是「牢房」。** 它不提供文件权限隔离。
- **沙箱关掉了字符串代码生成**，改它要注意别把这条路打开。
- **LPR / 牌价必须律师给。** 不要为了「方便」加自动获取。
- **`calculate` 是调度器，算法在 `labor/`、`litigation/` 等领域模块。**
- **worker 类工具的子会话看不到对话历史。** 任务书必须自包含，这是硬要求。
- **文件操作是「先解算后应用」。** 别把校验挪到应用阶段。
- **`engine-pipeline-tools.ts` 在文件大小棘轮里冻结着**，加东西要考虑拆。
- **改稿工具是薄壳。** 算法在 `drafts/`。
