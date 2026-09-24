# 第 5 章 工具与审批

这一章讲模型手上到底有哪些「手」，以及它伸手的时候谁会拦、怎么拦、留没留痕。

## 5.1 先说清楚「工具」是什么

模型自己不能读文件、不能算数、不能导出 Word。它能干的事只有一件：在回答里点一个名字，说「帮我调 `read_project_file`，参数是这些」。真正动手的是引擎里注册好的那些函数。这些函数就叫**工具**。

一个工具由三部分组成（定义在 `src/lawmind/agent/types.ts`）：

- `name`：模型调用时写的字符串，比如 `apply_surgical_edits`。
- `description` + `parameters`：写给模型看的使用说明和参数 schema。
- `execute`：真正执行的函数，吃参数、拿上下文、返回结果。

此外还有几个治理字段：`requiresApproval`（要不要律师点头）、`riskLevel`（风险级别）、`isConcurrencySafe`（能不能并发跑）。

关键的一点：**模型看得到的工具表，和它能不能调用某个工具，是两件事，但都归引擎管。** 模型只能在引擎给它的表里挑；挑了一个表外的名字，第一道中间件直接回一句「未知工具」。

## 5.2 律师侧：只有一件事会真的停下来问你

先说结论，省得你读半天找不到重点：

**唯一会真正打断律师、要求你在界面上点确认的，是「外发」。** 具体到工具名，就是 `send_email` 一个。

代码里的判定短得可以直接背下来（`src/lawmind/platform/lawyer-outbound-decision.ts`）：

```ts
export function toolRequiresLawyerPause(name?: string): boolean {
  return name?.trim() === "send_email";
}
```

别的都只是**审计分类**，不是交互闸门。这一点最容易误会，值得展开讲：

- `prepare_outbound_mail` 只是**写一封待发邮件**（草稿落盘），不发送。它不算闸门，审批发生在你看邮件的时候。
- `apply_surgical_edits`、`render_tracked_draft`、`draft_document`、`add_case_note`、`run_analysis`、`run_compute`、`execute_workflow` 这些名字看着挺吓人，但它们是**本地动作**：要么改工作区里自己的文件，要么生成产物。它们是写操作（会被记进审计），但不会弹卡片让你点。
- 这些工具在治理元数据里的 `runtimeMode` 是 `lawyer_approved_write`。这个字段的含义是「这个动作能改工作区状态或产出交付物，所以审批与审计上下文要保持可见」——它是**分类标签**，不是弹窗开关。

那什么时候会看到「待我拍板」？主要是三类：

1. 外发（`send_email`）。
2. 需要律师拍板的判断项（`judgment_escalation`，独立审稿给出的、规则判不了的条目）。
3. 案件级审批（`matter_approval`，比如交付物要谁签批）。

有些工具在特定场景下会要求澄清而不是审批，比如材料明显不够、指令冲突。这类走的是「澄清卡片」，不是「待我拍板」。

### 律师侧的操作路径

- 侧栏那个「待我拍板」按钮是**唯一入口**，点进去落在「在办」并聚焦到待决定的事。
- 审批卡片上通常有三种决定：批准、驳回、还要更多信息（`more_info`）。`decisions` 字段固定给这三个。
- 审批有 24 小时的有效期（`APPROVAL_TTL_MS = 24 * 60 * 60 * 1000`）。过期不会自己消失，但界面上会显示过期时间，别指望它自动批掉。
- 同一条审批会在同一个会话里**接着跑**：批准不是重新开始，而是把原来卡住的那个工具调用放行，然后从断点继续。

## 5.3 内行看门道：审批是「参数绑定」的

这里有个设计直接影响你会不会被反复问同一件事。

审批缓存的键长这样（`src/lawmind/agent/approval-cache-key.ts`）：

```ts
type ApprovalCacheKey = { tool: string; matterId: string; argsHash: string };
```

注意第三个字段。有两个工具是**按参数绑定的**：

```ts
export const ARGS_BOUND_APPROVAL_TOOLS = new Set(["apply_surgical_edits", "prepare_outbound_mail"]);
```

意思是：

- `apply_surgical_edits` 的 `find`/`replace` 对、`task_id`、合同基线路径，参与了哈希；换了内容，哈希就变，原来的批准**作废**。
- `prepare_outbound_mail` 只把**收件人**和**附件列表**算进哈希（`to` 和 `attachment_paths`），正文和主题不算。这么设计是因为「发给谁、带什么附件」才是真正需要律师看的东西；改几句话不该逼你重新点一遍。

其余工具按工具名匹配——批准过一次 `render_document`，同一会话同一案件里就不用反复点。

还有一条安全细节：`__approved` 这个标记是**服务端专用**的。模型就算在参数里自己塞一个 `__approved: true`，也会在处理之前被剥掉（`stableJson` 里显式丢弃这个键）。模型没法自己给自己开权限。

## 5.4 工具清单

工具分四层：核心常驻、按需披露、MCP 外部、协作。下面这张表是**按需披露清单**（`DISCLOSED_TOOL_HINTS`）的完整内容，也就是模型一开始看不到、但可以用 `list_more_tools` 打开的能力。

| 工具名                      | 引擎给的说明                                                      |
| --------------------------- | ----------------------------------------------------------------- |
| `execute_workflow`          | 按需启动确定性办案管线（检索→起草→审批）                          |
| `deep_research`             | 长时深度检索（联网开启时含公开网页）                              |
| `delegate_task`             | 把子任务交给另一位助手                                            |
| `render_tracked_draft`      | 导出带审阅痕迹的 Word                                             |
| `send_email`                | 发送已准备的外发邮件（须律师签批）                                |
| `write_document`            | 写入工作区普通文件（正式交件请用 `draft_document`）               |
| `list_mail_inbox`           | 查看本案邮件匣                                                    |
| `search_matter`             | 在本案卷宗里检索                                                  |
| `get_matter_summary`        | 查看案件摘要                                                      |
| `read_case_file`            | 阅读本案 CASE.md                                                  |
| `list_matters`              | 列出工作区案件                                                    |
| `add_case_note`             | 向 CASE.md 添加争点/风险/进展                                     |
| `record_deadline`           | 口播登记一项期限                                                  |
| `extract_legal_events`      | 从传票/短信抽出开庭与期限候选                                     |
| `apply_legal_events`        | 把有日期的期限写入工作台                                          |
| `compile_intake_brief`      | 整理谈话为结构化摘要                                              |
| `apply_intake_brief`        | 把谈话摘要写入本案档案                                            |
| `update_matter_profile`     | 更新卷宗案号/法院/当事人等                                        |
| `revert_desk_write`         | 撤销刚才一次档案写入                                              |
| `propose_organize_plan`     | 起草本案材料整理计划（先确认，不动文件）                          |
| `execute_organize_plan`     | 执行已确认的材料整理计划（可撤销）                                |
| `relocate_matter_materials` | 把材料搬移/复制到正确的案件卷（跨案件；修「材料放错案」，可撤销） |
| `apply_file_ops`            | 工作区内搬移/改名/复制文件或文件夹（不改内容、不删除，可撤销）    |
| `review_table_update`       | 编辑审查表：建模板/加行/批量改格/分组/从材料导入                  |
| `create_matter`             | 无关联案件时新建卷宗                                              |
| `list_templates`            | 查看可用文书模板                                                  |
| `notify_assistant`          | 会议室 / 同事通知                                                 |
| `plan_task`                 | 先拆步骤再执行                                                    |
| `search_workspace`          | 跨工作区检索材料                                                  |
| `search_conversations`      | 检索本机其他对话的要点与做法                                      |
| `read_conversation`         | 阅读某次历史对话里律师可见的发言                                  |
| `search_precedents`         | 检索本所旧案已签批交付物的可参照段落（需开启跨案检索）            |
| `search_host`               | 在本机文件夹或本机查找中定位材料                                  |
| `read_host_file`            | 阅读已授权的本机文件                                              |
| `list_dir`                  | 列举工作区或本机文件夹下的目录与文件（可递归）                    |
| `explore_folder`            | 只读探查文件夹：看清树、找出相关文件并摘录                        |
| `draft_worker`              | 并行写稿：按自包含任务书起草一节，父会话再汇总                    |
| `import_host_file`          | 把本机文件收进本案                                                |
| `run_host_command`          | 运行受控本机命令（须打开本机能力）                                |
| `compare_documents`         | 只读对比两份文件的文本差异                                        |
| `web_search`                | 联网检索公开网页                                                  |
| `search_statute_web`        | 官方法规站点优先的联网检索                                        |
| `url_dossier`               | 抓取律师给出的公开 URL 做成卷宗                                   |
| `analyze_spreadsheet`       | 分析钉选或工作区 Excel 的列、类型与统计                           |
| `write_spreadsheet`         | 把二维表写入本案或工作区交付目录下的 xlsx                         |
| `render_chart`              | 按声明式规格出图                                                  |
| `run_compute`               | 后台核算：当场写 JS 读文件/表格、批量整理、出表/图                |
| `run_analysis`              | 预置分析脚本（须政策开启）                                        |
| `read_skill`                | 按需读取索引里的技能正文                                          |
| `search_company_registry`   | 查企业登记；未接工商源时诚实标【待核实】                          |

**核心常驻的 12 个**（`CORE_MODEL_TOOL_NAMES`）是：`analyze_document`、`apply_surgical_edits`、`calculate`、`draft_document`、`prepare_outbound_mail`、`read_project_file`、`render_document`、`request_approval`、`research_task`、`search_case_law`、`search_statute`、`update_draft`。再加两个控制工具 `list_more_tools` 和 `update_plan`，构成模型开局就能看到的全部。

## 5.5 实现：注册表

`src/lawmind/agent/tools/registry.ts` 是个很薄的类：

```ts
register(tool); // 重名直接抛 Tool already registered
registerExternal(tool); // 先过 isReservedAgentToolName 检查，外部/MCP 不许占核心名字
get(name); // 取工具
listTools(); // 全部工具
listDefinitions(); // 全部定义（不带 execute）
listByCategory(cat); // 按 category 过滤
size(); // 数量
toOpenAITools({ names }); // 转成 OpenAI tools schema，按名字排序
```

`sorted by name` 不是随手写的：工具表顺序稳定，提示缓存才稳定。

**保留名字**在 `src/lawmind/agent/tools/reserved-tool-names.ts`，一共 25 个（`apply_surgical_edits`、`write_document`、`send_email`、`render_tracked_draft`、`draft_document`、`update_draft`、`prepare_outbound_mail`、`render_document`、`analyze_document`、`write_spreadsheet`、`render_chart`、`run_analysis`、`run_compute`、`calculate`、`execute_workflow`、`search_host`、`read_host_file`、`list_dir`、`explore_folder`、`draft_worker`、`import_host_file`、`run_host_command`、`relocate_matter_materials`、`apply_file_ops`、`update_plan`）。外部工具想注册这些名字，会直接抛：

```text
RESERVED_TOOL_NAME: <name> is implemented only by LawMind execute()
```

这条很重要：MCP 服务器**不能**顶替核心工具的实现。它能加新能力，但改不了 `send_email` 这类关键动作的语义。否则一个第三方 MCP 包就能悄悄把外发通道换成自己的。

## 5.6 实现：工具名分组

`src/lawmind/agent/tool-name-sets.ts` 是几个集合的单一出处（注意这个文件在 `agent/` 下，不在 `tools/` 下，容易找错）：

| 集合                    | 数量 | 作用                                                       |
| ----------------------- | ---- | ---------------------------------------------------------- |
| `WRITE_TOOLS`           | 36   | 会改工作区状态或产出交付物的工具；驱动审批和运行模式判定   |
| `MATTER_SCOPE_REQUIRED` | 15   | 没绑定案件就不许用；触发「请先选案件」的报错               |
| `BACKGROUND_JOB_TOOLS`  | 1    | 只有 `execute_workflow`，必须暴露 job 状态、可取消、有审计 |
| `IDEMPOTENT_READ_TOOLS` | 36   | 只读且可重放；决定重试策略                                 |
| `DESK_WRITE_TOOL_NAMES` | 11   | 写工作台的档案类工具；也是「对话补档案」那一波的核心       |

`MATTER_SCOPE_REQUIRED` 的 15 个是：`search_matter`、`read_case_file`、`add_case_note`、`get_matter_summary`、`list_mail_inbox`、`list_mail_attachments`、`apply_legal_events`、`compile_intake_brief`、`apply_intake_brief`、`update_matter_profile`、`revert_desk_write`、`propose_organize_plan`、`execute_organize_plan`、`relocate_matter_materials`、`apply_file_ops`。

没绑案件就调这些，会拿到这句：

```text
此工具需绑定案件：请在工作台选中案件，或在对话中指定案件后再继续。
```

## 5.7 实现：一次工具调用要过 18 道关

这是全仓库最「重」的一段代码：`src/lawmind/runtime/tool-pipeline.ts`。它是一条中间件链，顺序固定，任何一道拒绝，后面的都不执行。

我把顺序和每一道干的事列出来。**顺序本身是设计**，别随手调换。

| #   | 中间件                        | 干什么                                               | 拒绝时给什么                                                                 |
| --- | ----------------------------- | ---------------------------------------------------- | ---------------------------------------------------------------------------- |
| 1   | `unknownToolMiddleware`       | 名字不在注册表里就拒                                 | `未知工具：xxx。该工具未注册，请核对请求。`                                  |
| 2   | `budgetMiddleware`            | 本轮工具调用次数超上限就拒                           | `Tool budget exhausted (used N > max M)`                                     |
| 3   | `noTaskTurnGateMiddleware`    | 「没新指令」的回合（律师只发了单字或确认）不许写重活 | `NO_TASK_TURN_TOOL_ERROR` 那一整段                                           |
| 4   | `permissionModeMiddleware`    | 按只读/研究模式裁工具                                | 只读模式的完整说明文案（见 5.9）                                             |
| 5   | `discoveryLoopMiddleware`     | 防检索/列表空转                                      | `本轮检索/列表类工具已合计 N 次（上限 M）。<建议>`                           |
| 6   | `hostFileLoopMiddleware`      | 防本机文件读穿                                       | `本机查找/阅读已达本轮上限（…）。换一轮会重置；不要对未读材料按文件名推断。` |
| 7   | `roleAllowlistMiddleware`     | 岗位白名单 + 办件否决清单                            | `当前办件不能使用「xxx」。`                                                  |
| 8   | `matterScopeMiddleware`       | 需绑定案件却没绑                                     | 见上节那句                                                                   |
| 9   | `clarificationGateMiddleware` | 还有待澄清就不许起草/改稿/外发                       | 「仍有待澄清事项…」那整段                                                    |
| 10  | `folderExploreGateMiddleware` | 丢了文件夹但没先探查                                 | `请先探查文件夹（explore_folder…）`                                          |
| 11  | `approvalMiddleware`          | 审批闸门与风险上限                                   | `操作「xxx」需要律师在「待我拍板」中确认。`                                  |
| 12  | `argNormalizeMiddleware`      | 参数归一化                                           | —                                                                            |
| 13  | `argSchemaMiddleware`         | schema 校验，剥掉多余参数                            | `Invalid arguments for xxx: …` / 附带「已忽略未知参数」备注                  |
| 14  | `legalVerifyMiddleware`       | 外发预检 + 引用完整性后处理                          | 收件人不一致、引用对不上来源等                                               |
| 15  | `auditMiddleware`             | 记 `tool_call` 审计                                  | —                                                                            |
| 16  | `timeoutMiddleware`           | 超时与中断                                           | `Tool xxx timed out after Nms`                                               |
| 17  | `subprocessSandboxMiddleware` | 高风险工具丢子进程跑                                 | 沙箱不可用就直接拒绝执行                                                     |
| 18  | `executeMiddleware`           | 真正调用 `tool.execute`                              | `Tool error: …`                                                              |

顺序上的几点：

- **审批放在 schema 校验之前**（11 在 13 前面）。也就是说，一个参数还没校验的调用也能进审批队列。这样设计是为了让律师先看到「它想干什么」，而不是等校验完才排队。
- **审计包在执行外面**（15 在 18 前面）。但注意它的**写入时机是 `await next()` 之后**——`auditMiddleware` 会拿到工具结果，把 `ok` 与 `error` 一起写进 `tool_call` 事件（`tool-pipeline.ts:757-777`）。所以它记的是**这次调用的结果**，不是「发起过」。工具抛异常时它也会兜住并记 `ok: false`。
- **沙箱是最后一道**（17）。前面所有检查都在主进程做，只有真正执行才可能进子进程。

### 防空转的两条预算

`discoveryLoopMiddleware` 和 `hostFileLoopMiddleware` 是专门治「模型反复检索不出结果」的。它们不是简单限总数，而是**按工具分别限 + 总量限**：

- 单工具的限制是动态的。比如 `read_project_file` 允许 8 次，`search_workspace` 只允许 3 次。
- 总上限按上下文长度伸缩：`resolveDiscoveryLoopTotalCap(contextTokens) = min(32, max(8, ceil(contextTokens / 8000)))`。窗口越大，允许查得越多。
- 本机文件的单工具上限同理：`resolveHostFilePerToolLimit = min(48, max(12, ceil(contextTokens / 4096)))`。

被拦住时，回给模型的不是干巴巴的「超限」，而是一句**换个做法**的建议（`discoveryStopHint`）。比如在 Word 改稿场景里，提示会说「原 Word 已读过，别再读一遍」。

### 「没新指令」这道闸

`noTaskTurnGateMiddleware` 治的是一个很具体的毛病：律师只回了个「好」或者「嗯」，模型却开始大干一场。判定逻辑是：如果这个回合被判为不需要动手（`ctx.noTaskTurn === true`），那么凡是写重活的工具（`WRITE_TOOLS` 加上 `draft_worker`）和 `update_plan` 一律拒绝。

拒绝时给的那句话很有意思，直接把该怎么做告诉模型了：

```text
本轮没有新指令（律师只发了单字或确认），不能执行起草、改稿、渲染、完整工作流或外发。
请用一两句话回应律师；需要继续本件时，请律师明确说「继续」。
```

## 5.8 实现：风险分级与治理元数据

`src/lawmind/agent/tools/governance.ts` 给每个工具算一份治理元数据，`GET /api/tools/registry` 会把它吐出来。

风险级别（`resolveToolRiskLevel`）的算法很直白：

1. 工具自己声明了 `riskLevel` 就用它。
2. 否则，如果 `requiresApproval` 或者在 `WRITE_TOOLS` 里，算 `medium`。
3. 其余算 `low`。

运行模式（`runtimeMode`）三档：

- `background_job`：只有 `execute_workflow`。给的理由写在代码里：「长时间的法律工作必须暴露 job 状态、取消能力和审计轨迹。」
- `lawyer_approved_write`：写类工具。
- `readonly`：只读。

案件范围（`matterScope`）三档：`required`（在 `MATTER_SCOPE_REQUIRED` 里）、`optional`（参数里有 `matter_id`/`matterId`，或 category 是 `matter`/`draft`/`review`）、`not_applicable`。

另外两个字段：`idempotent` = 在 `IDEMPOTENT_READ_TOOLS` 里或运行模式是只读；`retryable` = 幂等且不是后台任务。

`listToolGovernanceMetadata(registry)` 按名字排序输出，供界面和测试消费。

## 5.9 实现：权限模式四档

`src/lawmind/agent/permission-mode.ts` 定义了四档：

| 模式       | 含义                                               |
| ---------- | -------------------------------------------------- |
| `standard` | 默认。正常干活                                     |
| `strict`   | 严格。危险工具一律要审批                           |
| `readonly` | 只读。只能看不能写                                 |
| `research` | 研究。只读工具加 `research_task` / `deep_research` |

只读模式允许的 32 个工具是一个白名单，包含各种 `search_*`、`read_*`、`list_*`、`analyze_document`、`compare_documents`、`calculate`、`update_plan` 等。研究模式就是在这个白名单上再加两个检索工具。

被拦住时给模型的说明写得挺实在，不是一句「权限不足」：

```text
当前权限模式为只读（readonly），不能使用「xxx」。请改用只读检索/分析工具收集材料；
确需起草、导出或外发时，请律师把权限模式切换为标准后再执行。
```

代码里有一条注释：**权限模式不是操作系统级的牢笼**。它拦的是「写」，读路径仍然靠 `isPathInsideRoot` 那条根围栏来兜。别以为切了只读就万事大吉。

另外，`noTaskTurn` 会把那一轮的工具表权限模式**强制**成 `readonly`。所以闲谈回合不但闸门拒写，连工具表里都不给写工具。

## 5.10 实现：沙箱子进程

`src/lawmind/runtime/tool-sandbox.ts` 负责把高风险工具丢进子进程跑。哪些算高风险由 `SUBPROCESS_SANDBOX_TOOL_NAMES` 决定（定义在 `src/lawmind/agent/dangerous-tool-policy.ts:18`，**七个**）：

```text
render_document          render_tracked_draft    execute_workflow
draft_document           add_case_note           run_analysis
run_compute
```

`read_project_file` 与 `analyze_document` **刻意留在主进程**——它们是只读、且延迟敏感，进子进程只会更慢（代码注释原话：`readonly, latency-sensitive`）。

开关有三态（`describeToolSandboxStatus`）：环境变量 `LAWMIND_TOOL_SANDBOX=1` → `{enabled:true, source:"env"}`；或者 `lawmind.policy.json` 里 `toolSandbox: true` → `{source:"policy"}`；都不是就是 `{enabled:false, source:"off"}`。

**这里有一条重要的安全设计：沙箱不可用时，绝不静默降级回主进程跑。**

```ts
// 找不到 runner 时
sandboxUnavailableResult("runner missing (<path>). Refusing in-process fallback.");
```

宁可拒绝执行，也不假装成功。理由是：如果沙箱是律师为了隔离风险特意开的，悄悄退回同进程执行等于把这道防线撤了，而律师毫不知情。

还有一个容易忽略的点：子进程的环境变量是**过滤过的**（`buildSandboxChildEnv`），会剥掉 API key 之类的秘密。所以子进程里的工具拿不到密钥——这是有意为之。

测试环境（`VITEST=true`）和显式设了 `LAWMIND_TOOL_SANDBOX_INLINE=1` 时会走 inline 模式，但那只是测试便利，不影响生产行为。

## 5.11 实现：外发预检

`src/lawmind/runtime/legal-verify-middleware.ts` 里有两条和服务端校验相关的检查，都跟外发有关：

- `precheckOutboundMail`：查收件人白名单（`outbound_recipient_gate`）和特权信息（`outbound_privilege_gate`）。收件人和短路径指定的不一致、或者域名不在本案允许范围，都会在**发之前**拦下来。
- `precheckOutboundSameTurnVerify`：同一回合内的验证结果检查。

只有 `prepare_outbound_mail` 会走外发预检（`OUTBOUND_PRECHECK_TOOLS`）。需要引用的交付物类型是 `memo.research`、`memo.opinion`、`memo.internal`、`contract.review` 四种（`STATUTE_TRIAL_DELIVERABLES`）。

被拦时的文案都是给律师看的，不是给模型看的，比如：

- `收件人与短路径指定的 <x> 不一致。`
- `发前需确认收件人：<domain> 不在本案允许域名内。`
- `引用对不上来源：… 不在本次检索结果中。请改正 citations 或重检索后重交，不要回复已完成。`
- `未接真源（演示语料或工作区启发式）。请勿把本节引用写成已核实法条。`

最后那句是条硬线：**没接真源的时候，系统会明说「这是演示语料」，不许模型把引用写成已核实。**

## 5.12 实现：审批的记录与恢复

「待我拍板」列表是拼出来的（`src/lawmind/platform/pending-tool-approvals.ts` + `apps/lawmind-desktop/server/lawmind-server-route-approvals.ts`）：

- `listPendingToolApprovals` 扫所有会话，挑出 `pendingRequiresAction` 里 `kind === "tool_approval"` 的，按创建时间倒序。
- 再和 `listApprovalRequests({status:"pending"})`（案件级审批）合并。
- 每条统一成 `UnifiedApprovalItem`：`{id, kind, title, summary, matterId?, sessionId?, toolName?, toolArgs?, riskLevel, createdAt, expiresAt, decisions}`。

风险等级的显示口径是写死的（`resolveToolApprovalRiskLevel`）：

- `send_email`、`prepare_outbound_mail` → **高**。
- `apply_surgical_edits`、`write_document`、`update_draft`、`execute_workflow` → **中**。
- 其余 → **低**。

外发类审批会额外带上推荐意见，文案是固定的：

```text
recommendation: 先核对收件人再发
rationale: 外发前请核对收件人、正文与附件。系统不会自动发送。
riskFlags: ["outbound"]
readyToUse: false
```

`readyToUse: false` 这个字段就是明确告诉界面：**别显示成「可以发了」**。

审批的六种「待办种类」（`LawMindRequiresActionKind`）：`clarification`、`tool_approval`、`matter_approval`、`workflow_blocked`、`judgment_escalation`、`continue_tools`。其中 `continue_tools` 是历史遗留（工具预算检查点已经取消），只在恢复旧会话时可能出现。

## 5.13 和「门禁分类」的关系

`src/lawmind/platform/gate-category.ts` 把所有门禁分成两类：**安全硬墙**和**判断软项**。

安全硬墙（`SAFETY_HARD_GATES`）有 7 个：`dangerous_tool_gate`、`approval_gate`、`acceptance_gate`、`redline_hunks_gate`、`surgical_span_gate`、`outbound_privilege_gate`、`outbound_recipient_gate`。

这个分类不是学术兴趣，它决定了两件事：

- 硬墙被触发时，律师不能点「我知道了继续」绕过去，必须真的解决问题。
- 软项（比如独立审稿给出的判断项）可以有「我不同意，照样出」的路径。

判断项的覆盖说明文案也定死了：

```text
本次机械核对 N 项，其中 M 项由确定性规则判定，K 项需您定夺。通过核对 ≠ 法律正确。
```

最后半句是刻意的。核对通过只说明规则没意见，不代表法律上是对的。

## 5.14 关键文件

| 关注点               | 文件                                                                                                                                                                |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 工具管线（18 道关）  | `src/lawmind/runtime/tool-pipeline.ts`                                                                                                                              |
| 注册表               | `src/lawmind/agent/tools/registry.ts`                                                                                                                               |
| 治理元数据           | `src/lawmind/agent/tools/governance.ts`                                                                                                                             |
| 工具名集合           | `src/lawmind/agent/tool-name-sets.ts`                                                                                                                               |
| 保留名               | `src/lawmind/agent/tools/reserved-tool-names.ts`                                                                                                                    |
| 危险工具与沙箱策略   | `src/lawmind/agent/dangerous-tool-policy.ts`                                                                                                                        |
| 权限模式             | `src/lawmind/agent/permission-mode.ts`                                                                                                                              |
| 外发判定             | `src/lawmind/platform/lawyer-outbound-decision.ts`                                                                                                                  |
| 审批缓存键           | `src/lawmind/agent/approval-cache-key.ts`                                                                                                                           |
| 外发预检与同回合验证 | `src/lawmind/runtime/legal-verify-middleware.ts`、`same-turn-verify.ts`                                                                                             |
| 沙箱                 | `src/lawmind/runtime/tool-sandbox.ts`、`tool-sandbox-child.ts`                                                                                                      |
| 待办与门禁分类       | `src/lawmind/platform/pending-tool-approvals.ts`、`requires-action.ts`、`gate-category.ts`                                                                          |
| 后台任务             | `src/lawmind/platform/automation-from-work.ts`、`apps/lawmind-desktop/server/lawmind-server-jobs.ts`                                                                |
| HTTP                 | `apps/lawmind-desktop/server/lawmind-server-route-approvals.ts`、`-tools-registry.ts`、`-action-summary.ts`                                                         |
| 桌面 UI              | `apps/lawmind-desktop/src/renderer/LawmindApprovalQueue.tsx`、`LawmindApprovalRequestHost.tsx`、`LawmindJudgmentItemsPanel.tsx`、`stores/approval-request-store.ts` |

## 5.15 已知坑

- **别把 `lawyer_approved_write` 当成会弹窗。** 它只是分类。真正弹窗的只有 `send_email`。
- `MATTER_SCOPE_REQUIRED` 和 `MATTER_SCOPED_TOOL_NAMES` 是同一个集合的两个名字（后者是 `tool-pipeline.ts` 里的别名）。改一个记得看另一个。
- 中间件顺序不要动。尤其是「审批在 schema 之前」「审计在执行之前」这两条，换位置会改变行为。
- `shouldCheckpointToolBudget` 现在恒返回 `false`。看到 `continue_tools` 相关代码，先确认是不是在为旧会话做兼容。
- 沙箱缺失时的行为是**拒绝**，不是降级。如果你在排查「某个工具报 SANDBOX_UNAVAILABLE」，去看 runner 路径和 `LAWMIND_TOOL_SANDBOX`，别去改工具本身。
- `send_email` 机械暂停这条线在 Word 插件回合里也生效：插件的预批准名单只含 `apply_surgical_edits` 和 `render_tracked_draft`，**刻意不含** `prepare_outbound_mail`，且 Word 回合里 `render_document` 被工具自身拒绝。
