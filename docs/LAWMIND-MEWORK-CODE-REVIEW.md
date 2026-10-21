# LawMind 竞品代码深评：MeWork 桌面端 0.3.20（实机拆包 + 实测）

> 差别在哪，哪些该看齐，哪些还不能定。

这份文档只回答三个问题：他们和我们到底差在哪；哪些地方该向他们看齐；哪些地方现在还不能定。

拆的东西：`app.asar` 解包后，主进程 101 个文件约 1.16 万行全部逐行读完，契约包约 660 行读完，渲染层 233 个 chunk 反格式化到 47.2 万行，其中产品自有约 8.1 万行逐块通读，vendor 按库定性。所以下面写 `文件:行` 的地方，都是我实际读到的代码，不是二手文档的转述。

写法上有一点要交代。最早的一轮全靠拆包读代码，得出的判断有几条后来被真机抓包推翻了。所以正文一律写最终结论，被推翻的旧说法集中放在附录 D。行内出现 `文件:行` 的，是我实际读到的代码位置；出现 `run xxxxxxx` 的，是抓包里的真实 run id。标了"推断"的，是只有字段形状、没有直接证据的判断，不能拿去当结论用。

---

## 目录

- [1 结论](#1-结论)：差别一句话、最该看齐的四件事、需要拍板的事、必须更正的一处
- [2 差别是怎么形成的](#2-差别是怎么形成的)：循环位置、成本、审批门、工具执行面、连接、产品厚度
- [3 逐面对齐](#3-逐面对齐)
- [4 我们该改的](#4-我们该改的)：立刻做、排期做、只记录
- [5 举棋不定](#5-举棋不定)：七个需要你拍板或至少知情的取舍
- [6 还没验证的](#6-还没验证的)
- 附录 A 他们的代码位置 / B 我们的可改点 / C 实测与事故 / D 勘误 / E 复现 / F 证据库

## 1 结论

### 1.1 差别一句话

他们把一个 agent 拆成两半：决策循环放在云上，桌面负责执行工具和记账。我们把循环放在本地。

这个差别不是因为谁的技术更好，而是产品定位逼出来的。他们的智能在云，所以桌面必须能把控制权交出去再收回来；我们的案卷在本地，所以循环只能在本机跑完。后面所有的成本结构、审批位置、可靠性账本，都是这一条推出来的。

### 1.2 最该看齐的四件事

这四条是最高优先，4.2 里还有五条排期项。每条都写了我们这边的代码落点。

| 该做的事                       | 为什么                                                                                                                                                                                                                                    | 落点                                                                                 | 怎么算做完                                                                     |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| 续跑只发增量，不再全量重发     | 我们每轮都把完整历史发给模型（`session.ts:814`、`turn-orchestrator-model-loop.ts:504`），第 N 轮的成本是 N 倍；他们每轮只发上一条 assistant 加本轮工具结果                                                                                | `deriveModelMessagesForSampling` 增加"本轮起点"参数；turn 内维护 head 指针           | 新增 cassette 证明裁剪后仍能正确续跑；同一任务 token 账明显下降；缓存命中不塌  |
| 上下文指标补齐 cached 与固定税 | 他们首轮固定开销 67,864 token，占估算的 99%；缓存命中 99.4%，并把 `cached_tokens` 当一等指标上报                                                                                                                                          | `context-budget.ts` 已有水位，缺"固定税"和"缓存命中"两个对外字段                     | 一次真实首轮能报出 fixed / cached / uncached 三个数                            |
| 给放行补上"人话"表达层         | 他们每个工具第一个参数是 `purpose`，审查把 `purpose` 和 `arguments` 一起送上去，回来的是 `{verdict, reason, review_id}`，理由能直接给律师看。我们的 `approvalMiddleware` 只生成 `操作「${toolName}」需要律师确认`，不带参数也不带 purpose | `runtime/tool-pipeline.ts` 的 approval 分支；浮层在 `LawmindApprovalRequestHost.tsx` | 律师在放行卡上看得到"要干什么、为什么允许、风险是什么"，而不是只看到一个工具名 |
| 引用锚升级为证据锚             | 他们的引用带路径 + sha256 + 行/页/单元格 + 原文 quote，校验 PASSED 才出稿（`ValidateFileReferences`）；我们只有 citation 有效性检查                                                                                                       | `lint/citation-validity.ts` 与 draft 渲染链                                          | 引用可回跳、原文漂移能检出、未通过校验不出稿                                   |

### 1.3 举棋不定的四件事

这四件需要你拍板，理由写在 5.1 到 5.4。另外三件（工具表路线、插件宿主、图片引用）倾向比较明确，放在 5.5 到 5.7。

1. **要不要给案卷写入加"暂停"门。** 这是最重要的一件，因为我们原先以为自己有，实际没有（见 1.5）。
2. **续跑裁剪做到什么程度。** 只裁工具轮，还是连普通对话也裁？裁狠了模型会忘事，裁轻了省不下钱。
3. **子代理和长任务要不要在本地做。** 他们有云端编排，我们只有 `delegate_task` 和协作注册表，能力不对等，但硬做一套本地编排层成本很高。
4. **审查代理要不要加语义层。** 他们的云端审查能看懂 `ls -la` 想干什么；我们的本地判据只看命令形状。

### 1.4 不学的地方

- 不学他们把审批门绑在"进程外副作用"上的分类法。律师场景里文件才是本体，只拦命令和浏览器是不够的。
- 不学两段式网络接力。对齐不变量可以，照着拆自己没必要。
- 不学 Powerbase 那种把所有业务塞进一个 Airtable 的做法。他们的调度、记忆、技能全做成数据项实例，读代码能看见大量"字段缺失、JSON 坏了"的运行时兜底。
- 不学 steer-as-cancel。我们是同一个 turn 内注入，比打断重开更细。

### 1.5 一处必须更正：我们的写入门现在是空的

之前几版文档里我写过"我方 `approvalMiddleware` 覆盖写类工具，manual 档下写盘要拍板"。这句话在源码层面不成立，我核了一遍链路：

`tool-pipeline.ts:646` 的 `approvalMiddleware` 先调 `toolRequiresExplicitApproval`，而这个函数在 `dangerous-tool-policy.ts:60` 第一件事就是：

```ts
const { toolName, allowDangerousToolsWithoutApproval, strictDangerousToolApproval } = args;
if (!toolRequiresLawyerPause(toolName)) {
  return false;
}
```

`toolRequiresLawyerPause` 的定义在 `platform/lawyer-outbound-decision.ts:80`：

```ts
export function toolRequiresLawyerPause(name?: string | null): boolean {
  return irreversibleDisposition(name) === "pause";
}
```

而 `IRREVERSIBLE_TOOLS`（`agent/tool-name-sets.ts` 顶部）里已经没有 `pause` 处置了。注释写得很清楚：自 2026-10-01 起没有 pause 工具，`send_email` 与 `prepare_outbound_mail` 都改成 `inbox_signoff`（只写入待发信，等律师在待发列表批准），`delete_matter` 和 `render_document` 是 `deny_at_source`。

再看 `WRITE_TOOLS`。它确实包含 `write_document`、`apply_surgical_edits`、`run_host_command` 等一大串，但它在 `governance.ts:228/254` 里的作用是推导风险等级和 runtime mode（`lawyer_approved_write`），也就是"留痕口径"，不是"打断律师"。`tool-name-sets.ts:11-13` 的注释原话是：它驱动 `lawyer_approved_write` 分类（audit / runtime mode），**不暂停律师**。

中间件里会返回 `approvalRequest` 的是 `actionPreReviewMiddleware`（`tool-pipeline.ts:596`），而它默认关闭：`resolveActionPreReviewMode` 在 `action-pre-review.ts:127` 读 `LAWMIND_ACTION_PRE_REVIEW`，没设置就是 `off`；即使打开，`ownedByThisLayer` 为真的也只有 `run_host_command` 一类。

不过审批还有第二个来源：具体工具自己返回 `approvalRequest`。`run_host_command` 在 host 访问代理判定需要授权时会返回（`host-tools.ts:357`），邮件工具在伦理墙拦住外发时会返回（`mail-tools.ts:208`、`:365`）。这些是"工具内部的门"，和通用 approval 中间件不是一条路。

只要任何一层返回 `approvalRequest`，turn 都会进 `awaiting_approval`（澄清则是 `awaiting_clarification`），等律师在「待我拍板」里确认后带 `__approved` 恢复。问题只是：通用审批链自己不会触发它。

所以准确的说法是：**通用审批链对写类工具不生效，写文件只留痕；跑本机命令和发邮件另有工具内部的门。** 邮件这道门其实比"暂停"更强——模型根本没有发送能力，只能落到"待发信"等律师批准。

这条更正直接影响后面两处判断：我们和 MeWork 在"写文件"上的差别没有之前写的那么大，真正独有的是"外发必须落待发信"；而"要不要给写入加门"变成一个需要你拍板的问题，不是既有优势。

---

## 2 差别是怎么形成的

### 2.1 循环的位置

先说他们。客户端里没有任何"决定下一步调什么工具"的代码，`ResumableHttpAgent` 只做事件分发。真正的循环在云端，桌面看到的是两种完全不同的 run：

- 调客户端工具（读写文件、跑命令、开浏览器）：这个 run 只采样一次模型就 `RUN_FINISHED`，工具在本地执行完，客户端再发一个新的 `frontend-tool-continue` run，把结果带回去。整条链是 N 个 run 串起来的。
- 调服务端工具（`SpawnSubagent`、`WaitSubagents`、`ReportProgress`）：同一个 run 里连续采样。抓到的 `Mc3aSEJ` 里做了 Spawn、Wait、再 Spawn，一个 run 内四次 `model_call`。

这个统计是拿 45 个 run 逐流数 `context_usage.stage:"model_call"` 得出的：只调客户端工具的 run 全部恰好 1 次，只调服务端工具的 2 到 4 次。

一句典型的话就能看到链条。输入"先建 trace-test.txt，读回来，再列出用过的工具"，产生了三个 run：

| run       | 来源                   | 请求里的消息数                   | 模型决定               |
| --------- | ---------------------- | -------------------------------- | ---------------------- |
| `6Y9cbB2` | user                   | 1（只有用户句）                  | `write_workspace_file` |
| `ojUImOQ` | frontend-tool-continue | 2（上一条 assistant + 工具结果） | `read_workspace_file`  |
| `FO8NIQ2` | frontend-tool-continue | 2                                | 纯文本收尾             |

我们这边是 `runTurn`（`turn-orchestrator.ts`）里面一个 while：采样、执行工具、把结果并回历史、再采样，直到模型不再要工具。没有网络交接，也没有 run 边界。

代价和收益都很直接。他们没有交接成本的问题在于云端可以长时间做编排（子代理、审查、数据查询），代价是每次桌面工具调用都要一次往返和状态链重建；我们没有交接成本，代价是所有工具必须本地可执行。

### 2.2 钱花在哪

他们的续跑请求体只有两条消息：上一条 assistant（带 toolCalls）和这一轮的工具结果。整轮下来，每条消息只发一次，没有重复。上下文由服务端按 `assistantParentMessageId` 链重建。

真实数值是这样的：窗口 1,048,576，`safeInputTokens` 912,384（87%），`triggerTokens` 785,706（75%，自动压缩线）。首轮 `run_start` 估算 68,584 token，其中 `fixedInputTokens` 是 67,864，也就是说系统提示加 23 个工具 schema 就吃掉了 99%，用户那句话不到 1%。实际调用报 50,988 输入，其中 `prompt/cached_tokens` 50,688，命中 99.4%。

落库数据也对得上：每条 assistant 的 `metadata.custom.modelUsageRecords[]` 里是 `clientType:"openai"`，多采样的 run 会挂多条记录（`31EFJE7` 挂 4 条），`cache_creation_tokens` 基本为 0，`cache_read_tokens` 五万级。他们保住缓存前缀靠两件事：工具表指纹不变，续跑不重发历史。

我们这边每一轮都重新构造完整消息列表（`session.ts:814` 的 `deriveModelMessagesForSampling` 从 `conversationHistory` 全量投影），第 N 轮的成本大致是前 N 轮的总和。这是目前最实的一条劣势，不是"实现细节"。

### 2.3 门装在哪

他们的三档模式（逐条确认、自动执行、全部允许）在 UI 上是全局的，但代码里只有声明了 `confirm` spec 的工具才会走那段决策矩阵。全包只有两个工具声明了：`browser` 和 `run_command`。

结果是：manual 档下，写文件、删文件、移动文件、比对文档、导出，全都不问，直接执行。抓到的 `2ngikh4` 就是证据：`write_workspace_file` 拿到 `TOOL_CALL_END` 后立刻执行，续跑 `Ci2PhBF` 带回"已写入 2 字节 → approval-test.txt"，全程没有审批事件。

auto 档下，`run_command` 全部会发 `POST /api/v1/tool-review`。请求长这样：

```json
{
  "conversation_id": "conv_…",
  "tool_call_id": "call_00_j97…",
  "tool_name": "run_command",
  "arguments": { "purpose": "列出工作区目录下所有文件的详细信息（只读操作）", "command": "ls -la" },
  "client": { "type": "desktop", "os": "mac" },
  "workspace_root": "/Users/shl/mework-workspace/conv_…"
}
```

返回 `{"verdict":"allow","reason":"只读列目录，未命中拦截清单","review_id":"24de1b42-…"}`。时序是 `TOOL_CALL_END` 之后、工具执行之前，大约 1.3 秒。

几个实测边界值得记住：`browser` 的普通命令（open/screenshot/get text）在 auto 档不走审查；敏感子命令（eval/upload）会走，但 `browser eval "1+1"` 拿到的是 `allow`，理由是"仅本地计算无外发无敏感读取"；unrestricted 档下，工作区 `rm -rf` 和 `browser eval` 都不发审查，直接执行。`ask` 这个分支从头到尾没有出现过。

我们这边的情况在 1.5 已经说清：通用审批链对写类不生效，跑命令和邮件另有工具内部的门。所以这一节的真实差别不是"我们更严"，而是"他们把门装在命令和浏览器上，我们把门装在外发上（待发信），写文件只留痕"。

### 2.4 工具归谁执行

他们的工具不是一张表，而是五类：

1. 服务端私有：`SpawnSubagent`、`WaitSubagents`、`ReportProgress`。不在客户端工具表里，模型的工具清单由服务端自持。
2. 前端本地：工作区六件套、`run_command`/`check_command`/`kill_command`、`browser`、`present`。
3. 前端壳调服务端算：`CompareFiles`、`ConvertDocToDocx`、`ValidateFileReferences`。读在本地，算在云，写回本地。
4. IntegHub 桥接：实测只有 `audio_transcription`，multipart 上传，流式返回。
5. 子代理减配表：16 个工具，去掉交互与交付类。

主线程工具表固定 23 个，不随任务类型变。子代理减到 16，去掉 `AskUserQuestion`、`Form`、`SuggestProject`、`present`、`ValidateFileReferences`、`checkout_my_skill`、`publish_my_skill`。这个减配的收益是实打实的：子代理线程的上下文大约是父的 60%，省下两万左右固定开销。代价是子代理不能问人、不能交付。

我们自己也有类似的分面（`turn-orchestrator.ts:484`：无任务的 turn 直接把工具表切成 readonly），方向是对的，但还没有把"省了多少"量化出来。

子代理还有一个细节值得注意：他们让子代理和父代理写同一个工作区，靠模型自觉分目录（`subagent-a/`、`subagent-b/`）。两个子代理写同名文件会互相覆盖。我们的 `child-gates.ts` 至少保证"子不得松于父"，边界比他们紧。

### 2.5 连接与多端

他们同一个客户端里有两套长连接，可靠性标准完全不同。

`chat-runs/events` 做得很好：每个事件带单调递增的 seq，断线可以用 `afterSeq` 续传，最多重试 3 次，间隔 1 秒；流被正常关闭时还会调 `latestRun` 对账，因为"流关了"不等于"run 结束了"。

`notifications` 完全相反：整个会话只连一次，失败分支只有一行日志，没有重试、没有退避、没有看门狗。我在补抓审查请求时重启了一次中继，把这条流掐断，后面排队消息的状态就再也送不到客户端，界面表现为"什么都不发生"。后来重启客户端才恢复。

这个缺陷引发过两次现场事故。一次是 steer 之后界面卡住，其实服务端已经自己派发并跑完了答案，只是客户端不知道；另一次是表单句卡在 `delivery:"dispatching"`，因为派发要靠通知流叫醒客户端，通道哑了就永远停在队列里。两次都不是工具的问题，是通道的问题。

多端那边还有一堆税：会话 CAS（`conversationRevision`、409 冲突重试）、按 machineKey 存本地目录映射、队列的 `newer_run_active` 冲突。这些在我们单机架构里都不存在。这是我们的结构优势，但如果将来上 SSE 或多端，必须一次把"seq + 重连 + 终态对账"做对，别重演两套标准。

### 2.6 产品厚度

他们的产品重心不在聊天，在工作台。几个成品面值得我们看清楚：

引用是三层。第一层是文件锚，`@@目标|原文@@` 或隐形哨兵 `\uE000MEFLOW_CITATION_<enc>\uE001`，目标支持行、页、单元格、字段、数据项实例；校验走 `ValidateFileReferences`，返回 `outcome: PASSED/FAILED/INCOMPLETE`，PASSED 才允许出稿；回跳带 `lineRef + quote`，原文漂移能查出来。第二层是文档查看器的定位：NFKC 归一化加中文标点映射再比对，容忍全半角差异，段内命中两次直接报 ambiguous，不猜。第三层是会话里的 `[[cite:]]` 哨兵，流式期间做渐进匹配。

比对是模型可调的前端工具 `CompareFiles`：读两端文件，上传云端算 diff（含 OCR），写回 `.comp.json`，画布打开双栏、词级五态、双向滚动联动。整条链纯本地可复刻，只是把云端算换成本地 diff。

分析表是"每个文件 × 每列 prompt = 一格"，每格带 reasoning 和 evidence 锚，能定位回源文件，能导出带锚的 xlsx。这是尽调批提取的成品形态。

另外还有画布插件宿主（glob 白名单、版本化能力表、保留工具名）、技能 zip 的检出-编辑-发布链（发布前本地备份）、automations（cron 最小 15 分钟、NEEDS_INPUT 续跑）、记忆 scope 串。这些不需要全抄，但规格可以拿来对照。

有一处我们确实缺：他们的消息里能直接渲染 mermaid，按图种懒加载，失败回退代码块。我们目前是裸显代码。法律场景真正需要的其实就两类图，诉讼时序和当事人关系，不用把整个 mermaid 家谱搬进来。

---

## 3 逐面对齐

只列能影响决策的行。✅ 表示机制对得上，△ 表示有对应物但语义不同，⊕ 是我们更强，⊖ 是他们更强，`?` 是看不到。

| 面            | 他们                                               | 我们                                    | 判断                          |
| ------------- | -------------------------------------------------- | --------------------------------------- | ----------------------------- |
| turn 生命周期 | 终态是"没有 pending 前台工具"                      | 终态是模型不再要工具，或 gate 暂停      | 骨架对得上，语义不同          |
| 采样循环      | 云端，同 run 内多次                                | 本地 while                              | 结构异构，各自自洽            |
| 工具轮        | 按 assistant 消息批量，一次 continue 回传 N 条结果 | 同进程批量                              | ✅                            |
| 历史          | 续跑零历史                                         | 每轮全量投影                            | ⊖ 成本差距                    |
| 停止原因      | 只有 run 状态和 cancel reason                      | `TurnStopReason` 十几项，可 replay 分桶 | ⊕                             |
| 中断          | `finalize-dangling` 收沙                           | 派生继续/弃办卡，abort 必须补配对       | 同题不同解                    |
| 压缩          | 云端算，客户端只显示状态                           | 本地 mid-turn 可回放                    | 他们算力强，我们能回放        |
| steer         | cancel 换 run，服务端派发队列                      | 同 turn 注入                            | △ 我们更细                    |
| 并发          | 同会话多窗，上限 2                                 | 并发会话抢模型槽                        | △ 对象不同                    |
| 审批          | 只拦命令与浏览器                                   | 运行期不拦写入，外发落待发信            | 需要决策，见 5.1              |
| 审查          | 云端语义审查，40s 超时，不可用回退 ask             | 本地参数判据，默认关                    | 可组合，非替代                |
| 工具表        | 固定 23 / 子 16                                    | ≤12 核心 + 场景披露                     | 我们省 token，他们省复杂度    |
| 子代理        | 云端编排，共享工作区                               | 本地委派，子不得松于父                  | 他们编排强，我们边界紧        |
| 后台命令      | 立即返回 task_id，kill 有 lost / killed 两态       | 有后台与 kill                           | ✅ 语义对齐                   |
| 图片          | 上传后只回 file_id                                 | 本地引用优先                            | 他们省上下文，我们保数据边界  |
| 引用          | 三层 + PASSED 出稿门                               | citation 有效性 + malformed             | ⊖ 工程完整度                  |
| 长连接        | 两套标准，通知流无重连                             | 单机                                    | 我们无税，但上 SSE 要一次做对 |
| 法律垂直      | 无                                                 | 法宝、法规、案例、审计链                | ⊕                             |

---

## 4 我们该改的

分三档：立刻做、排期做、只记录。每条都写了代码落点和验收，避免变成口号。

### 4.1 立刻做

**一、把"续跑发增量"做成可验证的改造，而不是一次性重构。**

动机很直接：对方第 10 轮工具循环只发两条消息，我们发全量。现在 `deriveModelMessagesForSampling`（`session.ts:814`）一次性投影整段 `conversationHistory`，`callModelWithRetry` 每轮都拿这个全量（`turn-orchestrator-model-loop.ts:504`）。改法是给投影加一个"本轮起点"参数，turn 内记录上一次 assistant 消息的位置，工具轮只投"上一条 assistant + 本轮新增工具结果"。

不能直接砍。模型在增量历史下可能丢掉前文的约束（比如"只用中文""不要动第二份合同"）。所以先写 cassette：同一个任务，裁与不裁两版，断言下一请求体的差异，再断言模型仍然调对工具。仓库对 turn-orchestrator 的改动本来就要求 cassette 准入，这条正好用上。

验收三个数：同一任务的输入 token 账、缓存命中率、工具调用正确率。前两个要降/不降，第三个不能掉。

**二、把固定税和缓存命中变成可观测的数。**

他们对外的 `context_usage` 有四个值：`inputTokens`、`contextWindow`、`safeInputTokens`、`triggerTokens`，外加 `fixedInputTokens`；`token_usage` 里还单独报 `prompt/cached_tokens`。我们现在有 `context-budget.ts` 的水位（ok/warn/compact），但没有"固定税"这个概念，也没有把缓存命中当指标。

改法不复杂：首轮估算时把系统提示和工具 schema 的 token 单独算出来，作为 `fixedInputTokens` 事件发出；模型返回后把 `cached_tokens` 记进 usage。做完之后，A1 的效果才有对照系，否则只是感觉变快了。

**三、放行卡补"人话"。**

他们的 `purpose` 是每个工具的第一参数，描述里写死"一句简短中文动宾短语，仅用于向用户展示"；审查请求把 `purpose` 和 `arguments` 一起送上去，返回的 `reason` 是"只读列目录，未命中拦截清单"这种律师能读懂的话。

我们的审批浮层是有的（`LawmindApprovalRequestHost.tsx`），问题在理由太薄：`approvalMiddleware` 只拼了一句 `操作「${toolName}」需要律师在「待我拍板」中确认。`，不带参数、不带目的。律师看到的是工具名，不是"它要改哪份合同"。

这条是低风险高感知的活。先在 `run_host_command` 和写类工具上要求 purpose，把 `purpose` 和关键参数（目标路径、命令）拼进 reason。注意别做成多一步点击，否则律师会烦。

### 4.2 排期做

**四、证据级引用锚。**

这是产品叙事最值钱的一块，也是他们工程完整度最高的地方。最低可用的版本包含四件：引用记录里存 `path + sha256 + lineRef + quote`；渲染成可点击的锚；点击后打开源文件并定位；定位前做归一化比对（NFKC + 中文标点映射 + 去空白），段内命中两次就报歧义，不猜。等这套稳定了，再加"PASSED 才出稿"的门。

我们的 `citation-validity.ts` 已经有 `citation.malformed`，可以把它当成第一道闸，和锚校验串起来。docx 的段落锚、PDF 的页锚、xlsx 的单元格锚，可以先做 docx 一种，别一次铺开。

**五、本地比对闭环。**

他们的 `CompareFiles` 交互值得照搬，但算力不必上云。我们已经有 word revision 与 docx 渲染链，缺的是"读两端 → 本地文本提取 + 词级 diff → 写 `.lawmind-diff.json` → 面板打开 → 重复比对复用同一路径"。做完之后，尽调和改稿这两个高频动作就不用把文件传出去。

**六、分析表交付物。**

"每个文件 × 每列 prompt = 一格，每格带 evidence 锚"这个形态，本质是把批量提取变成可审计的表格。我们的交付物体系可以加一个 type，先支持文本列和单选列，导出 xlsx 时把锚带上。不要一开始就做共享列和跨表复用，那是他们做到后期才有的复杂度。

**七、事件流的 seq 与对账。**

如果我们短期内要上桌面 SSE（子代理并行、监控面板都会逼出来），一次做对：事件带单调 seq、断线用 afterSeq 续传、流关闭后对账终态。他们 `chat-runs/events` 的实现可以直接当协议参考，`notifications` 则是不该学的反例。

**八、限域图形。**

他们消息里能渲染 mermaid，按图种懒加载，失败回退代码块，超时有 `MermaidStepTimeoutError` 保护。法律场景不需要整个图库，只要两类：诉讼时序和当事人关系。可以先做一个轻量 SVG 组件，从交付物模板里生成，不引 mermaid 全谱。

**九、分享与交付前的依赖校验。**

他们分享前会检查引用闭包（"依赖的源文件 X 不存在，无法完整分享"），工作区写入带 `{actor, plugin}` 归因和 412 created 冲突。我们交付物导出前也应该做一次依赖检查，审计链事件里带上 actor/plugin。这条不难，但能挡住"发出去少了一个附件"这类事故。

### 4.3 只记录，不动手

- 契约包单源、双端字符串逐字对齐：方向对，但我们目前没有第二个消费方，先不做微包。
- 工具表的两种路线：他们固定 23 个，我们 `CORE_MODEL_TOOL_NAMES` 加 `list_more_tools`。方向已经有，缺的是同一批任务下的正确率与 token 对比数据。
- 子进程 env 默认拒绝白名单：我们主进程 spawn 的东西还不多，等 `run_host_command` 面扩大再做。
- 随包二进制 VERSION 哨兵：等我们真的随包带二进制再说。
- 读工具的分窗扫描加 `char_offset` 续读：合同全文 JSON 场景确实会疼，但优先级低于 A1。
- 插件宿主：见 5.6，先定"开不开"，再谈蓝本。
- 判变指纹用 `dev:ino:size:mtimeNs:ctimeNs`：等 citation memory 的文件 watch 真出问题再换。
- 退出与崩溃恢复日志：他们的 `run-state-journal.json` 在启动时读回来标恢复线程，配合 quit-coordinator 和 power-save 事件。我们的长任务将来会遇到同型问题，先记着。
- 遥测参数表：本地缓冲 ≥10 条或 5 秒、上限 200、批量 50、`navigator.sendBeacon` on hidden/pagehide，route 里的 UUID 换成 `:id`。这套参数可以直接抄。
- 调度与记忆的规格：cron 最小间隔 15 分钟、时区白名单 9 个洲区、once 必须带时区；记忆 scope 用逗号分隔的 `client/os/project` 串。做本地常设工作与记忆作用域时拿来对照。
- 技能发布链：检出到编辑目录、发布前本地备份旧版、备份失败就放弃发布。我们已经有 builtin skill，等要开放用户编辑时再照这个流程做。

---

## 5 举棋不定

这一节是给你拍板用的。每条我都写了两种做法、各自的理由、以及"还需要什么证据才能定"。

### 5.1 要不要给案卷写入加暂停门

**选项 A：加。** 写类工具在 strict 或 manual 档下暂停，等律师点确认。理由是律师最怕文件被改，而 MeWork 恰好不拦写文件，这是我们能做差异的地方。

**选项 B：不加，维持"留痕 + 外发待发信"。** 理由是写文件是律师的日常动作，每次弹卡会毁掉效率；真正的风险在"发出去"，而我们的 `send_email` 根本不发，只落待发信，这比暂停更强。

就写类工具而言，现在的事实是 B：通用审批链早退，pre-review 默认关。所以问题不是改几行代码，而是要不要改产品哲学。

如果走 A，落点在 `platform/action-pre-review.ts`：现在它只把 `run_host_command` 标成 `ownedByThisLayer`，需要把写类工具也纳入，并让 `shouldAsk` 在 strict 档生效。同时要处理 `__approved` 的恢复路径，避免和 `awaiting_approval` 的现有文案打架。

我的倾向：**分档**。standard 档保持 B；strict 档给"覆盖已有文件"和"删除"两类加暂停，新建文件不拦。这样既不打扰日常起草，又挡住不可逆动作。但我没有替你定，因为这取决于你们对律师工作流的判断。

需要的信息：真实使用中"写文件"被撤销/覆盖的频率；律师对弹卡的容忍度；strict 档目前的实际使用比例。

### 5.2 续跑裁剪做到什么程度

选项 A 是只裁工具轮（一个 turn 内的多次采样）；选项 B 是连跨 turn 的普通对话也裁，只保留摘要加最近几轮。

A 的风险小、收益明确，因为工具轮的消息形状固定（assistant + tool result），裁掉前面的不影响当前决策。B 的收益更大，但会碰上下文连续性，尤其是长合同审阅这种需要反复回看的任务。

我的倾向：先做 A，跑一段时间看 token 账和回答质量，再决定 B。B 更像是"压缩策略"的问题，不是"续跑"的问题，可以和 `compact.ts` 一起考虑。

### 5.3 子代理和长任务要不要在本地做

他们有云端编排（`SpawnSubagent` + `WaitSubagents` + `ReportProgress`），能一个 run 内连续派活、等待、再派。我们只有 `delegate_task` 和协作注册表，还是一个 turn 内调一次。

选项 A 是补一个本地任务编排层：独立 run、独立工具表、显式进度上报。选项 B 是不做，把长任务拆成用户可见的多步，靠用户推进。

A 的成本不小：要处理并发、取消、结果汇总、工作区写冲突（他们已经踩过共享工作区的坑）。B 的体验差，但不会引入新的状态机。

我的倾向：**暂不做通用编排层，只做"一个受限子任务"**——比如"批量读 20 份合同并提取条款"，子任务只给只读工具和写报告工具，固定上限。这样能覆盖大部分长任务，又不用做完整的调度器。

### 5.4 审查代理要不要加语义层

选项 A 是保持纯本地确定性判据，快、可审计、无网络。选项 B 是加一层语义判断（本地小模型或可选云端），能识别"这条命令表面只读、实际在探测"。

他们的云端审查有 40 秒超时，不可用回退 ask。这个设计对我们不划算：律师在本地工作时不该等网络。

我的倾向：**保持本地为主，语义层做成可选**，且只在 shadow 模式先跑，积累误报/漏报数据。等有证据说明本地判据漏了哪一类，再考虑接。

### 5.5 工具表：固定分面还是动态披露

他们是固定 23 个，靠缓存抵消固定税；我们是核心工具加 `list_more_tools` 动态披露。我们的方式省 token，但模型可能"不知道该有什么工具"，多一次探索。

这条可以量化：拿同一批任务，分别用固定表和动态披露跑，比较工具调用正确率和总 token。现在没有这个数据，只能算"方向对，程度未知"。

我的倾向：**维持动态披露**，先补一组测量数据。如果正确率明显低，再退回"固定核心表 + 少量扩展"。

### 5.6 插件宿主开不开

他们的画布插件宿主做得很完整（manifest 版本、能力表 `since`、glob 白名单、工具名保留、超时上限）。开，意味着我们有一个第三方扩展叙事；不开，意味着我们是唯一没有扩展位的工作台。

但插件会带来新的信任边界：插件能读工作区、能声明工具、能跑代码。我们现在的安全模型是"单机单用户、本地可信"，插件的引入会打破这个假设。

我的倾向：**先不开**。等有真实的"用户想自己加面板"的需求，再按他们的蓝本做，而且第一版只允许声明式面板（不跑任意代码）。

### 5.7 图片：本地引用还是上传换上下文

他们上传后只回 `file_id`，历史里不占字节，代价是内容出本机。我们本地优先，应该保留 `path + sha256` 引用，只在需要视觉理解时临时把图送进模型。

我的倾向很明确：**本地引用为默认**。法律场景图片（证据照片、扫描件）不适合默认上传；要做的是"临时送入"时的显式提示，让律师知道这一次图片离开了本机。

---

## 6 还没验证的

诚实列一下，免得把推断当结论。

- 云端的系统提示词、每轮裁剪算法、压缩算法、停止判据、重试策略、模型路由。这些结构上看不到，除非拿到服务端源码。
- `tool-review` 的 `ask` 分支和拦截清单。我们只见过 `allow`，unrestricted 下连审查都不发。
- 澄清超时 60 秒的真实行为。契约写了"超时走推荐项，但授权类超时不构成同意"，我们只验证了"忽略"（`ignored:true`）。
- 压缩真实触发。需要灌到 78 万 token 左右，成本高，而且触发了也看不到算法。
- `RUN_ERROR` 的恢复路径。没制造过服务端错误。
- 进行中的 `protocolState` 非空形态。completed 检查点会清空 `execution_started_tool_call_ids`，要抓只能在 run 跑的时候抓。
- 双窗同会话争用。0.3.20 没有第二窗入口，`maxConcurrentThreads=2` 测不到。
- 我方 `live-turn-progress` 在暂停时被标 failed 的问题。代码确认了（`turn-orchestrator.ts:793-794`：先发 `status:"paused"`，紧接着 `ensureLiveProgressFinished("failed")`），但还没修。

---

## 附录 A 他们的关键代码位置

| 结论              | 位置                                                                                                               |
| ----------------- | ------------------------------------------------------------------------------------------------------------------ |
| 窗口与 IPC 加固   | `dist/desktop/src/main/index.js:288`、`:120-126`、`:411-423`、`:431-437`、`:442-469`；`ipc/sender-policy.js`       |
| 导航三元组        | `navigation-policy.js:26-27`、`:92-100`                                                                            |
| 路径围栏与 TOCTOU | `workspace/paths.js`、`packages/desktop-contract/src/workspace-path.js:20-24`、`sync/scan.js:170-176`              |
| 子进程 env 白名单 | `command/env.js`、`env.js:20`、`:23`、`executor.js:9-11`                                                           |
| browser 白名单    | `browser/args.js:17-21`、`manager.js:9`、`:800`                                                                    |
| 网关钉环境 / 流桥 | `gateway/server.js:55`、`:15-24`、`stream-client.js:5-9`、`:66-105`                                                |
| `/localfs` 无鉴权 | `gateway/localfs.js:7`                                                                                             |
| 同步默认关闭      | `config-store.js:176`、`workspace/sync/engine.js`、`scan.js:62`                                                    |
| 审批决策矩阵      | 渲染层 `conversation-sidebar` 的 `lc()` + `app-shell` 的 `dg()`                                                    |
| 审查契约          | `app-shell:5354`、`POST /api/v1/tool-review`                                                                       |
| 续跑骨架          | thread core（`citation-sources-footer-BdwGL9KC.js` 约 2270–4200 行）、`ResumableHttpAgent` 的 `ks` 类 8549–9575 行 |
| 引用锚            | `registry-context:7685-7701`、`:7699-7712`；`app-shell:4683`；viewer chunk `[meflow citation locate]`              |
| 比对              | `comparison-doc-diff`（产品区约 950 行）、`app-shell:4027-4240`                                                    |
| 画布插件宿主      | `browser-DpqZjl4W`（1,583 行）                                                                                     |
| 分析表            | `canvas-extensions`                                                                                                |
| 模型目录          | `GET /agent/api/v1/models`                                                                                         |

## 附录 B 我们这边可以动的位置

| 要改的事          | 位置                                                                                                           | 现状                            |
| ----------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| 续跑裁剪          | `agent/session.ts:814`、`agent/turn-orchestrator-model-loop.ts:504`                                            | 全量投影                        |
| 固定税 / 缓存指标 | `agent/context-budget.ts`、`context-tuning.ts`                                                                 | 只有水位，无 fixed/cached       |
| 写入门            | `runtime/tool-pipeline.ts:646`、`agent/dangerous-tool-policy.ts:60`、`platform/lawyer-outbound-decision.ts:80` | 写类早退，不暂停                |
| 预审              | `platform/action-pre-review.ts:127`、`runtime/tool-pipeline.ts:596`                                            | 默认 off，只管 run_host_command |
| 外发待发信        | `agent/tool-name-sets.ts`（`IRREVERSIBLE_TOOLS`）                                                              | `inbox_signoff`，不发           |
| 工具表分面        | `agent/turn-orchestrator.ts:484`                                                                               | 无任务切 readonly               |
| 子代理边界        | `agent/child-gates.ts`                                                                                         | 子不得松于父                    |
| 暂停态被标 failed | `agent/turn-orchestrator.ts:793-794`                                                                           | 未修                            |
| 引用畸形检测      | `lint/citation-validity.ts:22`                                                                                 | 已有 `citation.malformed`       |

## 附录 C 实测记录与事故

抓包用产品自带的 `MEWORK_SERVER_URL` 指向本地中继，没有改包，也没有装证书。中继落盘包含请求体、SSE、review 出入参。

几个关键 run：`6Y9cbB2`（write）、`ojUImOQ` / `FO8NIQ2`（continue）、`2ngikh4`（manual 审批）、`AYsIJEI`（steer 目标）、`Mc3aSEJ`（服务端多采样四次）、`IFg1Klk`（checkpoint）、`qs9hn7k`（completed 后游标清空）。

两次事故都跟通知流有关。一次是重启中继掐断了 `notifications`，排队消息不再送达，界面卡住；另一次是表单句卡在 `dispatching`，因为派发要靠通知流叫醒客户端。两次恢复方式都是整退冷启、新开空会话。

## 附录 D 勘误

| 旧说法                                | 实际                                                                      |
| ------------------------------------- | ------------------------------------------------------------------------- |
| manual 档服务端不下发 `TOOL_CALL_END` | 错，END 照发，门在客户端                                                  |
| 三档模式对所有工具逐条确认            | 只有 `browser` 和 `run_command` 有 confirm spec                           |
| 敏感命令才走审查                      | auto 档所有 `run_command` 都走                                            |
| 循环是"云端单轮 + 客户端续跑"         | 服务端工具同 run 多采样，客户端工具才断链                                 |
| 续跑可能重发部分历史                  | 零历史，每次只发上一条 assistant 加结果                                   |
| steer 后要客户端手动派发              | 服务端自己派发并跑完 UUID run                                             |
| `protocolState` 是 agent 状态机       | 是流式拼装游标                                                            |
| 工具有四处同构                        | 五类执行面，服务端私有工具不上客户端表                                    |
| 子代理客户端轮询编排                  | 云端编排，客户端只做 dangling 执行                                        |
| 图片以 base64 进上下文                | 上传后只回 `file_id`                                                      |
| `kill_command` 只有 `lost`            | 活任务会返回 `killed` + `user_kill`                                       |
| 我们的写类审批覆盖 `WRITE_TOOLS`      | 不成立，`toolRequiresExplicitApproval` 早退，`WRITE_TOOLS` 只影响留痕口径 |
| 时间戳 10:0x                          | 中继落盘是 UTC，本地是 +8，实际是 02:0x                                   |

## 附录 E 复现

中继在 `/tmp/mework-trace/relay.mjs`，启动时把 `MEWORK_SERVER_URL` 指到 `http://127.0.0.1:17999`。分析脚本有 `an-bodies.mjs`（请求体）、`an-sse.mjs`（事件序列）、`infer-cloud.mjs`（四管道推断）。

两条纪律：中继重启会掐断通知流，多轮实验要么让中继常驻，要么实验后重启客户端；后台杀任务要等返回 `task_id` 再杀，否则模型只会查到空任务列表。

---

## 附录 F 证据库

主文为了可读性压掉了细节，这里把支撑结论的原始事实存下来。需要复核时看这一节。

### F.0 观测方法

对象是 `MeWork-0.3.20-mac-arm64.dmg`，用 `@electron/asar` 从 `app.asar` 解出源码。运行面没有改包，也没有装证书，只用了产品自带的覆盖位：`dist/desktop/src/main/preset-settings.js` 里的 `PRESET_SERVER_URL_ENV`（也就是 `MEWORK_SERVER_URL`），把网关反代指到本地中继 `http://127.0.0.1:17999`。中继是 `relay.mjs`，http 到 https 原样透传，落 `requests.jsonl`、`*-chatrun-body-*.log`、`*-sse-*.log`、`review-req` / `review-res`、`json-res`。关掉该实例正常启动就恢复原状。

启动可以用 `start-relay.command` 或 `MeWork-via-relay.command`。不要让裸 `node` 常驻，容易被会话回收。

分析脚本：`an-bodies.mjs`、`an-sse.mjs`、`infer-cloud.mjs`（输出 `cloud-inference.json`）。批读笔记是 `notes-batch-2.md`。中继时间戳是 UTC，本地是 +8，早期把 02:0x 记成 10:0x 就是这个原因。

### F.1 协议样本

**工具审查（`run_command`，auto 档）**

```json
// POST /api/v1/tool-review
{"conversation_id":"conv_…","tool_call_id":"call_00_j97…","tool_name":"run_command",
 "arguments":{"purpose":"列出工作区目录下所有文件的详细信息（只读操作）","command":"ls -la"},
 "client":{"type":"desktop","os":"mac"},"workspace_root":"/Users/shl/mework-workspace/conv_…"}

// 200
{"verdict":"allow","reason":"只读列目录，未命中拦截清单","review_id":"24de1b42-…"}
```

时序：`TOOL_CALL_END` 15:41:49.1 → review 15:41:49.7 → 执行 → 续跑 15:41:51.2。审查发生在 END 之后、执行之前，是第二道门。

**续跑请求体（`ojUImOQ`）**

```json
{
  "messages": [
    {
      "role": "assistant",
      "toolCalls": [
        { "id": "call_…", "function": { "name": "write_workspace_file", "arguments": "{…}" } }
      ]
    },
    {
      "role": "tool",
      "toolCallId": "call_…",
      "content": "{\"output\":\"已写入 5 字节 → trace-test.txt\"}"
    }
  ]
}
```

只有两条。整轮下来每条消息只出现一次，靠 `forwardedProps.runConfig.branch.assistantParentMessageId` 让服务端重建上下文。

**checkpoint（`IFg1Klk`，`lastEventSeq === checkpointSeq === 24`）**

```json
{
  "protocolState": {
    "current_text_part_key": "text-1",
    "current_reasoning_key": null,
    "reasoning_active": false,
    "logical_message_id": null,
    "message_id": "1Va5jnm",
    "text_part_counter": 1,
    "reasoning_counter": 0,
    "execution_started_tool_call_ids": [],
    "part_order": [{ "kind": "text", "key": "text-1", "tool_call_id": null }]
  }
}
```

`checkpoint` 里还有 `assistantMessage`（`status:{type:"complete",reason:"stop"}`、`content[]`、`usage`）和 `error:null`。`protocolState` 是流式拼装游标：当前 text part、reasoning 状态、计数器、已开始执行的工具 id、part 顺序。completed 时工具 id 会被清空，`qs9hn7k` 在跑了长工具链之后仍然是空数组。

**图片链路**

```
browser(screenshot) → workspace_files:[{"path":"example-com.png","size":172159}]
POST /api/v1/file/upload            172,444 B
ViewImage(path) → {"file_id":"2112211192498401282","path":"example-com.png",
                   "media_type":"image/png","scope":"c:conv_…"}
present(path)   → {"mode":"deliver","deliveredPaths":["example-com.png"],
                   "failed":[],"preview":{"path":"example-com.png","opened":true}}
POST /conversations/:id/canvas/open 26 B
```

**后台与 kill**

```
run_command({"command":"sleep 30","background":true,"timeout":120})
  → {"task_id":"bg_d9a83561c106","status":"running"}
check_command → {"status":"running","runtime_seconds":3}

冷启后 kill → {"status":"lost"}
活任务 kill（bg_bc34943baad1）→ {"status":"killed","runtime_seconds":10,
                                  "exit_code":-1,"reason":"user_kill"}
```

第一次实验失败的原因是没等 `task_id` 就发"杀掉"，模型只能调 `check_command`，拿到 `tasks:[]`。

**澄清**

`AskUserQuestion` 正常提交后 continue 带回 `answers`；`Form` 带回 `{"values":{"project_name":"测试","deadline":"2026-10-21","urgent":true},"fields":[…]}`；点"忽略并继续"带回 `{"answers":[{"header":"方案选择","ignored":true}]}`，没有 selected_options。

**客户端工具指纹与上下文注入**

会话 GET 里 `metadata.clientTools.desktop` 是 `{fingerprint: sha256, declaredAt, tools[23]}`，云端按指纹校验这次 run 声明的工具和客户端注册的一致。上下文注入走 `role:"user"` 加 `metadata.custom.type:"context"`（日期、客户端环境、子任务通知），模型可见，UI 可以按 type 隐藏。出站 body 的 `state` 和 `context` 恒为空。

**模型调用记录（落库侧）**

每条 assistant 的 `metadata.custom.modelUsageRecords[]` 里有 `clientType:"openai"`、`requestedModel` / `responseModel`（例如 `deepseek-flash`）、`providerResponseId`、`billingScope:"user"`、`operation:"agent"`。多采样的 run 会挂多条记录（`31EFJE7` 挂 4 条），`uncached_input_tokens` 一两百，`cache_read_tokens` 五万级，`cache_creation_tokens` 为 0，`completion/reasoning_tokens` 单独记。`chat-runs/latest` 的 `ownerId` 形如 `agent-<pod>-<id>`，说明云端跑在容器编排上（推断）。

**模型目录**

`GET /agent/api/v1/models` 返回 10+ 条，字段 `{model_id, model_name, display_name, description, is_default, client_type, supports_vision, cost_multiplier, thinking_effort, thinking_effort_options}`。倍率 0.29（GLM-5.3-Flash）到 3.88（Kimi-K3），默认 `Deepseek-v4.1-Flash` 是 0.33，思考档 low/high/max。有"旧 ID 兼容，请勿新选"的映射条目（`Deepseek-v4-Flash-Vision` → `deepseek-flash`）。目录文案有个 bug：某条 high 的显示名写成"（low）"。客户端没有 BYO 入口。

### F.2 安全与执行面

**窗口与 IPC**：`index.js:288` 的 `webPreferences` 开 `contextIsolation` 和 `sandbox`，关 `nodeIntegration`，按环境分 partition；`dist/desktop/src/preload/index.js` 只暴露命名方法，推送不回传 `IpcRendererEvent`（`index.js:120-126` 注释解释 ports 泄露风险）；`ipc/sender-policy.js` 和 `policies.js` 对所有 handle 做 sender URL 白名单，frame 已销毁即不可信（`sender-policy.js:3-5`）；OAuth 弹窗强制 `preload: undefined + sandbox: true`（`index.js:411-423`）。

**导航**：`navigation-policy.js` 按"目标 URL × 发起文档 URL × 触发形态"三元组判定。协议闸优先于 origin，因为 `blob:` 的 origin 会伪装成派生源（`:26-27`）。外链投系统浏览器时把 `http://127.0.0.1:<port>/legal/...` 改写成公网站点（`:92-100`）。子帧用自身 origin 判定。三个渠道都覆盖（will-frame-navigate、will-redirect、setWindowOpenHandler），子窗递归挂策略（`index.js:442-469`）。拿不到帧上下文时放行留痕，注释写了代价（`index.js:431-437`）。

**路径**：`workspace/paths.js` 与 `packages/desktop-contract/src/workspace-path.js`。`validateRelPath` 拒空、控制字符、绝对路径、`..` 段，文案和 Go 侧逐字一致。词法折叠保留前导 `..`，不把 `../x` 静默折成 `x`（`:20-24`）。`resolveInWorkspace` 逐段 lstat 拒 symlink，EACCES / ENOTDIR 分别归到 `PathSegmentStatError`。Windows 覆盖盘符、UNC、保留设备名、大小写不敏感。TOCTOU 用 `O_NOFOLLOW | O_NONBLOCK` 加 fstat 指纹复核（`openSyncFile`），打开后还会复审路径链，再复审路径链（`sync/scan.js:170-176` 的 `openSyncFile`），注释诚实写明残余窗口。

**子进程**：`command/shell.js` 解析用户默认 shell，POSIX 白名单是 zsh/bash/sh，fish 排除并写了理由；win32 用 pwsh `-NoProfile -NonInteractive -ExecutionPolicy Bypass`。`command/env.js` 默认拒绝白名单，不继承 `process.env`，`NODE_OPTIONS` 刻意不放（`env.js:23`），注释自认导出代理 env 有暴露面（`:20`）。退出收尾靠 `exit + 200ms drain + close 抢跑`（`executor.js:9-11`），防止后台进程继承管道导致 `close` 永不触发。后台任务每会话 2 个，墙钟 600 秒，SIGTERM 后 5 秒树杀。

**browser**：`browser/args.js:17-21` 是 59 个只读/交互子命令的白名单（agent-browser 0.31.1，升版要过 `docs/agent-browser-coupling.md` 的耦合清单），排除 install/upgrade/connect/mcp/session/auth/state/cookies，`--state` 和 `file://` 都拒。cwd 固定在私有目录（`manager.js:9`），因为 agent-browser 会读 `./agent-browser.json`，落进工作区等于把配置注入面递给模型。per-env 持久 profile，代价是 ProcessSingleton，所以做单并发 LRU，接管提示塞进下一条命令输出（`manager.js:800` 附近 `takenOverScopes`）。

**网关**：只绑 127.0.0.1（`server.js:55`）。`x-mework-desktop-env` 钉环境头，不一致直接 421 且不转发（`:15-24`）。stream 桥路径 allowlist 是 `/api /agent /v3/api-docs`，8 个 forbidden header，头名走 RFC7230 正则，丢 set-cookie（`stream-client.js:66-105`）。动机是 Chromium 每源 6 连接被多会话 SSE 吃光，fetch 饿死，所以长连接改由 main 的 Node http 发起（`:5-9`）。

**负清单**：`/localfs` 不做鉴权（`gateway/localfs.js:7` 明说本机进程视为可信）。这条值得写进我们的 `SECURITY.md`：loopback 等于同用户是个伪设，macOS 上别的用户也能连；附件物化只限 http/https，不限 host（`materialize.js` 的 `fetchAttachmentBytes`）；`sanitizeId` 把非法字符替换成下划线（`mappings.js:29`），`a/b` 和 `a_b` 会撞同一目录（`a/../..` 这类折叠后仍保留前导 `..` 的路径会被 `validateRelPath` 拒掉）；未签名包在 Squirrel.Mac 验签必然失败（`updater/updater.js:17` 自认）。

**同步**：默认关闭（`config-store.js:176`）。`workspace/sync/engine.js` 三阶段提交；此前 PS1 BOM 事故编号 `conv_1786327512317_2mpfckr` 就写在 `workspace/text-encoding.js` 的注释里。三阶段提交：prepare（控制面，带 cookie）→ 预签名 ticket → staging PUT 直传 OSS → commit 记账。失败不推进，永久拒绝码按指纹记死。排除 node_modules、.git、.venv、`__pycache__`、Office 锁文件、`.mework/` 非 user 路径。超过 2000 文件整体不同步，不做部分镜像（`scan.js:62`）。墓碑解决 Word 非原子保存。

### F.3 客户端编排

**两段式**：服务端工具同 run 内多次采样，客户端工具必然断链。45 个 run 的 `model_call` 统计：客户端工具类全部 1 次（`6Y9cbB2`、`KecVEas`、`EQVakIU`、`OtfcwE7`、`uKkjIgW`），服务端工具类 2–4 次（`ufLsCmB` 两次、`Mc3aSEJ` 四次）。

**客户端骨架**：`append(user)` → `beginRootRunStart` / `awaitRootRunStartStep`（可取消阶段）→ 注入 context delta → `startRun("user")`。收到 `TOOL_CALL_END` 且未被服务端解决，就本地执行 → `addToolResult` → `scheduleAutoContinue(≈100ms)`。`RUN_FINISHED` 时若还有 pending，不通知终态。`tryAutoContinue` → `startFrontendToolContinueRun` → `startDedupedContinueRun` → 新 run，只带 continuation 片段。直到没有可续跑的尾部，才 `notifyTerminalRunFinishedOnce`。

**出站历史**：`buildRunInput` 配 `selectOutgoingHistory` 只拿 continuation 片段。运行时还有 `isRunning` / `shouldAbort` 两个状态位控制何时允许取消。

**传输层**：自研约 1000 行（`ks` 类 8549–9575 行），下面是开源 `@ag-ui/client`。每个事件必须有单调递增整数 `id`，缺 id 或倒序直接抛错；`afterSeq` 续传；`[DONE]` 终结；断线重试 3 次、间隔 1 秒。干净关闭时 `shouldReplayAfterCleanClose` 调 `latestRun` 对比 `lastEventSeq`，因为服务端 run 可能还在跑。终态事件是 `RUN_FINISHED / RUN_ERROR / RUN_CANCELLED`，状态机 `pending/running/cancelling/completed/failed/cancelled`。cancel 的 reason 枚举是 `user_cancelled / timeout / error / client_disconnected / steer`，5 秒超时。

**竞态**：`frontendToolRunEpoch` 每次 `startRun` 自增，迟到的工具结果按 epoch 丢弃。结果三集合仲裁：`serverResolvedToolCallIds`、`fallbackAnsweredToolCallIds`、`completedFrontendToolResults`；服务端先给 `TOOL_CALL_RESULT` 就中止本地执行，服务端胜出。

**恢复**：`executeDanglingFrontendToolsOnAttach` 与 `executeDanglingFrontendToolsFromMessages` 负责接管时执行悬空工具；`diagRunFinishedSnapshot` 对无主工具调用告警。`findRecoverableFrontendToolTail` 要求最后一条是 tool-call，其后只能是空白 text/reasoning，每个 tool-call 都有 result，`cancelled/errored` 不算可恢复，锚点取最后一个已完成的前台工具调用。任一不满足就 `abandonAutoContinueAndNotifyRunFinished`。取消时 `cancelInternal` 先把所有 pending 前台工具写成 cancelled（`settlePendingFrontendToolCallsAsCancelled`），再 abort、再发 cancel API、再轮询终态。

**并发**：`maxConcurrentThreads = 2` 只管同一会话多窗。切走降级 `background`，带 `activationGeneration`；`executionPolicy:"active-thread"` 的工具重新激活要校验 generation 和定义指纹（`waitUntilThreadActive`、`waitUntilActive`、`awaitingActiveThreadToolCalls`），失效报"前端工具定义已失效"。

**自定义事件**：`tool_output` 分通道流式回传 stdout/stderr，带截断标记；`tool_call_args_final` 用 `overrideToolCallArgs` 覆盖流式拼出的参数；`partialToolCallArgs` 供 UI 实时渲染。`STATE_DELTA` 被显式忽略并打日志，只消费 `STATE_SNAPSHOT`。

**子代理**：`SpawnSubagent(wait:true)` 由服务端阻塞；`wait:false` 立即返回 running，父模型要显式调 `WaitSubagents`。子线程以 `origin:"dangling-execute"` 起步，客户端发现未执行的工具调用就地执行，再 `frontend-tool-continue`。子线程不产生 `context_usage`。`ReportProgress` 是子到父的显式上报通道，返回纯文本。子代理共享工作区，实测产物落在 `subagent-a/report.md`、`subagent-b/page-note.md`，靠模型自觉分目录。

### F.4 产品面

**引用三层**

- 第一层锚：`@@目标|原文@@` 或 `\uE000MEFLOW_CITATION_<enc>\uE001`。目标六类：`L{行}`、`P{页}`、`S{sheet}!A1:B2`/`S{sheet}!B7`、`#item/ins`、`{field}`，可拼 `$fileFieldId` 和 `#dataItemId/dataItemInsId`。渲染成内联徽标，点击 `markPresentReveal`；file-mention 另走 `canOpenWorkspaceFile/openWorkspaceFile`。
- 校验：`ValidateFileReferences` 前端执行 `/api/v1/desktop/validate-file-references`，schema v2 是 `{schemaVersion, requestId, outcome, sources[{path,contentSha256}], references[{id,filePath,lineRef,text}]}`，协议名 `mework-file-references v1`。PASSED 才允许出稿，404/405 回"请升级 agent"。上限 128 来源、8MB payload、100MB 文件、120 秒。
- 回跳：`POST /conversations/:id/source-locations/resolve`，本地文件走 `/api/v1/desktop/resolve-source-locations`，带 `lineRef + quote`。
- 查看器定位：NFKC 归一 + 中文标点映射 + 去空白 + 小写，回映射原文区间；段内命中两次报 "citation text is ambiguous in document"；找不到、长度不符各有文案；`acceptedText … calcDelRevision:false` 支持修订接受态。
- 会话哨兵：`[[cite:<id>|<文本>]]`，竖线可转义；完整式和渐进式双正则；服务端回 `metadata.custom.citationIssues`，里面有 `danglingIds` 和 `malformedMarkers`，UI 分 warning / repaired 两态。

**比对**：`CompareFiles` 参数 `source_path`、`target_path`、`output_path`（必须 `.comp.json`）、`ocr_mode`。读本地 → POST `/api/v1/desktop/compare-files`（云端算 diff 与 OCR）→ `workspace.writeFiles`（带 attribution）→ 画布双栏，词级五态，双向滚动联动（`useScrollAnchor` 处理跨页批注），失败单条跳过并记 `[mw3] rejected`。同族 `ConvertDocToDocx`。

**分析表**：每个文件 × 每列（prompt + 类型）= 一格，带 reasoning、evidence（lineRef）、点击定位；共享列改 prompt 有连带确认；每行结果独立文件；xlsx 导出带 evidenceLine。外部修改有三态确认（externallyModified / overwrite / discard）。

**插件宿主**：manifest 版本 `<major>.<minor>`，宿主 `supportedMajors` 门禁，错误提示教用户"重新 use_skill 获取 plugin-dev 后 build"；能力表带 `since`；文件访问用 glob 白名单（posix-only、禁反斜杠、禁 `..`、`**` 独占段）；工具名 `plugin__<name>__<tool>`，每个插件最多 8 个，description ≤1024B，schema ≤8KB，输出 ≤64KB，超时 1–120 秒默认 30 秒；`transfer_to` 前缀和 `-BE` 后缀是保留名；配置支持 `$a.b[*].c` 表达式。

**Skills**：zip 包必须含顶层 `SKILL.md`，frontmatter `{name, description, when_to_use?, tags?}`；校验条目数、单文件、总大小三类上限；剔除 `__MACOSX/` 和 `._*`；GBK 文件名启发式解码。`checkout_my_skill` 检出到编辑目录（就是 run_command 的 cwd），编辑后 `publish_my_skill` 打包，打包前先本地备份旧版，备份失败就放弃发布。`key` 是 use_skill 查找键，`description` 优先于文件内描述。

**Automations**：存成 Powerbase 数据项实例；`once` 的 ISO 时间必须带时区，`cron` 五段、最小间隔 15 分钟、时区白名单 9 个洲区；状态 QUEUED/RUNNING/SUCCEEDED/FAILED/NEEDS_INPUT，`automation-runs/:id:continue` 带答案续跑；产物是 conversation_id。代码里没看到本地补偿执行，机器关机任务就停（这一点是负向观察，标推断）。

**Memory**：`copilot_user_memory` / `copilot_user_instructions`，字段 `memory_{name,type,description,content,scope}`；scope 是逗号分隔的 `global` 或 `client:desktop,os:macos,project:id`，逐段白名单校验。

**分享与文件**：staging → enable → 只读页，只读页带引用锚；分享前做依赖闭包校验（"依赖的源文件 X 不存在，无法完整分享"）；工作区 PUT 带回执和 attribution `{actor, plugin}`，412 表示 created 冲突；`v` 参数当版本号。

**计费与遥测**：credits 制，membership 双进度条，`enforcement_enabled=false` 时纯统计（额度可先软后硬），`subscription_ends_at` / `period_ends_at` 控制周期。遥测本地缓冲 ≥10 条或 5 秒、上限 200、批量 50、hidden/pagehide 时 `navigator.sendBeacon`；route 里的 UUID 段替换成 `:id`；事件只有 page_viewed / button_clicked / dispatch_failed / context_* / context_usage。`app_version` 取 bundle 文件名 hash，不是真版本。

**词典里的事实**：三级模式文案；`unrestrictedWarning` 明写提示注入和数据丢失风险；steer 两态（"将在当前步骤完成后生效" / "Interrupting the current turn…"）；token 条带 auto-compress 阈值和 estimate 打折；`runCommand.truncated`；队列 `fillSuggestion` / `cancelQueued`；项目首条 prompt 模板；锚点 UI 文案（"文档锚点 L{{index}}"、"PDF 第 {{page}} 页"）；`presentFailed`（"不能在画布打开：文件不存在或尚未同步"）；法律工具加载态英文文案。全包没有 onboarding，欢迎页只有"欢迎回来"。

### F.5 拆包账本

主进程 `dist/desktop/src/main` 101 个文件约 11.6K 行，全部逐行读完。契约包 `desktop-contract` 约 660 行。渲染层 233 个 chunk，反格式化后 472,106 行，产品自有约 8.1 万行，vendor 约 30 万行。

| 文件                                                        | 行数    | 性质                                                                                                                                      |
| ----------------------------------------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `index-12cY-k_1`                                            | 114,028 | 1–33.7K 产品；33.7–36.2K date locale；36.2–81K radix/react/react-markdown；81–100.6K katex 符号表；100.6–108.8K zh-CN 词典；109–114K 杂件 |
| `registry-context`                                          | 48,660  | 0–5K 英文 i18n；5–35K 产品 hooks/注册表；35–50K composer                                                                                  |
| `index-nnsZqlU2`                                            | 30,418  | 0–20K docx/pdf/mw3 标注引擎；20–32K 键位与查看器                                                                                          |
| `cynefin`                                                   | 25,709  | mermaid 共享运行时（名字误导）                                                                                                            |
| `comparison-doc-diff`                                       | 2,531   | 前 62% tailwind-merge，产品区约 950 行                                                                                                    |
| `browser-DpqZjl4W`                                          | 1,583   | 画布插件宿主（不是浏览器面板）                                                                                                            |
| `markdown-matchers`                                         | 1,162   | 哨兵解析层（产品代码）                                                                                                                    |
| `layout-D5uf5-hr`                                           | —       | d3 族 vendor                                                                                                                              |
| `share/share-page`                                          | —       | 会话分享只读页                                                                                                                            |
| `memory-page`                                               | —       | 记忆管理界面                                                                                                                              |
| `terminal` / `read-only-conversation` / `powerbase-console` | —       | 产品页；`powerbase-console` 是结构化数据控制台                                                                                            |

vendor 对账：mermaid 全谱约 15–26 万行（含 cytoscape、dagre），我们没有任何图形库；echarts 无；katex 同库（`^0.18.7`）；mathjax 无；xlsx 他们用 SheetJS，我们用 exceljs；docx、pptx、pdfjs 同库；prosemirror 我们无；web-office-sdk 与 PowerOffice 我们无（本地 officecli + 自渲染）。真正的差距在图，不在输出三件套。

内部代号散落在代码和词典里：`meflow:copilot-citation-locate`、`mework_algorithm_diff`、`gen_file_to_mf3`（上传 MeFlow 的提示）。早期把一个 chunk 误叫 `ec-DpqZjl4W`（浏览器面板），实际是 `browser-DpqZjl4W` 画布插件宿主。

云端 API 面：`/chat-runs`（POST/SSE/events/latest/cancel/finalize-dangling）、conversations 21 个子资源、voice/transcriptions、models、usage/me、tool-review、telemetry、invite、home/config、profile 8 个、export/md-to-docx、file/{upload,download-url,poweroffice_host,collaboration/config}、desktop/* 8 个、data/items、connectors、shares、workspace/file-events。绝对 URL 只有 `o.wpsgo.com`、`feishu.cn`、`open.feishu.cn`、`terms.aliyun.com`。

### F.6 我方代码核对

这一节是写 1.5 时实际读的链路，方便你复核。

`runtime/tool-pipeline.ts:646` 的 `approvalMiddleware`：

```ts
let requires = toolRequiresExplicitApproval({
  toolName: call.toolName,
  definition: call.tool.definition,
  allowDangerousToolsWithoutApproval: call.policy.allowDangerousToolsWithoutApproval,
  strictDangerousToolApproval: call.policy.strictDangerousToolApproval,
});
```

`agent/dangerous-tool-policy.ts:60`：

```ts
const { toolName, allowDangerousToolsWithoutApproval, strictDangerousToolApproval } = args;
if (!toolRequiresLawyerPause(toolName)) {
  return false;
}
if (strictDangerousToolApproval) {
  return true;
}
return !allowDangerousToolsWithoutApproval;
```

`platform/lawyer-outbound-decision.ts:80`：

```ts
export function toolRequiresLawyerPause(name?: string | null): boolean {
  return irreversibleDisposition(name) === "pause";
}
```

`agent/tool-name-sets.ts` 顶部的 `IRREVERSIBLE_TOOLS` 只有 `inbox_signoff` 和 `deny_at_source`，没有 `pause`。同文件注释说明 `WRITE_TOOLS` 只驱动 `lawyer_approved_write` 分类（audit / runtime mode），不暂停律师。

`platform/action-pre-review.ts:127` 的 `resolveActionPreReviewMode`：只认 `shadow` / `on` / `off`，其余一律 `off`。哪怕 `on`，`ownedByThisLayer` 为真的只有 `run_host_command`（`:157-180`）和（理论上）`pause` 处置。

`agent/session.ts:814` 的 `deriveModelMessagesForSampling` 从 `session.conversationHistory` 全量投影，模型循环每轮调用它（`turn-orchestrator-model-loop.ts:504`）。

`agent/turn-orchestrator.ts:484` 在无任务 turn 把 `toolTablePermissionMode` 切成 `readonly`。

`agent/turn-orchestrator.ts:793-794`：暂停路径先 `emitEvent({ type: "final", status: "paused", reply })`，紧接着 `ensureLiveProgressFinished("failed")`，所以 UI 的 in-flight 步骤会被标 failed。相关实现散在 `live-turn-progress`（进度态）和 `tool-lawyer-card`（卡片按 `aborted` 判"已停止"）。

`agent/child-gates.ts`：子会话继承父的 permission mode，取更严的一档；工具名取交集；工具预算取快照，子不得超出。

`lint/citation-validity.ts:22` 有 `citation.malformed`，覆盖书名号空名、条号入名号、缺条号、未闭合书名号四型。

### F.7 实测时间线

- 10-19 第 9 轮：装上 MeWork，用 `MEWORK_SERVER_URL` 起中继，抓第一组真实会话，发现三个 run 串一条链，续跑只有两条消息。
- 10-19 第 10 轮：四组输入——manual 审批、读失败、steer、子代理。确认审批门只挂两个工具，确认错误走 output 不设 isError，确认 steer 打在续跑 run 上。
- 10-19 第 11 轮：45 个 run 统计 model_call，确认两段式；后台命令、browser、异步子代理；kill 第一次拿到 `lost`。
- 10-20 上午：四管道推断（出站 body、入站 SSE、会话 GET、旁路 API）；P1–P6 探针；表单句卡死事故（会话 `conv_1792425348551_7yqeps7`，卡在 `dispatching` 的排队项 `f0YsiQd` 那次 cancel 已打在结束的 run 上）；抓到 `checkpoint.protocolState` schema。
- 10-20 下午：V5 复测活任务 kill（`bg_bc34943baad1`，`killed` + `user_kill`）；V2 忽略（`ignored:true`）；V4′ 审查（auto eval 得 allow，unrestricted 免审），`ask` 仍未出现。

### F.8 名词表

他们那边的协议与标识符，读抓包时会遇到：

| 名称                                                                        | 含义                                                                            |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `RUN_STARTED` / `RUN_FINISHED` / `RUN_ERROR` / `RUN_CANCELLED`              | run 的生命周期事件                                                              |
| `TOOL_CALL_START` / `TOOL_CALL_ARGS` / `TOOL_CALL_END` / `TOOL_CALL_RESULT` | 工具调用事件；ARGS 是增量 JSON 片段                                             |
| `branch_state_saved`                                                        | 分支头版本落库（含 `conversationRevision`）                                     |
| `context_usage` / `token_usage`                                             | token 账；stage 有 run_start / model_call / run_end，source 有 estimate / usage |
| `STEP_STARTED` / `STATE_SNAPSHOT` / `STATE_DELTA`                           | AG-UI 有，但这个产品不用；实测流里没有                                          |
| `approvalMode`                                                              | `manual` / `auto` / `unrestricted`                                              |
| `MAX_CONCURRENT_THREADS`                                                    | 同会话多窗超限时的错误（上限 2）                                                |
| `executionPolicy`                                                           | `headless-user-input` / `active-thread` 等执行策略                              |
| `dangling-execute`                                                          | 客户端接管子线程或旧会话时，执行悬空工具调用的 run origin                       |
| `finalize-dangling`                                                         | 切入会话时的收沙入口                                                            |
| `verdict:ask`                                                               | 审查结果里"送人工"的分支；实测从未出现                                          |
| `delivery:dispatching`                                                      | 排队消息正在派发的状态；通知流断掉时会一直停在这                                |
| `card.skillsTitle`                                                          | connector 卡片上的技能清单                                                      |
| `application/x-mework-conversation`                                         | 会话拖进项目的 MIME                                                             |
| `presentFailed`                                                             | 画布打开失败的文案键                                                            |

我们这边的模块名，改代码时对应到这些文件：

| 模块                                                      | 作用                                                                                                                                                                            |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `agent/turn-orchestrator.ts`                              | turn 生命周期、gate、工具表分面（`:484`）                                                                                                                                       |
| `agent/turn-orchestrator-model-loop.ts`                   | 采样循环，每轮取全量历史（`:504`）                                                                                                                                              |
| `agent/turn-orchestrator-tool-round.ts`                   | 工具轮执行、配对、abort 标记（`skipToolDueToAbort`）                                                                                                                            |
| `agent/tool-result-history.ts`                            | 工具结果投影与历史配对                                                                                                                                                          |
| `agent/turn-loop-state.ts` / `turn-loop-policies.ts`      | `TurnStopReason` 与回合策略（verify cap、repeat stop、deferral）                                                                                                                |
| `agent/turn-abort.ts` / `turn-interrupt.ts`               | 中止与崩溃后的 interrupted 视图                                                                                                                                                 |
| `agent/session-context-steer.ts`                          | 同 turn 内的 steer 注入                                                                                                                                                         |
| `agent/mid-turn-compact.ts` / `compact.ts`                | 本地压缩                                                                                                                                                                        |
| `agent/session-carryover.ts` / `fork-continue-request.ts` | 另起对话带上文                                                                                                                                                                  |
| `agent/permission-mode.ts`                                | 四档权限（standard / strict / readonly / research）                                                                                                                             |
| `agent/child-gates.ts`                                    | 子会话不得松于父                                                                                                                                                                |
| `agent/context-budget.ts` / `context-tuning.ts`           | 水位与预算                                                                                                                                                                      |
| `runtime/tool-pipeline.ts`                                | 中间件顺序：pre-review → approval → audit → timeout → sandbox → execute                                                                                                         |
| `platform/action-pre-review.ts`                           | 参数感知判据（`recursive_force_delete`、`privilege_escalation`、`disk_or_boot_mutation`、`process_kill`、`network_to_shell`、`shell_inline_command`、`path_outside_workspace`） |
| `platform/lawyer-outbound-decision.ts`                    | `toolRequiresLawyerPause` 与待发信判定                                                                                                                                          |
| `lint/citation-validity.ts`                               | `citation.malformed`                                                                                                                                                            |

测试位置：`agent/turn-orchestrator-cassettes.test.ts`（准入 cassette）、`agent/turn-orchestrator-tool-round.test.ts`（abort 标记）、`agent/turn-orchestrator-dangling-tool-calls.test.ts`（悬空配对）、`agent/turn-orchestrator-parallel.test.ts`（模型槽）、`platform/action-pre-review.test.ts`（判据）、`lint/citation-validity.test.ts`（引用畸形）。

几个和我们相关的工具名：`write/edit/delete/move_workspace_file` 是他们的叫法；我们的写类集合在 `WRITE_TOOLS`，包含 `write_document`、`apply_surgical_edits`、`draft_document`、`render_document`、`run_host_command`、`draft_worker` 等。

## 附录 G 补遗（2026-10-21 第三轮）：项目容器与案件成果三件套

回答的问题：抛开改稿与 agent 循环，MeWork 在「案件管理 / 材料整理 / 图形呈现」这层到底有什么。本轮证据来自渲染层词典与组件源码（逐行读出），此前文档没有展开。

### G.1 项目 = 案件的容器（不是文件夹这么简单）

侧栏有完整的项目树：新建项目、归档/恢复、置顶对话、把对话「移动到项目」/「移出项目」。三个值得记的实现细节：

1. **共享本地工作目录**。项目绑定一个本地目录，「项目内所有对话共享该目录」；绑定按机器记忆（`${platform}:${hostname}` 作 key），换目录要等项目当前任务结束（`waitForTasks`），且「原目录文件不会自动迁移」——切目录不动文件，只换锚点。
2. **对话建议归组**。会话侧有「项目建议」流：推荐把当前对话归入已有项目（含推荐计数），或建议新建项目；创建流程带部分完成态（「项目已创建 · 待完成归入」可重试），不会重复建项目。
3. **资料页（仅桌面端）**。项目内一个文件浏览器：类型筛选（Word/PDF/表格/Markdown/文本/图片/音频/视频/其他）、当前目录搜索、刷新、路径不存在与部分读入失败都有专门文案。我们的 file workbench（树形 + 编辑面板）已覆盖同型能力，这块不用学。

### G.2 案件成果三件套：时间线、思维导图、大事记

项目创建表单有三张可选卡片（带 SVG 预览图），勾选后创建项目时会自动注入一条引导消息开始生成：

```js
// conversation-sidebar-DVBUYLAU.js（组件 sa / 数组 cs）
const cs = [
  {
    id: "timeline",
    skill: "case-timeline",
    file: "project.case-timeline.json",
    label: "extensions.timeline",
  },
  {
    id: "mindmap",
    skill: "case-mindmap",
    file: "project.case-mindmap.json",
    label: "extensions.mindmap",
  },
  {
    id: "chronology",
    skill: "case-chronology",
    file: "project.case-chronology.json",
    label: "extensions.chronology",
  },
];
```

- 空状态文案就是三者的法律语义：时间线「按时间梳理事件，串联关键节点与来源」；思维导图「展开事项脉络，呈现问题、观点与关联关系」；大事记「逐项整理重要事实，记录时间、人物与依据」。
- 引导消息是两段拼接：`generateContext`（「为项目"X"创建以下成果……逐项完成所选任务并交付全部文件」）+ 每个成果一条 prompt。prompt 原文纪律很强：「请使用 {{skill}} 技能，根据当前项目资料整理{{name}}，保存到项目工作目录根目录的 `{{file}}`，并交付该文件。**如果文件已经存在，请先读取，再按本次要求更新，不另建同类文件；资料不足时先向我确认，不编造内容**。」
- 产物是**项目根目录的结构化 JSON 文件**，不是聊天里的一段文字；主页的「时间线/思维导图/大事记」标签直接读该文件渲染（读取失败/格式损坏有专门文案），渲染走画布插件（`mermaid.core` 拆分 chunk 里的 `mindmap-definition`、`timeline-definition`、`kanban-definition`），聊天消息内的 mermaid 另有 `MermaidPreviewOverlay` 预览层（缩放/重画）。
- 生成失败的处理也值得抄：「项目已创建，生成任务未发送。提示词已保留，请在输入框中重试」——失败不清空上下文，把 prompt 还给用户重发。

### G.3 分析表（批量尽调提取）的完整规格

`canvas-extensions-DmqOV3GO.js` 里确认了此前只定性到「成品形态」的细节：列类型 = 文本 / 数字 / 日期 / 单选（单选带逗号分隔 options）；改 prompt/类型/选项会清空该列已有结果（保存前确认）；共享列改名/删除有连带确认；每行一个独立结果文件；xlsx 导出时每个分析列后跟一列 `{{列名}}_sources`，内容是 `{{lineRef}}: {{summary}}` 的证据行——**证据锚跟着表格一起导出**，这是全包最值钱的一点工程细节。

### G.4 其余确认面（一句话级）

- **记忆管理页**：类型四档（用户画像/偏好/业务背景/资源指针），scope 支持全局/桌面端/OS/项目三级组合；另有「自定义指令」（长期固定生效，可开关保留内容）。
- **首页法律案例画廊**：`exampleGallery`（「从一个法律案例开始」+ 换一批），内容由服务端下发。
- **系统通知**：任务完成/待确认推系统通知，带权限申请与 7 天勿扰。
- **勘误一条**：F.5 说「echarts 无」不成立，`echarts-Dc1L7lv8.js` 在包内；用途未见独立面板，仍按「无对应产品面」处理。

### G.5 对照 LawMind 与借鉴清单

已有对照（勿重复建设）：matter 五 service + 工作台概览 + file workbench 树 + 流程时间线（`src/lawmind/insights/session-timeline.ts`，从审计/审批/任务派生）+ prompt 级大事记脚手架（`src/lawmind/reasoning/chronology-extract.ts`，从指令文本抽日期，线性输出）。

真正缺的是**材料侧**的案情成果物，按价值排序：

| #   | 借鉴项                                                                                           | 我们现状                                | 建议落点                                                           | 估摸   |
| --- | ------------------------------------------------------------------------------------------------ | --------------------------------------- | ------------------------------------------------------------------ | ------ |
| 1   | **案件事实时间线 + 大事记**（evidence 锚随行），持久化为 matter 工作区结构化产物，agent 增量更新 | 只有流程时间线；chronology 仅 prompt 层 | matter 交付物新 type（structured fact-timeline），复用 citation 锚 | 2–3 周 |
| 2   | **限域思维导图**：当事人关系图 + 争议焦点脉络图两类                                              | 无任何图形库                            | 轻量 SVG 组件从结构化 JSON 渲染，不引 mermaid 全谱（对齐 §4.2 八） | 2 周   |
| 3   | **「先读再更新、不另建、资料不足先确认」的再生纪律**                                             | 交付物再生无统一措辞                    | 写进交付物重生成 prompt 模板与验收 helper，一字成本                | 半天   |
| 4   | 分析表 type + xlsx 带证据列                                                                      | backlog §4.2 六已列                     | 按原计划，补上「sources 列随导出」细节                             | 原估   |
| 5   | 对话→案件归组建议（轻量）                                                                        | 对话与 matter 的绑定未产品化            | matter 列表页给「把当前对话归入案件」入口即可，勿做项目建议全流    | 3–5 天 |

G.1 的共享目录与 G.2 的产物落位（案件根目录）我们天然可做——A1 本地工作区 + matter-replica 对象模型下，「案件根目录的结构化 JSON」比 MeWork 的云端 Powerbase 数据项更贴我们叙事（可进审计链、可离线）。
