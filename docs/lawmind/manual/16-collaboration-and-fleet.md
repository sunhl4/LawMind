# 第 16 章 协作、在办与案件副本

这一章讲两件不同的事：助手在内部怎么分工，以及多个律师怎么共办一案。

对照 Cursor Agents Window、Codex 子任务和 Harvey Shared Spaces，日常好用的形状是：

- **律师第一眼看到要决定的事**，不是助手花名册，也不是一次过率。内部委派、岗位和配额留在引擎里，结果回到当前对话或在办。
- **多人协作的单位是案件**（材料、签出、成员），不是让几个助手在会议室里互相发言。会议室屏幕已退出主路径（第 16.7 节）；委派仍可能往会议记录文件留一行。
- **Solo 不因协作变难**。不邀请同事时，没有副本同步，在办默认就是待签批 / 待补充 / 待拍板。

五条铁律在这里的取舍：

| 铁律           | 这一章怎么落                                                                                                                                       |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| 上手简单       | Solo 第一眼是待决定的事，不是助手花名册，也不是一次过率。委派 API 不是进门步骤；会议室没有界面入口。                                               |
| 交付质量       | 岗位清单是教练（必须修改 / 建议优化 / 可选）。它不给稿打分，也不靠互审次数证明写对了。                                                             |
| 稳定           | 委派深度 3、每助手 5 条，防的是套娃把机器打满。超时如实标，不把晚到的结果当成没发生。                                                              |
| 先复用，后自研 | 多人共案用端到端加密加共享目录或 HTTP 中继，不自造一套在线律所 IM。                                                                                |
| 发挥模型能力   | 六个 Role 的工具名单全是不限制。一句话生成工作流时，句式只是草稿，模型那条才决定步骤；句式对不上不得拒办。律所强制互审是外发前的授权，不是质量分。 |

## 16.1 助手、岗位与 Role：三层称呼的关系

先说清楚三个层次，否则看代码会绕晕：

| 层次         | 代码        | 是什么                                                         |
| ------------ | ----------- | -------------------------------------------------------------- |
| **助手**     | `assistant` | 具体的一个「人」。有显示名、简介、档案。存在 `assistants.json` |
| **岗位预设** | `preset`    | 六种预设模板，决定风险上限与审核清单                           |
| **Role**     | `role`      | 岗位预设升级成的一等对象，带可用工具、可用交付物类型、记忆范围 |

关键点：**Role 和岗位预设是一一对应的**。`core/role.ts` 里的 `BUILT_IN_ROLES` 就是从 `ASSISTANT_PRESETS` 映射出来的：

```ts
const BUILT_IN_ROLES = ASSISTANT_PRESETS.map(presetToRole);
```

六个 id 是同一套：`general_litigation`、`contract_review`、`compliance_research`、`client_memo`、`due_diligence`、`general_default`。

### 六个 Role 的完整定义

| roleId                | 使命                                                         | 风险上限 |
| --------------------- | ------------------------------------------------------------ | -------- |
| `general_litigation`  | 驱动诉讼与争议解决工作，厘清请求权基础与程序节点             | high     |
| `contract_review`     | 驱动合同审查与交易条款拆解，按必须修改/建议优化/可选三档分级 | medium   |
| `compliance_research` | 提供以规范层级组织的合规检索结论，明确生效与适用范围         | medium   |
| `client_memo`         | 面向非法律人士输出客户沟通材料，突出行动与时间线             | low      |
| `due_diligence`       | 推进尽职调查与材料梳理，区分已核实/待补充/第三方待确认       | medium   |
| `general_default`     | 通用法律助理，按任务性质均衡处理检索、起草与笔记             | high     |

每个 Role 还带一份**审核清单**（`reviewChecklist`），这是它最有用的部分。举两个例子。

`contract_review` 的清单五项：

```text
已区分「必须修改 / 建议优化 / 可选」
重大风险与责任边界已前置说明
引用或待核实处已标注来源或「待确认」
争议解决与通知送达条款已审阅
输出语气与受众（内部/客户/对方）一致
```

`general_litigation` 的四项：

```text
请求权基础与举证责任已厘清
程序节点（时效、管辖、保全）已提示
对抗主张与对方可能抗辩已覆盖
需律师签章或盖章的交付物已标明不可直接发出
```

最后那条特别实际：诉讼文书经常需要盖章才能提交，系统要提醒「这份东西不能直接发出去」。

### 可用工具都是「不限制」

有一点：**六个 Role 的 `allowedToolNames` 全部是 `undefined`**，也就是不限制。

这和岗位化不矛盾：不靠白名单限制模型，靠技能和审核清单引导。真要停，只停外发、改原稿和伦理墙。

### 风险上限怎么用

`taskRiskExceedsRoleCeiling` 能判断任务风险是否超过岗位上限（`RISK_ORDER`：low 0、medium 1、high 2）。`client_memo` 的上限是 low，六个 Role 里除了 `general_default` 都把 `defaultEscalateTo` 指向它。这个函数目前只在岗位定义和单测里，不在对话中途弹出「要不要换岗位」，也不因此停掉交办。

### 名册：在场、置顶与上限

`src/lawmind/assistants/` 里名册相关的四块：

- **六态在场**（`presence.ts`）：`idle` / `working` / `waiting` / `blocked` / `thinking` / `done`。从在办记录和会话归属推出来（`presenceFromWork`），不是助手自己上报。对话消息栏的助手席（`LawmindAssistantDesk.tsx`）读 `GET /api/assistants/:id/desk` 展示它。
- **置顶 / 隐藏 / 上限 50**（`roster.ts`）：`ASSISTANT_ROSTER_LIMIT = 50`——「再多就开始互相抢注意力」。置顶在前、隐藏在后、同组按名字；隐藏只影响顶栏日常切换，名册里仍看得到；默认助手不能被隐藏；当前正在用的那位即使被隐藏也留在切换列表里。
- **跨助手检索**（`roster-search.ts`）：`GET /api/assistants/roster-search?q=` 在对话命中之外再看办件与常设工作运行记录，按助手分组（复用对话检索，不另造索引；没有助手归属的常设工作放进「未归属」）。
- **岗位模板导出**（`share-template.ts`）：`POST /api/assistants/:id/share-template` 把一位助手的职务说明导成可分享的模板。密钥 / 私钥是硬拦（导出前必须删掉）；像电话或证件号的内容只作提醒，要律师显式确认（`acknowledgeWarnings`）才放行。

## 16.2 在办：还没了结的交办

「在办」是工作面之一（`agents`），也是跟进的日常入口。打开后左栏是一本交办册，三条带子：

- **停在你这里**：待签批、待补充、待发出、办到一半停住、近几日没有办完。始终展开。有这种件时，右栏先打开最靠前的一件。
- **正在办**：对话、交给另一位助手、按流程，且还在跑或已排上。不超过几件时展开。
- **今天办完**：今天完成或停下的。旁边还有活时收成一行；只有这一条时展开。

右栏先写你交办的那句话和现在停在哪里，再是签批、补充或驳回。正在办和今天办完的，主按钮是回到这场对话或去改稿。要看全文，从这一件进改稿。

这和 Cursor Agents Window、Codex 任务列表、Harvey 的运行记录一致：一件事走完它的状态，要你动手只是其中一种状态，不另开一间房间。不按助手排。一次过率和均改写字数不出现在这一行。

左栏可以按案件筛选，以及「只看要我处理」（侧栏「待我拍板」进来时默认打开）。「稍后看」仍持久化（localStorage 键 `lawmind-agents-snooze:v1`）。

**交出去的活**和**按流程办**收在在办页顶部的「更多」里（`lm-agents-desk-more`），用来撤销委派或发起一条流程。它们不是进门第一眼，也不在窗口顶栏那三个一级 tab 旁边。助手之间的派活由模型在回合里用协作工具完成，律师不需要先选岗位再派。进行中的委派和流程会出现在「正在办」。

## 16.3 委派：把活交给另一个助手

这是协作的核心机制。

### 七个协作工具

| 工具                    | 干什么                     | 同步还是异步            |
| ----------------------- | -------------------------- | ----------------------- |
| `delegate_task`         | 按助手名派一件自包含的活   | 异步（fire and forget） |
| `delegate_to_role`      | 按 Role 派活（自动选助手） | 异步                    |
| `consult_assistant`     | 问另一个助手一个问题       | **同步**（等回复）      |
| `request_review`        | 请另一个助手审一段内容     | **同步**                |
| `notify_assistant`      | 通知一下，不要回复         | 异步                    |
| `list_delegations`      | 列委派记录                 | —                       |
| `get_delegation_result` | 取某条委派的结果           | —                       |

### 派活的参数

`delegate_task` 的参数里有几个要点：

| 参数                | 说明                      |
| ------------------- | ------------------------- |
| `target_assistant`  | 目标助手（必填）          |
| `task`              | 任务正文（必填）          |
| `goal` / `not_goal` | 要什么 / 不要什么         |
| `materials`         | 可用材料                  |
| `output_format`     | 交付形式                  |
| `priority`          | `normal` / `high` / `low` |

`goal` / `not_goal` 这一对是「自包含任务书」的关键：被派的助手**看不到委派方的对话历史**，所以任务书必须把边界写清。对话里的 `draft_worker` 用同一套任务书（第 23.7 节），但是只读子工：不能改原件、不能导出，正式稿仍由父会话 `draft_document` 落。委派是另一位助手的完整会话，不是这条只读子工。

目标助手找不到时报：

```text
找不到助手「X」。可用助手：…
```

`delegate_to_role` 则是按 Role 找，找不到对应岗位的助手时报：

```text
当前工作区没有承担「…」(roleId=…) 的助手。请先在设置里添加。
```

### 委派记录

存在 `<工作区>/delegations/<delegationId>.json`。状态七种：

```text
pending | running | completed | failed | timeout | cancelled | completed_after_timeout
```

最后那个 `completed_after_timeout` 挺有意思：**超时之后才完成**。这种情况不能简单当失败（结果确实出来了），也不能当正常完成（已经报过超时了），所以单独一个状态。

结果很大的时候会**溢出到文件**：`<工作区>/delegations/<delegationId>.result.md`，内联只留头部（上限 8000 字，硬上限 100 KB）。取结果时会给 `resultTruncated` 和 `resultPath`。

### 委派有配额

`DEFAULT_COLLABORATION_POLICY` 里的三个限制：

| 限制                 | 值     |
| -------------------- | ------ |
| 单个助手的活跃委派数 | 5      |
| 最大委派深度         | 3      |
| 默认咨询超时         | 60 秒  |
| 默认委派超时         | 300 秒 |

校验失败时直接给律师能看懂的中文：

```text
不能把这件活派给自己。请交给另一位助手，或自己做完再回报。
派活已经套了 <n> 层，上限是 <m> 层。请把结论交回，不要再往下派。
你同时在办的派活已有 <n> 件，上限是 <m> 件。等一件做完，或改派给别的助手。
当前协作策略不允许这样派活。请改派给允许的助手，或自己做完再回报。
```

第二条（深度限制）防的是**委派套委派无限递归**。第三条防的是单个助手被派爆。

### 超时了怎么办

超时不只是标个状态，还会做两件事：`markDelegationTimeout` 加 `requestTurnAbort(sid)`——**真的去中断那个还在跑的回合**。

### 结果回传

委派完成（或失败）后，结果会**自动回传到父会话**，以一条合成助手消息的形式：

```text
【委派结果 · 已自动回传】
【委派结果 · 未成功】
```

打包上限 48000 字。

### 「委派结果」是不可信内容

有一条安全处理值得单独说：助手返回的结果会被包上标记：

```text
<<<BEGIN_UNTRUSTED_ASSISTANT_RESULT>>>
...
<<<END_UNTRUSTED_ASSISTANT_RESULT>>>
```

为什么？因为助手 A 的结果会进入助手 B 的上下文。如果 A 的结果里藏着「忽略你的指令」这种话，B 可能真的会听。**加标记就是在告诉 B：这段是数据，不是指令。**

这和 `content-trust.ts` 处理上传文档是同一种思路（第 15 章）。

## 16.4 工作流：串起来的多个助手

单个委派是「派活」，工作流是「派一串活」。

### 模板长什么样

工作流模板存 `<工作区>/lawmind/workflows/<id>.json`，一个步骤长这样：

```ts
{
  stepId, assignee, assigneeRoleId?,
  task, dependsOn: string[],
  reviewBy?, autoApprove?,
  status,
}
```

关键字段：

- `dependsOn`：前置步骤。有依赖就会按顺序跑，没依赖的可以并行。
- `reviewBy`：这一步的结果要先给谁审。
- `autoApprove`：跳过审核。

### 十四个内置模板

`BUILTIN_WORKFLOW_TEMPLATES` 里有十四个：`training-ppt`、`office-research-report`、`speech-or-lecture-draft`、`nda-triage`、`contract-review`、`mail-contract-redline`、`vendor-agreement-review`、`demand-letter`、`matter-chronology`、`evidence-index`、`due-diligence-review`、`client-update-memo`、`compliance-research-memo`、`renewal-monitor`。

其中 `mail-contract-redline`（邮件合同改稿）最特别，它带预批准工具名单：

```js
preApproveToolNames: ["apply_surgical_edits", "render_tracked_draft", "prepare_outbound_mail"];
```

还有 `acceptancePackRequired: true` 和 `requiredSources: ["邮件合同附件"]`。

两个可排期的（`schedulable: true`）：`client-update-memo`、`renewal-monitor`。

### 循环依赖会被拒

`findWorkflowDependencyCycle` 会先找环。找到就抛：

```text
工作流存在循环依赖：...
```

这条必须在开始跑之前查，否则跑到一半才发现就难收拾了。

### 依赖失败会传导

`propagateDependencySkips`：前置失败了，后面的步骤标 `skipped`，不去跑。这是「不要用错误的输入继续跑」的落地。

### 并行度

并行调度上限取 `getMaxToolUseConcurrency()`（对应 `LAWMIND_MAX_TOOL_CONCURRENCY`，默认 4）。

### 单步超时

默认 900 秒（`DEFAULT_COLLAB_STEP_TIMEOUT_MS`），可用 `LAWMIND_COLLAB_STEP_TIMEOUT_MS` 改，夹在 30 秒到 1 小时之间。

### 步骤里的审核

如果某步配了 `reviewBy` 且没开 `autoApprove`，会同步调一次审查助手（超时 120 秒）。审查助手没响应时，结果会被标记：

```text
[审查助手未响应，结果未经审查]
```

**如实标注「未审查」，而不是假装审过了。** 这个处理方式值得学。

### 每一步都带记忆快照

有个细节做得挺细（`workflow-memory-bundle.ts`）：入队时会**快照每个助手的偏好档案**（每人最多 2048 字），步骤开始前把对应助手的偏好拼进任务里。

为什么？因为工作流可能是排期的（比如每周一早上跑），入队和实际执行之间可能隔很久。如果执行时才读偏好，读到的是「那一刻」的偏好，和入队时的意图不一致。快照保证**行为可复现**。

拼进任务时的头部是「## 本步骤助手偏好（enqueue 快照）」。

### 助手怎么选

`resolveStepAssigneeByRole` 的兜底链有四层：

1. 按 `assigneeRoleId` 找对应岗位的助手。
2. 否则按 `assignee`（助手 id）找。
3. 否则用第一个助手档案。
4. 最后兜底 `default`。

四层兜底意味着**即使配置不全也能跑起来**，而不是报「找不到助手」卡住。

### 从一句话生成工作流

`parseAndBuildWorkflow` 能把「先让 A 做 X，然后让 B 做 Y」收成一份步骤草稿。

有两条路：句式（`parseDirectiveHeuristic`，认「先让…然后让…」「同时让…」）和模型（`parseDirectiveWithModel`，走出口代理，`requestTag: "directive-plan"`）。句式对不上就走模型。两条路都不冻结工具表，也不因为没匹配上句式就拒绝交办。

## 16.5 默认承办人路由

`routing/defaults.ts` 管「这种活默认给谁干」。存 `lawmind/routing/defaults.json`。

默认配置长这样：

```json
{
  "version": 1,
  "forcePeerReview": null,
  "byKind": {
    "draft.word": { "roleId": "contract_review" },
    "contract.review": { "roleId": "contract_review" }
  },
  "byDeliverableType": {
    "contract.review": { "roleId": "contract_review" }
  }
}
```

解析结果带一个 `source` 字段，取值 `explicit` / `assistantId` / `roleId` / `fallback` / `none`。这样排查「为什么派给了他」很方便。

路由解析会记 `routing.resolve_ok` / `routing.resolve_fallback` / `routing.resolve_failed`，给排障用。律师界面不展示这些事件名，也不用它们说明「这份稿可信」。

## 16.6 强制同行审核

`peer-review-gate.ts` 是律所档在外发前多一人看过。Solo 默认关。它不给稿打质量分；只有一个助手时记 `no_peer` 或 `self_peer` 并继续，不把律师卡在「请先再添加一名助手」。

开关解析：`effectiveForcePeerReview`（policy 的 `forcePeerReview` 优先，否则看版本功能 `forcePeerReview`——firm / private_deploy 默认开）。

跳过时会记原因，六种：

| 原因          | 含义               |
| ------------- | ------------------ |
| `edition_off` | 版本没开这个功能   |
| `no_author`   | 不知道作者是谁     |
| `no_peer`     | 没有别的助手       |
| `self_peer`   | 找到的还是作者自己 |
| `error`       | 出错了             |

只有作者和互审对象**不是同一个人**时才真的派审查。派出去的任务头部是「【强制互审】请审阅草稿「…」」，优先级 `high`。

审计事件 `draft.peer_review_skipped` / `draft.peer_review_required` 记下了每次判定。

## 16.7 会议室记录：界面已退出，委派仍会留一行

律师界面上没有会议室。顶栏没有这一项，输入条「+」没有「开会议室」，主内容区不渲染 `MeetingView`。`e2e/meeting-flow.spec.ts` 守着「不能再开始轮流讨论」。下面讲的是还在跑的数据，不是操作步骤。

委派（`src/lawmind/agent/tools/coordination/delegate.ts`）仍会往案件会议室文件追加系统行：创建一条、完成或失败各一条。所以文件里能看到协作留痕，但律师没有一屏专门去读它。未挂载的 `MatterTeamMeeting*` 组件和 `pickMeetingViewProps` 留在仓库里，单测还覆盖；不要为了「代码还在」把入口装回顶栏。

类型 id 仍是 `meeting`（`lawmind-main-view.ts`）。深链 `onOpenTopLevelMeeting` 实际打开的是对话（`setMainView("workspace")`），不是会议室。

### 两种范围

| 范围           | 记录位置                            |
| -------------- | ----------------------------------- |
| 绑案件         | `cases/<案件id>/team-meeting.jsonl` |
| 临时（ad-hoc） | `meetings/adhoc/team-meeting.jsonl` |

临时会议有专门的假案件 id（`ADHOC_MEETING_MATTER_ID`），并且有迁移逻辑把老位置的记录搬过来。

纪要摘要单独存 `meeting-summary.md`（上限 12000 字）。

### 记录的行

每行是一条 JSONL，三种构造器：`createTeamMeetingUserLine`（律师）、`createTeamMeetingAssistantLine`（助手）、`createTeamMeetingSystemLine`（系统）。

单条正文上限 48000 字（`TEAM_MEETING_MAX_LINE_TEXT`），读取默认取尾部 120 条、最多 240 条，单次读入上限 4MB。

会议记录拼进提示词时的开头是固定的：

```text
## 案件团队会议室纪要（内部协作用，非对外法律意见）
```

「非对外法律意见」这半句是必须的——会议室里的讨论不是给客户的东西。

### 未挂载界面里的发言推进（律师走不到）

`lawmind-meeting-deliberation.ts` 与 `useMatterTeamMeetingDeliberation.ts` 仍负责排发言顺序：`buildDeliberationPlan` 生成一份计划，轮数夹在 1–5 之间。这些按钮不在当前壳层上。

### 打断与恢复（同一套未挂载组件）

这些句子还在 `useMatterTeamMeetingDeliberation.ts` 里，当前壳层没有按钮能走到：

- 「终止发言」后界面文案是「已终止当前发言」。
- 状态进入 `paused`，可以「继续讨论」或「结束」。
- 模型出错时的文案是「出错已暂停。可重试继续或结束。」

判定「这次发言是不是被打断了」靠 `isAbortedMeetingReply`，匹配回复文本里的「已停止生成」。等打断生效的最长时间是 12 秒（`MEETING_INTERRUPT_WAIT_MS`）。

### 一条会场纪律

每个助手的发言走的是**正常的 `/api/chat` 回合**，只是带了会议参数（`meetingMode: true` 等）。也就是说，会议室不是一个独立的执行引擎，而是「同一套回合，多跑几轮，共享一条时间线」。

参会材料最多钉 8 个文件（`MAX_MEETING_AGENDA_FILE_PINS`）。

会话 id 和参会人存在 localStorage（前缀 `lawmind.teamMeeting.session.` 和 `lawmind.teamMeeting.participants.`）——**换机器就没了**，这是本地界面状态，不是工作区数据。

### 端到端测试现在守的是「入口没有了」

`meeting-flow.spec.ts` 不再走「开始讨论 → 发言 → 结束」。它只断言输入选项里没有 `lm-compose-open-meeting`，页面上也没有「开始讨论」。

## 16.8 案件副本：多个律师办同一个案子

各版本默认都开（`matterReplicaCollab`）。独立律师不用换成律所版就能邀请同事共办一案；`matterReplica.enabled: false` 可以关掉。

### 要解决的问题

几个律师要在同一个案件上协作，但**卷宗不能上传到别人的服务器**——尤其是涉及保密义务的案子。

所以做法是：**端到端加密 + 客户端持钥**。案件密钥（matter key）从不离开工作区，上传到中继的永远是密文。

### 成员与角色

六种角色（`MATTER_REPLICA_ROLES`）：

| 角色        | 中文         | 能力                                              |
| ----------- | ------------ | ------------------------------------------------- |
| `owner`     | 主办         | 全部（含 `seal_matter`）                          |
| `lead`      | 主办（共同） | 全部（含 `seal_matter`）                          |
| `associate` | 协办         | 邀请、改记录、传材料、签出 docx、看策略、跑助手写 |
| `paralegal` | 助理         | 改记录、传材料、签出 docx                         |
| `readonly`  | 只读         | 无                                                |
| `external`  | 外协         | 只能传材料                                        |

十种能力（`MatterReplicaCapability`）：`manage_members`、`invite`、`edit_matter_records`、`edit_case_md`、`upload_materials`、`delete_materials`、`checkout_docx`、`view_strategy`、`run_assistant_write`、`seal_matter`。

`readonly` 的能力是空数组——**只读就是真的什么都没有**，连材料都传不了。

### 密钥体系

这一层有点绕，但很重要。四个概念：

1. **律师身份密钥对**（**X25519**，做 ECDH 协商用）：存**工作区内**的 `lawmind/lawyer-keys.json`（不是家目录），每个律师一套，0600。
2. **案件密钥**：每个案件一把，存 `cases/<案件id>/replica/matter-key.json`。**永不离开本地。**
3. **成员包裹**：给每个成员的包裹是 `wrapMatterKeyForMember`——用对方公钥做密钥协商（HKDF，盐是 `lawmind-matter-replica-member-wrap-v1`），把案件密钥封起来。所以只有那个成员解不开不了。
4. **邀请包裹**（v2）：给还没加入的人。用邀请码派生包裹密钥（盐 `lawmind-matter-replica-invite-v1`，info 是 `matter:<案件id>`），再包案件密钥。

邀请码是 16 位十六进制大写（8 字节随机），有效期 14 天。

密钥轮换（`rotateAndShareMatterKey`）用于「把某人移出后，前向保密」——移除成员后换一把案件密钥，重新分发给留下的人。

### 加密信封

`crypto-envelope.ts` 是 AES-256-GCM 封装。格式有魔数头 `LMRENv1`，12 字节 IV，16 字节 auth tag。

有一条注释是一次**降级攻击**的修复记录：

> Fail closed on non-envelope input. A silent plaintext passthrough made "replace the ciphertext with plaintext" undetectable, which is a downgrade attack on every sealed blob.

也就是说，早先如果输入不是信封格式，代码会**原样放过**（当作明文处理）。这意味着攻击者把密文换成明文，系统照收——所有封装材料的保密性归零。现在的行为是抛错：

```text
not a sealed envelope (refusing plaintext passthrough)
```

### 材料同步

材料走内容寻址（content-addressed）：按 sha256 存，清单单独同步。

有一条注释记了一个很严重的旧问题：

> 内容寻址的意义就在这里：单块路径以前直接用中继给的字节，不比对 manifest 的 sha256，于是**任何能写中继的人都能把任意字节塞进律师卷宗**。

修法是对每个块重算哈希再比。拒绝时记审计 `collab.integrity_rejected`。

大文件会分块（阈值 4MB，块大小 2MB），重组时再验一次哈希，不符抛 `chunk reassembly hash mismatch`。

还有一条注释解释了为什么「不是成员就不放材料」：

> 不是本案成员就不在云上放材料：既没有正确钥匙（会各生成一把、互相解不开），也不该看到别人的密文。成员资格是「云上材料」的前置条件。

### 冲突怎么处理

**不做自动合并。** 采用「后写胜出 + 冲突旁车」：

`lastWriteWinner` 比较 `updatedAt`，晚的赢；时间戳相同则比 sha256（大的赢，纯为确定性）。

输的那一份**不删**，改名为 `<名字> (冲突)<后缀>`，再冲突就 `(冲突 2)`……同时记审计 `collab.conflict_parked`。

有一条注释把边界说得很清楚：

> Last-write-wins for replica materials + a conflict sidecar for the loser. **Not a CRDT**: two lawyers editing the same file keep both bytes on disk.

也就是说：**两个律师改了同一个文件，两份字节都在磁盘上，等人来合。** 这是有意的保守选择——自动合并两份法律文件的风险远大于让人来合。

### docx 签出锁

`checkout-locks.ts` 提供文件级签出锁（`checkout_docx` 能力），避免两个人同时改同一份 Word。

### CASE.md 的实时合并

CASE.md 是 Markdown，多人同时追加会乱。`case-md-live.ts` 做行级合并（`mergeCaseMdLines` + `rematerializeCaseMd`），冲突时停在旁车文件里。

### 同步调度

`sync-scheduler.ts` 的默认参数：

| 参数           | 值     |
| -------------- | ------ |
| 全局 tick 间隔 | 30 秒  |
| 单案件最小间隔 | 15 秒  |
| 防抖           | 1.5 秒 |

只对**有成员名册的案件**做自动同步（`listAutoSyncMatters`）。

一条注释说明了不做的两件事：

> 不做增量游标（`fetchOps` 已有 `afterOpId` 参数，但文件中继每次都是全量 bundle，增量要等服务端）。也不做「发现冲突自动裁决」——冲突仍走既有的旁路 + 人工合并。

### 中继的两种形态

| 形态                             | 说明                                    |
| -------------------------------- | --------------------------------------- |
| 共享文件夹（`FileReplicaRelay`） | 大家指向同一个（比如 NAS 或同步盘）目录 |
| HTTP（`HttpReplicaRelay`）       | POST/GET `<base>/v1/matters/:id/ops`    |

还有材料专用中继（`FileMaterialsRelay` / `HttpMaterialsRelay`）。

### 操作日志

所有变更都是「操作」（op），追加到 `cases/<案件id>/replica/ops.jsonl`。十几种操作类型：成员增删、密钥分享、字段设置、锁获取释放、邀请创建接受撤销、CASE.md 快照、材料增删、密钥轮换。

`apply-ops.ts` 负责把操作应用到本地状态。可应用的案件字段有白名单（十一个）：

```text
status, sensitivity, strategyStatus, ownerLawyerId, primaryAssistantRoleId,
counterparty, causeOfAction, matterKind, practiceTags, nextActions, openQuestionIds
```

注释里有一句坦白的边界：

> 不校验 op 签名/来源：中继仍是**可信通道**。完整性收口见差距评审 G5–G6。

也就是说：端到端加密保证了「看不到内容」，但**没有保证「操作是真的」**——能写中继的人仍然可以丢包、重放操作。`member-keys.ts` 的注释也承认：

> 这是**本地工具与共享文件夹**威胁模型下的收口，不是抗恶意中继的完整方案：中继仍可丢包 / 重放 op（op 尚无签名），也能看到 `member.key` 公钥。

这种把威胁模型边界写清楚的做法，比笼统说「安全」有用得多。

## 16.9 托管案件云（另一种形态）

除了共享文件夹和自建中继，还有一层「案件云」：一个多租户服务。

- 服务端 `createMatterCloudServer`，客户端 `MatterCloudClient`。
- 目录层管租户、账号、邀请，token 存的是**哈希**（sha256），比对用常量时间。
- 端点是 `/v1/matters/:id/ops`、`/materials/manifest`、`/blobs/:sha256`，加 `/v1/me`、`/v1/health`、`/v1/invites/redeem`。
- 每个端点都按能力校验（`upload_materials`、`delete_materials`、`manage_members`、`invite` 等）。
- 服务端**不信任客户端**：上传 blob 会重算哈希，不符直接 400。

有一条注释解释了一个 E2EE 的固有取舍：

> 客户端已按 manifest 的 `sha256` 校验，但服务端**不能**依赖客户端：`PUT blobs/:sha256` 会重算哈希，不符直接 400。否则中继本身就成了污染源。
>
> 完整性检查的**边界**：客户端开启端到端加密时，上传的是密文，而路径上的哈希是**明文**的哈希——服务端没有密钥，重算必然不等。这是 E2EE 的固有取舍，不是 bug。若在这里一律强制比对，E2EE 就永远无法上传——所以必须按是否封套分流。

也就是说：**未加密的块服务端会验哈希；加密的块服务端验不了（只能信任客户端声称的哈希）。** 这个边界必须写下来，否则后人会以为「服务端验过哈希」等于「内容可信」。

默认目录 `.lawmind-matter-cloud`，端口 8788，主机 127.0.0.1。

入云与邀请的三条链路：

- **enroll / join**：`POST /v1/enroll` 注册账号领令牌；同事凭邀请码走 `POST /v1/invites/join` 换到自己的令牌并加入案子（两人令牌不同）。
- **cloud-link.json**：桌面端把云地址与令牌存在 `lawmind/cloud-link.json`，权限 0600，只在本机（`matter-cloud/cloud-link.ts`）。策略文件拒收云地址与令牌（`matterReplica.cloudToken` / `endpoint` / `cloudDataDir` 写进 `lawmind.policy.json` 会被拒：「地址和令牌不能写在策略文件里」）。
- **desktop-bridge**：配了云之后**云是权威**——邀请由服务端建、服务端记状态，桌面端不再自己造邀请码；兑换云邀请后同时写本地名册并记 `invite.accept` op，让不带云的机器也能收敛（`matter-cloud/desktop-bridge.ts`）。共享中继形态下，邀请随中继上的 `invite.create` op 到达对端，由 `ingestInviteFromSharedRelay`（`matter-replica/shared-relay.ts`）摄取，状态由 `invite.revoke` / `invite.accept` op 还原——对端不需要 `invites.jsonl`。

## 16.10 HTTP 端点

### 协作

| 端点                                    | 方法                                   |
| --------------------------------------- | -------------------------------------- |
| `/api/collaboration/summary`            | GET                                    |
| `/api/collaboration/workflow-templates` | GET                                    |
| `/api/collaboration/workflow-run`       | POST（`async: true` 返回 202 + jobId） |
| `/api/collaboration-events`             | GET（可带 `since`）                    |
| `/api/delegations`                      | GET / POST                             |
| `/api/delegations/:id`                  | GET / DELETE                           |
| `/api/delegations/follow-up`            | GET                                    |
| `/api/delegations/session-progress`     | GET                                    |

关闭协作时全部返回 503 `collaboration_disabled`（开关 `LAWMIND_ENABLE_COLLABORATION`）。

### 助手、岗位、路由

| 端点                                        | 方法           |
| ------------------------------------------- | -------------- |
| `/api/assistants`                           | GET / POST     |
| `/api/assistants/:id`                       | PATCH / DELETE |
| `/api/assistants/:id/duplicate`             | POST           |
| `/api/assistants/:id/profile-sections`      | GET            |
| `/api/assistants/roster-search`             | GET            |
| `/api/assistants/:id/desk`                  | GET            |
| `/api/assistants/:id/share-template`        | POST           |
| `/api/assistant-presets`                    | GET            |
| `/api/agent-presets`                        | GET            |
| `/api/agent-fleet`                          | GET            |
| `/api/assistants/growth`                    | GET            |
| `/api/sessions/:sessionId/fleet-transcript` | GET            |
| `/api/roles` / `/api/roles/:roleId`         | GET            |
| `/api/routing/defaults`                     | GET / PUT      |
| `/api/routing/resolve`                      | POST           |

### 案件副本与案件云

| 端点                                               | 方法                |
| -------------------------------------------------- | ------------------- |
| `/api/matter-replica/status`                       | GET                 |
| `/api/matter-replica/identity`                     | GET / PUT           |
| `/api/matter-replica/membership`                   | GET                 |
| `/api/matter-replica/invites`                      | POST                |
| `/api/matter-replica/invites/accept`               | POST                |
| `/api/matter-replica/invites/revoke`               | POST                |
| `/api/matter-replica/members/revoke`               | POST                |
| `/api/matter-replica/locks`                        | GET                 |
| `/api/matter-replica/locks/acquire` / `release`    | POST                |
| `/api/matter-replica/ops`                          | GET                 |
| `/api/matter-replica/feed`                         | GET                 |
| `/api/matter-replica/materials`                    | GET                 |
| `/api/matter-replica/materials/publish`            | POST                |
| `/api/matter-replica/sync`                         | POST                |
| `/api/matter-replica/scheduler` / `scheduler/tick` | GET / POST          |
| `/api/matter-replica/audit-report`                 | GET                 |
| `/v1/matters/...`                                  | GET / PUT（案件云） |

## 16.11 关键文件

| 关注点         | 文件                                                                                                                                                                                                                                                                                                                                    |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 协作消息与委派 | `src/lawmind/agent/collaboration/message-bus.ts`、`delegation-registry.ts`、`types.ts`                                                                                                                                                                                                                                                  |
| 协作审计       | `src/lawmind/agent/collaboration/audit.ts`                                                                                                                                                                                                                                                                                              |
| 共享记忆与产物 | `src/lawmind/agent/collaboration/shared-memory.ts`、`workflow-memory-bundle.ts`                                                                                                                                                                                                                                                         |
| 工作流模板     | `builtin-workflow-templates.ts`、`workspace-workflow-templates.ts`、`ensure-workflow-seeds.ts`                                                                                                                                                                                                                                          |
| 工作流执行     | `src/lawmind/agent/orchestrator/executor.ts`、`directive-parser.ts`、`types.ts`                                                                                                                                                                                                                                                         |
| 协作工具       | `src/lawmind/agent/tools/coordination/`（`delegate.ts`、`handoff.ts`、`meeting.ts`、`utils.ts`）                                                                                                                                                                                                                                        |
| 默认路由       | `src/lawmind/routing/defaults.ts`、`peer-review-gate.ts`                                                                                                                                                                                                                                                                                |
| Role           | `src/lawmind/core/role.ts`、`src/lawmind/agent/assistant-presets.ts`                                                                                                                                                                                                                                                                    |
| 助手档案与组织 | `src/lawmind/assistants/`                                                                                                                                                                                                                                                                                                               |
| 会议室         | `src/lawmind/cases/team-meeting.ts`；渲染层 `src/renderer/app/MeetingView.tsx`、`lawmind-meeting-*.ts`                                                                                                                                                                                                                                  |
| 案件副本       | `src/lawmind/matter-replica/`                                                                                                                                                                                                                                                                                                           |
| 案件云         | `src/lawmind/matter-cloud/`                                                                                                                                                                                                                                                                                                             |
| 客户端脚本     | `scripts/lawmind/lawmind-matter-cloud-server.ts`、`lawmind-matter-replica-cross-machine-probe.ts`                                                                                                                                                                                                                                       |
| 桌面 UI        | `LawmindAgentFleetPanel.tsx`、`LawmindAgentFleetListAside.tsx`、`LawmindAgentFleetDetail.tsx`、`lawmind-fleet-docket.ts`、`LawmindCollabDelegationCards.tsx`、`LawmindCollaborationDesk.tsx`、`matter/MatterReplicaPanel.tsx`、`matter/MatterTeamRosterStrip.tsx`、`LawmindDelegateAssistDialog.tsx`、`stores/fleet-desk-view-store.ts` |
| 文档           | `docs/lawmind/LAWMIND-MATTER-REPLICA.md`、`docs/lawmind/LAWMIND-MATTER-REPLICA-GAP-REVIEW.md`、`docs/lawmind/LAWMIND-COLLABORATION-CAPABILITY-BRIEF.md`                                                                                                                                                                                 |

## 16.12 已知坑

- **被派的助手看不到委派方的对话。** 任务书必须自包含，`goal` / `not_goal` 不是可选装饰。
- **助手结果是不可信内容。** 它会被包上标记，别把那两层标记删掉。
- **委派有深度限制（3）和每助手并发限制（5）。** 不是配置问题，是防递归和防打爆。
- **超时后会真的中断那个回合。** 不只是改状态。
- **`completed_after_timeout` 是真实状态。** 别把它当失败处理。
- **大结果溢出到文件。** 读结果时注意 `resultTruncated` 和 `resultPath`。
- **工作流有循环依赖会被拒。** 定义模板时先想清依赖图。
- **依赖失败会传导成 `skipped`。** 别把 `skipped` 当成功。
- **审查助手没响应时结果标「未经审查」。** 这个标注必须保留，它是有意义的信号。
- **记忆快照在入队时拍。** 排期任务不能等执行时才读偏好。
- **强制互审要求作者和互审人不同。** 只有一个助手时会被跳过（`no_peer` 或 `self_peer`）。
- **在办第一眼是交办册，不是助手花名册。** 按助手排会让 Solo 进门看见编制，而不是还没了结的事。
- **会议室不产生对外法律意见。** 纪要开头的说明不能去掉。
- **会议会话和参会人存在 localStorage。** 换机器就没了。
- **案件副本的加密只保证「看不到内容」，不保证「操作是真的」。** op 还没有签名，中继仍可丢包与重放。
- **明文进出信封现在会被拒。** 这是修过的降级攻击，别把那个检查去掉。
- **材料块必须验哈希。** 不验等于「能写中继的人能往卷宗里塞任意字节」。
- **不做自动冲突合并。** 两份都留盘，人工合。别引入「智能合并」。
- **readonly 角色真的什么都不能做。** 能力列表是空的，不是「只读但能上传」。
- **案件云服务端验不了加密块的哈希。** 这是 E2EE 的固有边界，不是漏检。
