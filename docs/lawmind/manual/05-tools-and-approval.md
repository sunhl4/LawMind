# 第 5 章 工具与审批

这一章讲模型手上到底有哪些「手」，以及它伸手的时候谁会拦、怎么拦、留没留痕。

## 5.1 先说清楚「工具」是什么

模型自己不能读文件、不能算数、不能导出 Word。它能干的事只有一件：在回答里点一个名字，说「帮我调 `read_project_file`，参数是这些」。真正动手的是引擎里注册好的那些函数。这些函数就叫**工具**。

一个工具由三部分组成（定义在 `src/lawmind/agent/types.ts`）：

- `name`：模型调用时写的字符串，比如 `apply_surgical_edits`。
- `description` + `parameters`：写给模型看的使用说明和参数 schema。
- `execute`：真正执行的函数，吃参数、拿上下文、返回结果。

此外还有几个治理字段：`requiresApproval`（定义上的声明；`render_chart`、`write_spreadsheet`、`run_analysis`、`register_template`、`set_template_enabled` 这几个写了 `true`）、`riskLevel`（风险级别）、`isConcurrencySafe`（能不能并发跑）。

但治理元数据（`GET /api/tools/registry` 吐的那份）里的 `requiresApproval` **不看定义字段**，只看 `toolRequiresLawyerPause`——而自 2026-10-01 起它恒为 `false`（见 5.2）。所以设置页「需批准」一栏现在是全 `false`：没有任何工具会在管线里停下来等律师，外发走「待发信」。

关键的一点：**模型看得到的工具表，和它能不能调用某个工具，是两件事，但都归引擎管。** 模型只能在引擎给它的表里挑；挑了一个表外的名字，第一道中间件直接回一句「未知工具」。

## 5.2 律师侧：外发是唯一硬闸门，但它不再打断回合

先说结论，省得你读半天找不到重点：

**外发仍是唯一硬闸门，但闸门不在管线里。** 自 2026-10-01 起没有任何工具会暂停回合等你点确认：`send_email` 和 `prepare_outbound_mail` 都只是把邮件写入本案「待发信」，回合照常完成；律师在案件页 / 待发列表核对后点「批准发送」才真正发出（走 `/api/automations/inbox/:id/action` 的 `approve_send`，直接发送，不恢复回合）。

代码里的判定短得可以直接背下来（`src/lawmind/platform/lawyer-outbound-decision.ts`）：

```ts
export function toolRequiresLawyerPause(name?: string | null): boolean {
  return irreversibleDisposition(name) === "pause";
}
```

`IRREVERSIBLE_TOOLS`（`src/lawmind/agent/tool-name-sets.ts`）里**没有任何工具的处置是 `pause`**，所以这个函数恒为 `false`——保留它只为让审批中间件与风险上限的调用点不必按名特判。现有的两档处置：

- `inbox_signoff`：`send_email`、`prepare_outbound_mail`。写入本案「待发信」，律师在待发列表点「批准发送」才发出。
- `deny_at_source`：`delete_matter`、`render_document`。在场景或工具内部硬拒（比如 Word 改稿回合里 `render_document` 被工具自身拒绝，见 5.15），不靠审批卡。

`send_email` 的执行体也是这个口径：没有批准旗标时写入交办收件箱条目和待发队列，直接返回 `ok: true`，并告诉模型「请直接完成本轮回复，不要等待批准」。`__approved === true` 那条立即发送的分支只服务旧会话遗留的「待我拍板」恢复路径。

别的都只是**审计分类**，不是交互闸门。这一点最容易误会，值得展开讲：

- `prepare_outbound_mail` 只是**写一封待发邮件**（草稿落盘），不发送。它不算闸门，审批发生在你看邮件的时候。
- `apply_surgical_edits`、`render_tracked_draft`、`draft_document`、`add_case_note`、`run_analysis`、`run_compute`、`execute_workflow` 这些名字看着挺吓人，但它们是**本地动作**：要么改工作区里自己的文件，要么生成产物。它们是写操作（会被记进审计），但不会弹卡片让你点。
- 这些工具在治理元数据里的 `runtimeMode` 是 `lawyer_approved_write`。这个字段的含义是「这个动作能改工作区状态或产出交付物，所以审批与审计上下文要保持可见」——它是**分类标签**，不是弹窗开关。

那什么时候会看到「待我拍板」？主要是四类：

1. 待发信（外发核对，点「批准发送」）。
2. 需要律师拍板的判断项（`judgment_escalation`，独立审稿给出的、规则判不了的条目）。
3. 案件级审批（`matter_approval`，比如交付物要谁签批）。
4. 澄清（不问完办不下去；走「澄清卡片」）。

旧会话里还可能躺着 `tool_approval` 卡——那是 2026-10-01 之前的外发暂停留下的；新回合不再产生（审批中间件的 Ask 条件恒不成立，见 5.7 第 15 道），但恢复路径还在，批了会接着跑。

有些工具在特定场景下会要求澄清而不是审批，比如材料明显不够、指令冲突。这类走的是「澄清卡片」，不是「待我拍板」。

### 律师侧的操作路径

- 侧栏那个「待我拍板」按钮是**唯一入口**，点进去落在「在办」并聚焦到待决定的事。
- 审批中心（HTTP 层的 `UnifiedApprovalItem`）的 `decisions` 固定给三种：批准、驳回、还要更多信息（`more_info`）。会话内卡片的 `decisions` 按种类给：`tool_approval` / `matter_approval` 是 `approve` / `reject`，澄清是 `respond`，判断升级是 `respond` / `edit`。
- 审批有 24 小时的有效期（`APPROVAL_TTL_MS = 24 * 60 * 60 * 1000`，服务端路由给每条算出 `expiresAt`）。过期不会自己消失，但界面上会显示过期时间，别指望它自动批掉。
- 旧会话卡住的 `tool_approval` 在同一条会话里**接着跑**：批准不是重新开始，而是注入 `__approved` 把原来卡住的那个工具调用放行，然后从断点继续。

## 5.3 内行看门道：审批是「参数绑定」的

这里有个设计直接影响你会不会被反复问同一件事。

审批缓存的键长这样（`src/lawmind/agent/approval-cache-key.ts`）：

```ts
type ApprovalCacheKey = { tool: string; matterId: string; argsHash: string };
```

注意第三个字段。有三个工具是**按参数绑定的**：

```ts
export const ARGS_BOUND_APPROVAL_TOOLS = new Set([
  "apply_surgical_edits",
  "prepare_outbound_mail",
  "send_email",
]);
```

意思是：

- `apply_surgical_edits` 的 `find`/`replace` 对、`task_id`、合同基线路径，参与了哈希；换了内容，哈希就变，原来的批准**作废**。
- `prepare_outbound_mail` 只把**收件人**和**附件列表**算进哈希（`to` 和 `attachment_paths`），正文和主题不算。它还不发送，改几句话不该逼律师重看一遍。
- `send_email` 把**收件人、主题、正文、附件、案件 id** 都算进哈希。名单里只写了工具名，或这几项对不上（包括换了一个案件），这条名单放行不了。
- 律师在「待我拍板」里点批准是另一条路：下一次同名调用会**整包换成卡片上的参数**再发。模型临时改的收件人或正文不会混进去，这次替换也不会再弹一张卡片。

其余工具按工具名匹配。本地写（改稿、导出、记档案）本来就不会弹卡片。

还有一条安全细节：`__approved` 这个标记是**服务端专用**的。模型就算在参数里自己塞一个 `__approved: true`，也会在处理之前被剥掉（`stableJson` 里显式丢弃这个键）。模型没法自己给自己开权限。

## 5.4 工具清单

先说注册表一共挂多少个（`createLegalToolRegistry`，`src/lawmind/agent/tools/legal-tools.ts`）：**默认静态 72 个**——56 个检索/案件/桌面/文书/邮件/审计/元工具（含 `deep_research`）加 16 个 engine 工具。开联网（`allowWebSearch`）再加 3 个（`web_search`、`search_statute_web`、`url_dossier`）；开协作（`enableCollaboration`）再加 7 个（`delegate_task`、`delegate_to_role`、`consult_assistant`、`notify_assistant`、`request_review`、`list_delegations`、`get_delegation_result`）；两个开关都开是 **82 个**。MCP 服务器的工具以 `mcp__<server>__<tool>` 前缀另挂同一张表，不占这个数。

模型侧分四层看：核心常驻、本轮自动广告、仍要 `list_more_tools` 或原话条件的能力、MCP 外部。下面这张表是 `DISCLOSED_TOOL_HINTS` 的说明文案（53 条，`src/lawmind/agent/tools/governance.ts`）。其中一批（工作区检索、列目录、技能正文、档案写穿等）由 `mergeTurnDisclosedToolNames` **每轮直接广告**，不必先点名。真正仍要 `list_more_tools` 或原话条件的，是外发、深度检索、联网、MCP 和多数协作工具。哪一层在什么时候出现，见第 23.0 节。

| 工具名                      | 引擎给的说明                                                      |
| --------------------------- | ----------------------------------------------------------------- |
| `execute_workflow`          | 按需启动确定性办案管线（检索→起草→审批）                          |
| `deep_research`             | 长时深度检索（联网开启时含公开网页）                              |
| `delegate_task`             | 名册上的委派。拆本对话的并行任务用 draft_worker，不要用这个       |
| `digest_materials`          | 一次分头读很多份材料，只交回要点卡片                              |
| `render_tracked_draft`      | 导出带审阅痕迹的 Word                                             |
| `send_email`                | 发送已准备的外发邮件（须律师签批）                                |
| `write_document`            | 写入工作区普通文件（正式交件请用 draft_document）                 |
| `list_mail_inbox`           | 查看本案邮件匣                                                    |
| `search_matter`             | 在本案卷宗里检索                                                  |
| `get_matter_summary`        | 查看案件摘要                                                      |
| `read_case_file`            | 阅读本案 CASE.md                                                  |
| `list_matters`              | 列出工作区案件                                                    |
| `add_case_note`             | 向 CASE.md 添加争点/风险/进展                                     |
| `record_deadline`           | 口播登记一项期限                                                  |
| `record_obligation`         | 记下一条付款、通知或履约义务                                      |
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
| `create_matter`             | 无关联案件时新建卷宗；同名已有则并入，不另造 -2                   |
| `delete_matter`             | 删除律师点名的用户卷宗（案件列表和材料一起删；有材料须明确同意）  |
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
| `draft_worker`              | 长任务写稿：一支要自己连读连查再写，父会话再汇总                  |
| `import_host_file`          | 把本机文件收进本案                                                |
| `run_host_command`          | 运行受控本机命令                                                  |
| `compare_documents`         | 只读对比两份文件的文本差异                                        |
| `web_search`                | 联网检索公开网页                                                  |
| `search_statute_web`        | 官方法规站点优先的联网检索                                        |
| `url_dossier`               | 抓取律师给出的公开 URL 做成卷宗                                   |
| `analyze_spreadsheet`       | 分析钉选或工作区 Excel 的列、类型与统计                           |
| `write_spreadsheet`         | 把二维表写入本案或工作区交付目录下的 xlsx                         |
| `render_chart`              | 按声明式规格出图（助手正文用 lm-chart 围栏）                      |
| `run_compute`               | 后台核算：当场写 JS 读文件/表格、批量整理、出表/图，律师只看交件  |
| `run_analysis`              | 预置分析脚本（默认可用；离线时关闭）                              |
| `read_skill`                | 按需读取索引里的技能正文                                          |
| `search_company_registry`   | 查企业登记；未接工商源时诚实标【待核实】                          |

**核心常驻的 12 个**（`CORE_MODEL_TOOL_NAMES`）是：`analyze_document`、`apply_surgical_edits`、`calculate`、`draft_document`、`prepare_outbound_mail`、`read_project_file`、`render_document`、`request_approval`、`research_task`、`search_case_law`、`search_statute`、`update_draft`。再加 `list_more_tools` 和 `update_plan`。这 14 个是目录层，不是模型这一轮的全部：本轮自动广告的名字见第 23.0 节。

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

**保留名字**在 `src/lawmind/agent/tools/reserved-tool-names.ts`，一共 26 个（`apply_surgical_edits`、`write_document`、`send_email`、`render_tracked_draft`、`draft_document`、`update_draft`、`prepare_outbound_mail`、`render_document`、`analyze_document`、`write_spreadsheet`、`render_chart`、`run_analysis`、`run_compute`、`calculate`、`execute_workflow`、`search_host`、`read_host_file`、`list_dir`、`explore_folder`、`digest_materials`、`draft_worker`、`import_host_file`、`run_host_command`、`relocate_matter_materials`、`apply_file_ops`、`update_plan`）。外部工具想注册这些名字，会直接抛：

```text
RESERVED_TOOL_NAME: <name> is implemented only by LawMind execute()
```

这条很重要：MCP 服务器**不能**顶替核心工具的实现。它能加新能力，但改不了 `send_email` 这类关键动作的语义。否则一个第三方 MCP 包就能悄悄把外发通道换成自己的。

## 5.6 实现：工具名分组

`src/lawmind/agent/tool-name-sets.ts` 是几个集合的单一出处（注意这个文件在 `agent/` 下，不在 `tools/` 下，容易找错）：

| 集合                    | 数量 | 作用                                                       |
| ----------------------- | ---- | ---------------------------------------------------------- |
| `WRITE_TOOLS`           | 38   | 会改工作区状态或产出交付物的工具；驱动审批和运行模式判定   |
| `MATTER_SCOPE_REQUIRED` | 16   | 没绑定案件就不许用；触发「请先选案件」的报错               |
| `BACKGROUND_JOB_TOOLS`  | 1    | 只有 `execute_workflow`，必须暴露 job 状态、可取消、有审计 |
| `IDEMPOTENT_READ_TOOLS` | 36   | 只读且可重放；决定重试。没标并发时，也决定能否并行         |
| `DESK_WRITE_TOOL_NAMES` | 13   | 写工作台的档案类工具；也是「对话补档案」那一波的核心       |

`MATTER_SCOPE_REQUIRED` 的 16 个是：`search_matter`、`read_case_file`、`add_case_note`、`get_matter_summary`、`list_mail_inbox`、`list_mail_attachments`、`apply_legal_events`、`compile_intake_brief`、`apply_intake_brief`、`update_matter_profile`、`revert_desk_write`、`propose_organize_plan`、`execute_organize_plan`、`relocate_matter_materials`、`apply_file_ops`、`delete_matter`。

没绑案件就调这些，会拿到这句：

```text
此工具需绑定案件：请在工作台选中案件，或在对话中指定案件后再继续。
```

## 5.7 实现：一次工具调用要过 19 道关

这是全仓库最「重」的一段代码：`src/lawmind/runtime/tool-pipeline.ts`。它是一条中间件链（`buildDefaultToolPipeline`），顺序固定，任何一道拒绝，后面的都不执行。

我把顺序和每一道干的事列出来。**顺序本身是设计**，别随手调换。

| #   | 中间件                        | 干什么                                                                                             | 拒绝时给什么                                                                 |
| --- | ----------------------------- | -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| 1   | `unknownToolMiddleware`       | 名字不在注册表里就拒                                                                               | `未知工具：xxx。该工具未注册，请核对请求。`                                  |
| 2   | `budgetMiddleware`            | 本轮工具调用次数超上限就拒                                                                         | `Tool budget exhausted (used N > max M)`                                     |
| 3   | `noTaskTurnGateMiddleware`    | 「没新指令」的回合（律师只发了单字或确认）不许写重活                                               | `NO_TASK_TURN_TOOL_ERROR` 那一整段                                           |
| 4   | `permissionModeMiddleware`    | 按只读/研究模式裁工具                                                                              | 只读模式的完整说明文案（见 5.9）                                             |
| 5   | `discoveryLoopMiddleware`     | 防检索/列表空转                                                                                    | `本轮检索/列表类工具已合计 N 次（上限 M）。<建议>`                           |
| 6   | `hostFileLoopMiddleware`      | 防本机文件读穿                                                                                     | `本机查找/阅读已达本轮上限（…）。换一轮会重置；不要对未读材料按文件名推断。` |
| 7   | `roleAllowlistMiddleware`     | 岗位白名单 + 办件否决清单                                                                          | `当前办件不能使用「xxx」。`                                                  |
| 8   | `matterScopeMiddleware`       | 需绑定案件却没绑                                                                                   | 见上节那句                                                                   |
| 9   | `clarificationGateMiddleware` | `clarificationBlockingHeavyTools` 为真时不许起草/改稿/外发；`runTurn` 恒置 false，聊天回合实际不拦 | 「仍有待澄清事项…」那整段                                                    |
| 10  | `folderExploreGateMiddleware` | 保留在链上，不再因文件夹拒写。先读再改由模型排                                                     | —                                                                            |
| 11  | `argNormalizeMiddleware`      | 参数归一化                                                                                         | —                                                                            |
| 12  | `argSchemaMiddleware`         | schema 校验，剥掉多余参数                                                                          | `Invalid arguments for xxx: …` / 附带「已忽略未知参数」备注                  |
| 13  | `legalVerifyMiddleware`       | 外发预检在进审批前；引用核对在执行返回后                                                           | 收件人不一致、引用对不上来源等                                               |
| 14  | `actionPreReviewMiddleware`   | 动作级审前评审：默认 off 直接透传；`shadow` 只记影子日志；`on` 时对 `run_host_command` 加问        | 「本机命令可能改动文件或状态，须律师确认」（`approval_gate`）                |
| 15  | `approvalMiddleware`          | 审批仲裁与风险上限；2026-10-01 起无 `pause` 工具，Ask 实际不触发                                   | `操作「xxx」需要律师在「待我拍板」中确认。`（保留路径）                      |
| 16  | `auditMiddleware`             | 记 `tool_call` 审计                                                                                | —                                                                            |
| 17  | `timeoutMiddleware`           | 超时与中断                                                                                         | `Tool xxx timed out after Nms`                                               |
| 18  | `subprocessSandboxMiddleware` | 高风险工具丢子进程跑                                                                               | 沙箱不可用就直接拒绝执行                                                     |
| 19  | `executeMiddleware`           | 真正调用 `tool.execute`                                                                            | `Tool error: …`                                                              |

顺序上的几点：

- **参数先校验，再做外发预检，再进审前评审与审批仲裁**（11–13 在 14、15 前面）。缺字段退回模型；收件人域名或特权信息不过关，也不进「待我拍板」。律师只看能发出去的那一次。
- **审批仲裁有固定优先级**（`src/lawmind/platform/approval-arbitration.ts`）：`denied → block → askFirst → allowAutomatically →（都没说）ask`。拒绝/硬拦永远优先于放行；两边都没说时默认 ask（宁可多问一次）。管线顺序本身已保证 deny/block 的中间件排在 approval 之前，这个纯函数只是把语义钉死，防后人把 Allow 接到 Deny 前。
- **审计包在执行外面**（16 在 19 前面）。但注意它的**写入时机是 `await next()` 之后**——`auditMiddleware` 会拿到工具结果，把 `ok` 与 `error` 一起写进 `tool_call` 事件。所以它记的是**这次调用的结果**，不是「发起过」。工具抛异常时它也会兜住并记 `ok: false`。
- **沙箱在执行前最后一道**（18）。前面所有检查都在主进程做，只有真正执行才可能进子进程。

### 第 14、15 道为什么现在「不拦」

`actionPreReviewMiddleware` 是动作级审前评审（`src/lawmind/platform/action-pre-review.ts`），由 `LAWMIND_ACTION_PRE_REVIEW` 切三档：`off`（默认，直接透传）、`shadow`（只把「开着的话会不会问」记成影子日志）、`on`（对本层拥有的高风险本机动作加问——目前只有 `run_host_command`；外发不在它名下，外发只写待发信，发送另有批准）。

`approvalMiddleware` 的 Ask 条件是 `toolRequiresExplicitApproval`，它先看 `toolRequiresLawyerPause`——恒为 `false`，所以整支早退；风险上限那条（岗位 `riskCeiling` 超标）也同样挂在 `toolRequiresLawyerPause` 上，不触发。两道都还在链上：一个是可开的评审闸，一个是防回归的仲裁点。

### 防空转的两条预算

`discoveryLoopMiddleware` 和 `hostFileLoopMiddleware` 是专门治「模型反复检索不出结果」的。它们不是简单限总数，而是**按工具分别限 + 总量限**：

- 单工具的限制是动态的。比如 `read_project_file` 允许 8 次，`search_workspace` 只允许 3 次。
- 总上限按上下文长度伸缩：`resolveDiscoveryLoopTotalCap(contextTokens) = min(32, max(8, ceil(contextTokens / 8000)))`。窗口越大，允许查得越多。
- 本机文件的单工具上限同理：`resolveHostFilePerToolLimit = min(48, max(12, ceil(contextTokens / 4096)))`（未知窗口兜底 24）。这本账里还有合计硬顶 `fileTaskReadHardCap`（本机访问策略，默认 32）；有项目目录 / 挂载 / 目录钉时，`analyze_document` 和 `read_project_file` 也进这本账。

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

风险级别（`resolveToolRiskLevel`）的算法：

1. 工具自己声明了 `riskLevel` 就用它。`send_email` 声明的是 `high`。
2. 否则，如果定义写了 `requiresApproval` 或者在 `WRITE_TOOLS` 里，算 `medium`。
3. 其余算 `low`。

治理元数据里的 `requiresApproval` **不等于**定义上的同名字段，也 **不等于** `lawyer_approved_write`。它只回答「这次调用会不会停下来等律师」，实现是 `toolRequiresLawyerPause`——2026-10-01 起恒为 `false`，所以这份元数据里没有任何工具的 `requiresApproval` 是 `true`。本地写仍是 `lawyer_approved_write`，但 `requiresApproval` 为 `false`。

运行模式（`runtimeMode`）三档：

- `background_job`：只有 `execute_workflow`。给的理由写在代码里：「长时间的法律工作必须暴露 job 状态、取消能力和审计轨迹。」
- `lawyer_approved_write`：写类工具。
- `readonly`：只读。

案件范围（`matterScope`）三档：`required`（在 `MATTER_SCOPE_REQUIRED` 里）、`optional`（参数里有 `matter_id`/`matterId`，或 category 是 `matter`/`draft`/`review`）、`not_applicable`。

另外两个字段：`idempotent` = 在 `IDEMPOTENT_READ_TOOLS` 里或运行模式是只读；`retryable` = 幂等且不是后台任务。

`listToolGovernanceMetadata(registry)` 按名字排序输出，供界面和测试消费。

## 5.9 实现：权限模式四档

`src/lawmind/agent/permission-mode.ts` 定义了四档：

| 模式       | 含义                                                                                                                                                                                             |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `standard` | 默认。正常干活。外发不打断回合：写本案「待发信」，律师在待发列表点「批准发送」才发出                                                                                                             |
| `strict`   | 工具表与 `standard` 相同，不额外冻结写工具。历史差别是「即使开了危险工具免审批，`send_email` 仍要停」；2026-10-01 起没有 `pause` 工具，`strict` 在管线上与 `standard` 行为相同，只保留为部署语义 |
| `readonly` | 只读。只能看不能写                                                                                                                                                                               |
| `research` | 研究。只读工具加 `research_task` / `deep_research`                                                                                                                                               |

只读模式允许的 33 个工具是一个白名单，包含各种 `search_*`、`read_*`、`list_*`、`analyze_document`、`compare_documents`、`calculate`、`update_plan` 等。研究模式就是在这个白名单上再加两个检索工具。

被拦住时给模型的说明写得挺实在，不是一句「权限不足」：

```text
当前权限模式为只读（readonly），不能使用「xxx」。请改用只读检索/分析工具收集材料；
确需起草、导出或外发时，请律师把权限模式切换为标准后再执行。
```

代码里有一条注释：**权限模式不是操作系统级的牢笼**。它拦的是「写」，读路径仍然靠 `isPathInsideRoot` 那条根围栏来兜。别以为切了只读就万事大吉。

另外，`noTaskTurn` 会把那一轮的工具表权限模式**强制**成 `readonly`。所以闲谈回合不但闸门拒写，连工具表里都不给写工具。

## 5.10 实现：沙箱子进程

`src/lawmind/runtime/tool-sandbox.ts` 负责把高风险工具丢进子进程跑。哪些算高风险由 `SUBPROCESS_SANDBOX_TOOL_NAMES` 决定（定义在 `src/lawmind/agent/dangerous-tool-policy.ts`，**七个**）：

```text
render_document          render_tracked_draft    execute_workflow
draft_document           run_analysis            run_compute
run_host_command
```

`read_project_file`、`analyze_document`、`add_case_note` **留在主进程**。前两个只读且怕延迟；`add_case_note` 只是往 CASE.md 追加一小节，不是在跑不受信代码。真正要隔开的是会执行脚本或本机命令的工具，所以 `run_host_command` 在沙箱开启时进子进程，档案补记不进。Codex / Claude Code 的沙箱也是罩命令执行，不罩一次本地记笔记。

开关只有两态（`describeToolSandboxStatus`）：环境变量 `LAWMIND_TOOL_SANDBOX=1` → `{enabled:true, source:"env"}`；否则就是 `{enabled:false, source:"off"}`。`lawmind.policy.json` 的 `toolSandbox` 字段已被商业策略合同拒绝，不再读取。

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

`prepare_outbound_mail` 和 `send_email` 都会走外发预检（`OUTBOUND_PRECHECK_TOOLS`）。预检在审批之前：域名不在允许范围，或正文带特权信息，卡片出不来。待发信拦一次，真正发送再拦一次，不能靠换工具名绕开。需要引用的交付物类型起算是 `memo.research`、`memo.opinion`、`memo.internal`、`contract.review`，另外 `letter.*`、`litigation.*`、`contract.*` 前缀同样要过引用核对。引用核对发生在工具返回之后，不挡审批卡片。

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

审批的六种「待办种类」（`LawMindRequiresActionKind`）：`clarification`、`tool_approval`、`matter_approval`、`workflow_blocked`、`judgment_escalation`、`continue_tools`。其中 `continue_tools` 有三个来源（`trigger`）：`interrupted`（上一轮被中断）、`delivery`（稿还没交完）、`step_budget`（旧预算检查点；`shouldCheckpointToolBudget` 恒返回 `false`，新回合不再产生，只在旧会话里见得到）。

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
| 工具管线（19 道关）  | `src/lawmind/runtime/tool-pipeline.ts`                                                                                                                              |
| 注册表               | `src/lawmind/agent/tools/registry.ts`                                                                                                                               |
| 治理元数据           | `src/lawmind/agent/tools/governance.ts`                                                                                                                             |
| 工具名集合           | `src/lawmind/agent/tool-name-sets.ts`                                                                                                                               |
| 保留名               | `src/lawmind/agent/tools/reserved-tool-names.ts`                                                                                                                    |
| 危险工具与沙箱策略   | `src/lawmind/agent/dangerous-tool-policy.ts`                                                                                                                        |
| 权限模式             | `src/lawmind/agent/permission-mode.ts`                                                                                                                              |
| 外发判定             | `src/lawmind/platform/lawyer-outbound-decision.ts`                                                                                                                  |
| 审批仲裁与动作级审前 | `src/lawmind/platform/approval-arbitration.ts`、`action-pre-review.ts`                                                                                              |
| 审批缓存键           | `src/lawmind/agent/approval-cache-key.ts`                                                                                                                           |
| 外发预检与同回合验证 | `src/lawmind/runtime/legal-verify-middleware.ts`、`same-turn-verify.ts`                                                                                             |
| 沙箱                 | `src/lawmind/runtime/tool-sandbox.ts`、`tool-sandbox-child.ts`                                                                                                      |
| 待办与门禁分类       | `src/lawmind/platform/pending-tool-approvals.ts`、`requires-action.ts`、`gate-category.ts`                                                                          |
| 后台任务             | `src/lawmind/platform/automation-from-work.ts`、`apps/lawmind-desktop/server/lawmind-server-jobs.ts`                                                                |
| HTTP                 | `apps/lawmind-desktop/server/lawmind-server-route-approvals.ts`、`-tools-registry.ts`、`-action-summary.ts`、`-automations.ts`（待发信 `approve_send`）             |
| 桌面 UI              | `apps/lawmind-desktop/src/renderer/LawmindApprovalQueue.tsx`、`LawmindApprovalRequestHost.tsx`、`LawmindJudgmentItemsPanel.tsx`、`stores/approval-request-store.ts` |

## 5.15 已知坑

- **别把 `lawyer_approved_write` 当成会弹窗。** 它只是分类。2026-10-01 起没有任何工具会弹窗打断回合——外发（`send_email` / `prepare_outbound_mail`）写入本案「待发信」，律师在待发列表点「批准发送」才发出；管线里的审批卡只剩旧会话遗留的恢复路径。
- `MATTER_SCOPE_REQUIRED` 和 `MATTER_SCOPED_TOOL_NAMES` 是同一个集合的两个名字（后者是 `tool-pipeline.ts` 里的别名）。改一个记得看另一个。
- 中间件顺序不要动。尤其是「先校验参数，再做外发预检，再进审前评审与审批」「审计包在执行外面、写入在 `next()` 之后」这两条。
- `requiresApproval` 在治理元数据里 = `toolRequiresLawyerPause`，目前恒为 `false`；定义上写了 `requiresApproval: true` 的几个工具（`render_chart`、`write_spreadsheet`、`run_analysis`、两个模板工具）不影响这条。`lawyer_approved_write` 仍只是分类。
- `shouldCheckpointToolBudget` 现在恒返回 `false`。看到 `continue_tools` 相关代码，先确认是不是在为旧会话做兼容。
- 沙箱缺失时的行为是**拒绝**，不是降级。如果你在排查「某个工具报 SANDBOX_UNAVAILABLE」，去看 runner 路径和 `LAWMIND_TOOL_SANDBOX`，别去改工具本身。
- Word 插件回合的预批准名单（`WORD_ADDIN_PREAPPROVE_TOOL_NAMES`）只含 `apply_surgical_edits` 和 `render_tracked_draft`，**刻意不含** `prepare_outbound_mail`——Word 就地改稿不准备外发；且 Word 回合里 `render_document` 被工具自身拒绝（会按模板重建、也不写到原文件目录），必须走 `render_tracked_draft`。
