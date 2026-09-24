# 第 23 章 工具详解

第 5 章讲了工具的机制（注册、工具表、18 道中间件、审批）。这一章把工具本身讲清楚：**每个工具干什么、什么时候用、参数大概长什么样。**

## 23.1 核心常驻的 12 个

这 12 个是模型开局就能看到的（`CORE_MODEL_TOOL_NAMES`），不需要 `list_more_tools` 打开。

| 工具                    | 干什么                            | 关键参数                                                                 |
| ----------------------- | --------------------------------- | ------------------------------------------------------------------------ |
| `analyze_document`      | 读并分析一份文档（工作区/项目内） | 路径                                                                     |
| `read_project_file`     | 读项目目录里的文件                | 路径                                                                     |
| `draft_document`        | 起草文书（产出草稿对象）          | 指令、交付物类型                                                         |
| `update_draft`          | 改已有草稿的内容                  | `task_id`、内容                                                          |
| `apply_surgical_edits`  | 落最短锚点的改稿                  | `task_id`、`edits[{find,replace,note?}]`、`contract_edit_baseline_path?` |
| `render_document`       | 渲染交付物（docx/pptx）           | `task_id`、输出位置                                                      |
| `prepare_outbound_mail` | 写一封待发邮件（不发送）          | `to`、主题、正文、附件                                                   |
| `request_approval`      | 主动请求律师批准                  | 理由、动作                                                               |
| `research_task`         | 跑一次检索任务                    | 查询、法源范围                                                           |
| `search_statute`        | 查法条                            | `query`、`matter_id?`                                                    |
| `search_case_law`       | 查类案                            | `query`、`matter_id?`                                                    |
| `calculate`             | 计算（劳动补偿、期限、金额折算）  | 计算类型、参数                                                           |

再加两个控制工具：

| 工具              | 干什么                               |
| ----------------- | ------------------------------------ |
| `list_more_tools` | 启用一项未披露的能力（返回可用清单） |
| `update_plan`     | 维护回合计划（可改步骤）             |

**`list_more_tools` 是「渐进披露」的入口**：它返回可启用的工具清单（含中文说明），模型启用后那个工具进入本会话的已披露集合。系统提示里的「可用工具」段和它同源。

## 23.2 检索类（9 个）

| 工具                   | 干什么                               | 关键参数                                                |
| ---------------------- | ------------------------------------ | ------------------------------------------------------- |
| `search_workspace`     | 跨工作区检索材料                     | `query`、范围                                           |
| `search_matter`        | 只在本案卷宗里检索                   | `query`（**需绑案件**）                                 |
| `search_conversations` | 检索本机其他对话的要点与做法         | `query`                                                 |
| `read_conversation`    | 读某次历史对话里律师可见的发言       | 会话 id                                                 |
| `search_precedents`    | 检索本所旧案已签批交付物的可参照段落 | `query`、`limit`（≤20）、`target_task_id?`、`term_map?` |
| `search_statute_web`   | 官方法规站点优先的联网检索           | `query`、`count`（≤12）                                 |
| `web_search`           | 联网检索公开网页                     | `query`、`count`（≤10）                                 |
| `url_dossier`          | 把律师给的公开 URL 抓成卷宗          | `urls`、`max_urls`（≤20）                               |
| `deep_research`        | 长时深度检索（问题树 + 多轮）        | `instruction`、`breadth`（2–6）、`depth`（1–3）         |

**几个边界**：

- `web_search` 和 `search_statute_web` 需要配置联网密钥，且要过网络白名单。
- `search_precedents` 默认关闭（伦理墙），返回 `ok: true` 但命中为空。
- `deep_research` 每轮都注册（不像前两个需要联网开关）。

细节都在第 10 章。

## 23.3 文件与本机访问类（8 个）

| 工具                    | 干什么                                         | 备注                 |
| ----------------------- | ---------------------------------------------- | -------------------- |
| `list_dir`              | 列举工作区或本机文件夹下的目录与文件（可递归） | —                    |
| `read_project_file`     | 读项目目录文件                                 | 核心工具             |
| `explore_folder`        | 只读探查文件夹：看清树、找出相关文件并摘录     | 丢文件夹时的第一步   |
| `read_folder_documents` | 批量读取文件夹内正文                           | 配合 explore_folder  |
| `search_host`           | 在本机文件夹或本机查找中定位材料               | 需本机能力授权       |
| `read_host_file`        | 阅读已授权的本机文件                           | 需授权               |
| `import_host_file`      | 把本机文件收进本案（复制到案件材料目录）       | 需授权               |
| `run_host_command`      | 运行受控本机命令                               | 需显式开本机命令能力 |

**「本机」和「工作区」是两套边界**：工作区永远可读写（除治理路径），本机文件夹默认只读、且要经授权网关。被拒时那句文案是「本机文件夹默认不能改写。请使用「收进本案」复制到案件目录。」

第 15 章讲了这套网关。

## 23.4 案件与工作台类（13 个）

这些都是「对话补档案」那一波的核心（第 18 期的成果），写的是工作台的真实数据。

| 工具                         | 干什么                      | 需绑案件 |
| ---------------------------- | --------------------------- | -------- |
| `get_matter_summary`         | 看案件摘要                  | ✓        |
| `list_matters`               | 列工作区案件                | —        |
| `read_case_file`             | 读本案 CASE.md              | ✓        |
| `add_case_note`              | 向 CASE.md 加争点/风险/进展 | ✓        |
| `create_matter`              | 无关联案件时新建卷宗        | —        |
| `update_matter_profile`      | 更新卷宗案号/法院/当事人等  | ✓        |
| `check_conflict_of_interest` | 冲突检查                    | —        |
| `extract_legal_events`       | 从传票/短信抽开庭与期限候选 | —        |
| `apply_legal_events`         | 把有日期的期限写入工作台    | ✓        |
| `compile_intake_brief`       | 整理谈话为结构化摘要        | ✓        |
| `apply_intake_brief`         | 把谈话摘要写入本案档案      | ✓        |
| `record_deadline`            | 口播登记一项期限            | —        |
| `revert_desk_write`          | 撤销刚才一次档案写入        | ✓        |

**`revert_desk_write` 是这一组的兜底**：每次写入都在 `desk-writes.jsonl` 留记录，说错了能撤（第 7 章）。

`add_case_note` 的小节参数只允许五个值：`core_issue`、`risk`、`progress`、`artifact`、`task_goal`。

## 23.5 材料整理类（4 个）

| 工具                        | 干什么                                                         |
| --------------------------- | -------------------------------------------------------------- |
| `propose_organize_plan`     | 起草本案材料整理计划（先确认，不动文件）                       |
| `execute_organize_plan`     | 执行已确认的整理计划（可撤销）                                 |
| `relocate_matter_materials` | 把材料搬移/复制到正确的案件卷（跨案件，可撤销）                |
| `apply_file_ops`            | 工作区内搬移/改名/复制文件或文件夹（不改内容、不删除，可撤销） |

四个都是三步式：**提计划 → 确认 → 执行（可撤）**。`apply_file_ops` 的边界写得很清楚：不改内容、不删除。

## 23.6 表格与计算类（7 个）

| 工具                  | 干什么                                             | 关键参数                  |
| --------------------- | -------------------------------------------------- | ------------------------- |
| `review_table_update` | 编辑审查表（九个动作）                             | `task_id`、`action`、见下 |
| `analyze_spreadsheet` | 分析钉选或工作区 Excel 的列、类型与统计            | 路径                      |
| `write_spreadsheet`   | 把二维表写入 xlsx                                  | 输出位置、数据            |
| `render_chart`        | 按声明式规格出图                                   | 规格                      |
| `run_compute`         | 后台核算：当场写 JS 读文件/表格、批量整理、出表/图 | 脚本                      |
| `run_analysis`        | 预置分析脚本（须政策开启）                         | 脚本 id                   |
| `compare_documents`   | 只读对比两份文件的文本差异                         | 两个路径                  |

`review_table_update` 的九个动作（第 9 章详解）：

```text
set_template / set_columns / add_rows / update_cells / group_by /
import_materials_metadata / extract_batch / set_review / to_draft
```

`extract_batch` 的两个关键参数：`max_docs`（默认 120，上限 500）、`cell_keys`（只抽这些列）。

## 23.7 草稿与交付类（5 个）

| 工具                                         | 干什么                                                  |
| -------------------------------------------- | ------------------------------------------------------- |
| `write_document`                             | 写入工作区普通文件（**正式交件请用 `draft_document`**） |
| `render_tracked_draft`                       | 导出带审阅痕迹的 Word                                   |
| `draft_worker`                               | 并行写稿：按自包含任务书起草一节，父会话再汇总          |
| `register_template` / `set_template_enabled` | 模板注册与开关                                          |
| `list_templates`                             | 查看可用文书模板                                        |

**`write_document` 和 `draft_document` 的区别很重要**：

- `write_document` 只是写文件，**不过验收门**。
- `draft_document` 产出草稿对象，**要过验收门和必核清单**。

研究类交付物想用 `write_document` 绕过门禁，会被 `research-write-bypass-gate` 拦下（第 10 章）。

`draft_worker` 的模式和协作委派一样：**子任务书必须自包含**，因为 worker 看不到父会话的上下文。

## 23.8 邮件类（4 个）

| 工具                    | 干什么                                 |
| ----------------------- | -------------------------------------- |
| `list_mail_inbox`       | 查看本案邮件匣                         |
| `list_mail_attachments` | 列附件                                 |
| `prepare_outbound_mail` | 写待发邮件（不发送）                   |
| `send_email`            | 发送已准备的外发邮件（**须律师签批**） |

**`send_email` 是唯一会机械暂停的工具**（第 5 章）。`prepare_outbound_mail` 只是准备，审批发生在你看邮件的时候。

审批是**参数绑定**的：`prepare_outbound_mail` 的哈希只算收件人和附件列表，改正文不用重新批准。

## 23.9 协作类（7 个）

| 工具                    | 干什么                         |
| ----------------------- | ------------------------------ |
| `delegate_task`         | 把子任务交给另一位助手（异步） |
| `delegate_to_role`      | 按角色派活（异步）             |
| `consult_assistant`     | 问另一个助手（同步等回复）     |
| `request_review`        | 请另一个助手审一段内容（同步） |
| `notify_assistant`      | 通知一下（不要回复）           |
| `list_delegations`      | 列委派记录                     |
| `get_delegation_result` | 取某条委派的结果               |

细节在第 16 章。要点：异步那两个会把结果**自动回传到父会话**，而且结果会被包上「不可信内容」标记。

## 23.10 引擎与流程类（6 个）

| 工具                     | 干什么                                   |
| ------------------------ | ---------------------------------------- |
| `execute_workflow`       | 按需启动确定性办案管线（检索→起草→审批） |
| `plan_task`              | 先拆步骤再执行                           |
| `research_task`          | 跑一次检索任务                           |
| `append_session_summary` | 追加会话摘要                             |
| `open_work_queue_item`   | 打开一条待办                             |
| `get_audit_trail`        | 看审计轨迹                               |

`execute_workflow` 是唯一的 `background_job` 模式工具——因为它跑得久，必须暴露 job 状态、支持取消、有审计（第 5 章讲的运行模式）。

## 23.11 主动求助类（2 个）

| 工具               | 干什么                   |
| ------------------ | ------------------------ |
| `request_approval` | 主动请求律师批准         |
| `request_review`   | 请求审查（协作类，见上） |

`request_approval` 的意义是：**模型自己判断某个动作需要律师点头时，可以主动要求。** 它不依赖系统预设的审批规则。

## 23.12 工商与外部（1 个）

| 工具                      | 干什么                                   |
| ------------------------- | ---------------------------------------- |
| `search_company_registry` | 查企业登记；未接工商源时诚实标【待核实】 |

solo 版没有内置工商数据源。接法：`LAWMIND_COMPANY_REGISTRY_URL` + `LAWMIND_COMPANY_REGISTRY_KEY`。

**「配了 URL 不等于能用」**——代码注释写明「A configured URL is not live until a fetch actually succeeds」。拉不通就标【待核实】。

## 23.13 MCP 外部工具

外部 MCP 服务器提供的工具会以 `mcp__<服务器>__<工具>` 的形式注册（前缀可以从前面的报告里看到 `mcp__` 约定）。

三条约束：

1. **不许占用保留名。** 25 个核心工具名不许被外部实现顶替（`reserved-tool-names.ts`）。
2. **写类 MCP 工具默认剥离，除非显式 `allowWrites`，而且仍要审批。**
3. **MCP 故障不许拖垮核心工具表。** 挂载 MCP 的调用被 try/catch 包着，失败只影响它自己。

MCP 密钥存在密钥链（`mcp.<服务器id>.secret`），MCP 服务器配置在 `workspace/lawmind/mcp-servers.json`——**密钥只被引用，不写在这个文件里**。

## 23.14 工具的共同约定

### 案件参数

需要绑案件的工具在 `MATTER_SCOPE_REQUIRED` 里，它们的 `matter_id` 参数可以省略——省略时用本轮的 `ctx.matterId`。两个都没有就报：

```text
此工具需绑定案件：请在工作台选中案件，或在对话中指定案件后再继续。
```

### 分类

每个工具有 `category`，取值有 `search`、`analyze`、`draft`、`matter`、`review`、`system`、`collaboration`。分类影响治理元数据里的 `matterScope` 推导（`matter` / `draft` / `review` 三类默认算 `optional`）。

### 风险与运行模式

第 5 章讲过三个推导：

- `riskLevel`：工具声明 → 否则按 `requiresApproval` 或 `WRITE_TOOLS` 判 medium → 其余 low。
- `runtimeMode`：`background_job`（只有 `execute_workflow`）/ `lawyer_approved_write` / `readonly`。
- `matterScope`：`required` / `optional` / `not_applicable`。

### 幂等

`IDEMPOTENT_READ_TOOLS` 里的 36 个是只读且可重放的。这决定了两件事：可以安全重试，以及**不会触发写类审批**。

### 超时

默认超时是 0（不限），可用 `LAWMIND_TOOL_TIMEOUT_MS` 设。中断和超时都返回「已停止」或超时错误。

## 23.15 工具的调用计数与限流

有三层限制（第 5 章）：

| 层          | 限制                                               |
| ----------- | -------------------------------------------------- |
| 本轮总预算  | `resolveToolCallBudgets(maxToolCalls)` 的软/硬上限 |
| 检索/列表类 | 单工具限额 + 总量上限（按上下文长度伸缩，8–32）    |
| 本机文件类  | 单工具限额（12–48）+ `fileTaskReadHardCap`         |

被拦时给的都是「换个做法」的建议，不是干巴巴的「超限」。

有两类工具**不会**被检索限额拦：非检索类工具走自己的规则；`read_folder_documents` 在批量读场景反而被鼓励（它的回执里会提示用批量读代替逐个读）。

## 23.16 一张按场景查工具的表

| 你想干什么         | 用哪个工具                                                     |
| ------------------ | -------------------------------------------------------------- |
| 看看工作区里有什么 | `search_workspace`、`list_dir`                                 |
| 看某个案件有什么   | `get_matter_summary`、`read_case_file`、`search_matter`        |
| 读一份材料         | `read_project_file`、`analyze_document`                        |
| 丢进来一个文件夹   | `explore_folder` → `read_folder_documents`                     |
| 从本机拿文件       | `search_host` → `read_host_file` → `import_host_file`          |
| 查法条             | `search_statute`（断网时 `search_statute_web`）                |
| 查类案             | `search_case_law`                                              |
| 查本所旧案怎么写   | `search_precedents`（需开启）                                  |
| 查以前聊过什么     | `search_conversations`、`read_conversation`                    |
| 起草               | `draft_document`                                               |
| 改已经有的稿       | `update_draft` 或 `apply_surgical_edits`（后者是修订轨那条路） |
| 算金额、算期限     | `calculate`                                                    |
| 出 Word            | `render_document` / `render_tracked_draft`                     |
| 出 PPT             | `render_document`（`ppt.training` 类型）                       |
| 做一张表           | `review_table_update`                                          |
| 分析 Excel         | `analyze_spreadsheet`                                          |
| 出一张图           | `render_chart`                                                 |
| 批量整理材料       | `propose_organize_plan` → `execute_organize_plan`              |
| 登记一个期限       | `record_deadline` 或 `apply_legal_events`                      |
| 把谈话整理进档案   | `compile_intake_brief` → `apply_intake_brief`                  |
| 把活派给别人       | `delegate_task` / `delegate_to_role`                           |
| 问别人一个问题     | `consult_assistant`                                            |
| 让人审一下         | `request_review`                                               |
| 发邮件             | `prepare_outbound_mail` → 律师签批 → `send_email`              |
| 撤销刚才的档案写入 | `revert_desk_write`                                            |
| 想用没见过的能力   | `list_more_tools`                                              |
| 读某份技能正文     | `read_skill`                                                   |

## 23.17 已知坑（本章相关）

- **`write_document` 不过验收门。** 正式交件一律用 `draft_document`。
- **`send_email` 是唯一机械暂停的工具。** 别的写工具只是被审计，不会弹卡片。
- **MCP 工具不许占用 25 个保留名。**
- **MCP 写类工具默认被剥离。** 要开 `allowWrites`，而且仍要审批。
- **`search_precedents` 关闭时返回成功而非报错。** 别把「没开」当「没找到」。
- **`draft_worker` 和委派的任务书必须自包含。** 子任务执行者看不到父会话。
- **`calculate` 是必须走的**（劳动和期限类交付物的验收标准里写明了「不得口算」）。
- **`matter_id` 省略时会用本轮上下文里的案件。** 两个都没有才报错。
- **工具超时默认不限。** 生产环境如果担心卡死，设 `LAWMIND_TOOL_TIMEOUT_MS`。
