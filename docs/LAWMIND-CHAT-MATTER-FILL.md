# 对话补档案（第十八期计划）

> 律师拍板（2026-09-18）：**A=直接写入**；**B=工作台手工入口先留着**；**C=不开办件菜单，开口或丢材料本轮带上工具，「更多工具」必须覆盖工作台真实能力**。  
> 进度勾选在 [`GOALS.md`](../GOALS.md) 第十八期。本文是施工合同：按这里做完，对话里的助手才能像 Cursor / Codex / DeepSeek harness 那样把事办完，而不是只会聊天。

## 0. 做完长什么样

律师关联一个案件，丢传票 / 谈话 / 文件夹（或给路径），说补上或「按这个整理」。助手自己读、认字、写入**工作台正在看的那份档案**。律师打开工作台，开庭、谈话、案号已经在。写错了去工作台改，或下一条对话改回来。

工作台期限页、谈话页仍可自己贴字、丢文件。不必先说话。两处写入同一份 `deadlines.jsonl` / `intake-brief.json` / 卷宗。

律师界面不出现新的办件列表、填表向导、确认流。待我拍板仍然只拦外发（`send_email`），不拦补档案。

## 1. 对照：够不够智能

编码 agent 的交付物是仓库里的文件。LawMind 的交付物是案件档案 + 文稿。对标的是 **harness**（工具在不在本轮、能不能写穿、中途能不能补材料），不是把 LawMind 做成第二个 IDE。

| 别人已经做到的                                                                                              | LawMind 今天                                                                                                                                      | 本期必须齐                                                                                                        |
| ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| **Cursor**：打开的就是工作区；说「按这个目录补」会 `Glob`/`Read`/`Apply`；截图能进对话；写完你在文件里看见  | 对话能读文件，但写不进工作台期限/谈话/卷宗；对话框不能粘贴截图                                                                                    | 本轮工具表出现读+写档案；写完工作台立刻同一条；粘贴图片即钉选                                                     |
| **Codex**：隐式匹配能力 + 目录渐进披露 + `$skill`；改编排用 cassette 断言**下一轮请求体**里工具在不在       | `compileIntent` 已能把传票绑到 `ops.court_sms`、谈话绑到 `litigation.talk`；但额外工具只放开计算器/类案检索；`list_more_tools` 没有期限/谈话/卷宗 | 绑定或丢材料的**第一轮**就广告写入工具；目录里能 `list_more_tools` 启用它们；cassette 断言广告且 `execute` 真落盘 |
| **DeepSeek harness**（本仓库已落地的那套）：工具卡中文、Stop 打到工具、轮中 inject 材料、纠正本轮、不假完成 | 轮中 inject 已有；补档案没有对应工具卡；Skill 还教模型「去工作台确认」等于假完成                                                                  | 写入用中文卡「已写入开庭…」；Stop 发生在写入前则档案不变；轮中再丢一张传票照片，下一模型轮能读到并继续写          |

「完美」在这里的意思：

1. 律师用原话能办完，不必记住入口或激活词。
2. 模型本轮拿得到扳手，不是提示词点名一个不在工具表里的名字。
3. 写进工作台正在读的存储，不是聊天摘要冒充已入卷。
4. 材料看不清就明说，不编开庭日。
5. 外发仍停；补档案不停。

做不到的诚实边界：糊到 OCR/视觉都空的照片，任何 harness 也写不出真实日期。本期验收是「空结果 + 请换一张或手填」，不是猜一个日子。

## 2. 现在断在哪（只保留还挡验收的）

1. **两套笔**：工作台 `POST /api/desk/events/confirm`、`intake-brief`、`/api/matters/profile`；对话只有 `add_case_note` / 未广告的 `record_deadline`。Skill 还写「请到工作台确认」。
2. **工具表不对活**：`CAPABILITY_EXTRA_TOOLS` 里 `ops.court_sms` 只有 `calculate`，`litigation.talk` 只有 `search_case_law`，`matter.intake` 根本没有包。`DISCLOSED_TOOL_HINTS` 没有 `get_matter_summary` / `read_case_file` / `add_case_note` / `record_deadline` / 谈话与卷宗。
3. **材料口不全**：对话可拖文件，不能粘贴截图；工作台期限/谈话只吃纯文字；视觉 OCR 默认关（`LAWMIND_DOC_READ_MODE=ocr_only`）。
4. **提示词撒谎**：系统提示叫模型用 `get_matter_summary`、`add_case_note`，这两样既不在核心 12，也不在更多工具目录。

待拍板口径已经是对的（`toolRequiresLawyerPause` 只拦 `send_email`）。本期不要把补档案工具加进外发名单。

## 3. 原则（施工时不得违反）

1. **一个抽取、一个写入、两个入口。** 工作台 HTTP 与 agent 工具都调用 `src/lawmind/desk/*` 和 `matter-write-service` / `deadline-service`。禁止对话另写一份 markdown 冒充期限。
2. **核心 12 不膨胀。** 新能力走本轮披露 + `list_more_tools` 目录。和 Codex 一样：常用短表，活来了再给齐。
3. **律师零新菜单。** 不恢复办件点选、不弹「是否写入期限」。对话里律师的交办就是授权写入；工作台手工路径仍是「抽出 → 确认写入」（B）。
4. **档案类办件写穿，出稿类不写档案。** `ops.court_sms` / `litigation.talk` / `matter.intake` / `chronology.timeline` / `ops.invoice` 读完就写。`contract.review` 等继续出稿，不改开庭日。
5. **没有的字段不写。** 无日期不调用写入期限；OCR 空不写卷宗；案由只从律师词表候选里写，不编《民事案由规定》全文。
6. **写完说人话。** 「已写入开庭 2026-10-12，工作台能改。」禁止「请前往工作台贴传票」当作成功。
7. **先复用。** 抽取继续用 `extractLegalEvents`、`compileIntakeBrief`、`updateMatterProfile`、`import_host_file`、`analyze_document`。缺的是工具包装和披露，不是新引擎。

## 4. 工具（模型名，律师卡用中文）

全部注册进 `createLegalToolRegistry`。execute 只薄包现有 desk/application 函数。

| 工具名                  | 律师卡       | 做什么                                                     | 谁已经有等价 HTTP               |
| ----------------------- | ------------ | ---------------------------------------------------------- | ------------------------------- |
| `extract_legal_events`  | 抽出期限     | 文本 → 候选开庭/举证（只读）                               | `POST /api/desk/events/extract` |
| `apply_legal_events`    | 写入期限     | 候选写入 `deadlines.jsonl`；开庭可顺带写入卷宗 `hearingAt` | `POST /api/desk/events/confirm` |
| `compile_intake_brief`  | 整理谈话     | 谈话/材料 → 摘要 JSON（先落未确认稿）                      | `POST .../intake-brief`         |
| `apply_intake_brief`    | 写入谈话档案 | 打上 `confirmedAt`，与工作台「写入本案档案」相同           | `POST .../intake-brief/confirm` |
| `update_matter_profile` | 更新卷宗     | 案号/法院/审级/地位/当事人/门类/案由；只填传入的键         | `POST /api/matters/profile`     |
| `revert_desk_write`     | 撤销刚才写入 | 按返回的 `writeId` 删期限或回卷宗快照；谈话恢复确认前      | 工作台现在手改；本期补工具      |

已有、必须进目录并在档案包里自动披露（不要新造）：

- 读：`analyze_document`（已在核心 12）、`get_matter_summary`、`read_case_file`、`list_matters`、`search_matter`、`list_dir`、`explore_folder`、`search_host`、`read_host_file`
- 收材料：`import_host_file`
- 已有写入：`record_deadline`（律师口播「下周五交证据」这种无材料期限）、`add_case_note`（争点/风险；不替代谈话档案）

`apply_*` / `update_matter_profile` / `revert_desk_write`：`requiresApproval` 保持 false，**不要**加入 `OUTBOUND_TOOL_NAMES`。写入仍进 audit / 工具卡。

无 `matterId`：读工具沿用现有「请先新建案件」；写入工具同样失败并指向空对话「新建案件」。不在本期让模型静默 `create_matter`（避免造假卷）。文件夹建新案放到第 3 波。

## 5. 本轮披露（C，对齐 Codex）

`CORE_MODEL_TOOL_NAMES` 仍 12 个。改 `src/lawmind/agent/tools/disclosed-turn-tools.ts` 与 `governance.ts` 的 `DISCLOSED_TOOL_HINTS`。

### 5.1 「更多工具」目录必须能启用

`DISCLOSED_TOOL_HINTS` 补上第 4 节全部新工具，以及漏掉的 `get_matter_summary`、`read_case_file`、`list_matters`、`add_case_note`、`record_deadline`、`search_matter`（若尚未在目录——`search_matter` 已在）。`list_more_tools` 单测断言这些名字返回得到，启用后下一轮可 execute。

### 5.2 开口或丢材料：第一轮就出现（不要等模型先 list_more_tools）

在 `extraToolsForInstruction` / `mergeTurnDisclosedToolNames` 增加档案包。绑定或材料形态命中则并入本轮广告列表。

**包 `desk.read`**（会话已关联案件就给）：  
`get_matter_summary`、`read_case_file`、`search_matter`、`list_matters`

**包 `desk.events`**（`ops.court_sms`，或文件名/peek 含传票、12368、开庭、举证通知，或指令含贴传票/补期限/按传票）：  
`analyze_document`（已在核心）、`extract_legal_events`、`apply_legal_events`、`update_matter_profile`、`record_deadline`、`import_host_file`、`search_host`、`read_host_file`、`list_dir`、`explore_folder`

**包 `desk.talk`**（`litigation.talk`，或谈话记录/会议纪要/微信记录）：  
`analyze_document`、`compile_intake_brief`、`apply_intake_brief`、`update_matter_profile`

**包 `desk.intake`**（`matter.intake`，或钉选目录，或指令含按这个文件夹/补卷宗/整理材料）：  
`explore_folder`、`list_dir`、`search_host`、`read_host_file`、`import_host_file`、`analyze_document`、`update_matter_profile`、`extract_legal_events`、`apply_legal_events`、`compile_intake_brief`、`apply_intake_brief`、`add_case_note`

钉选目录或 `projectDir` 已披露 host 读工具，保留。档案包是在这之上把**写笔**也带上。

删除或改掉现在这种残包：

```ts
"litigation.talk": ["search_case_law"],
"ops.court_sms": ["calculate"],
```

类案检索、期限计算仍可留在包里，但不能是包里唯一的东西。

### 5.3 提示词与 Skill

- `system-prompt.ts`：档案类交办改为「读材料 → 抽取工具 → 写入工具 → 用中文回报写了什么」。删掉「请律师去工作台确认后落入期限」。
- `legal-event-extract.md` / `client-talk-intake.md` / `court-sms-intake.md` / `matter-from-materials.md`：对话路径改为调用上述工具写穿；工作台手工路径仍是抽出预览再点确认。
- 律师可见空对话：最多加半句「传票、谈话、照片直接丢进来」。不加功能列表。

## 6. 写入规则（A=3）

律师这条交办就是授权，等价于工作台点了「确认写入」。

回合内顺序（模型循环，不是新流水线锁）：

1. 有文件/图：`analyze_document`（或 host 读）。
2. 有目录/路径：`explore_folder` → 挑文件再读 → 需要归档则 `import_host_file`。
3. 传票/短信：`extract_legal_events`；有 `dueAt` 的才 `apply_legal_events`。
4. 谈话：`compile_intake_brief` 后立刻 `apply_intake_brief`（对话路径不把未确认稿晾在那里）。
5. 卷宗里材料写死的案号/法院/开庭日：`update_matter_profile` 只填读到的键。
6. 回报：列出写入项。缺的标【待补充】，不要用写入工具填假值。

工作台（B）：textarea 仍「抽出期限 / 确认写入」「整理谈话 / 写入本案档案」。这是给不说话的人用的同一套函数，不是第二套抽取。

撤销：工具返回 `writeId`。律师说「刚才开庭日写错了，删掉」→ `revert_desk_write` 或再 `update_matter_profile`。第 1 波若来不及做 `revert_desk_write`，工作台手改必须已经能改同一条（期限 PATCH 已有）。第 2 波补工具撤销。

与「记忆不确认不写入」的关系：那条管偏好/习惯入记忆。律师交办补档案不是记忆候选，是本案操作。不要把期限推进「待确认」队列，否则 A=3 作废。

## 7. 材料怎么进来（Cursor 级）

第 1 波引擎写穿时，对话拖文件已经能测。照片场景要第 1 波后半或第 2 波 UI 一起做完，否则「完美」不成立。

1. **对话框粘贴截图 / 照片**：compose `onPaste`。剪贴板是图则写入本案 `cases/<matterId>/materials/`（无案件则工作区 `uploads/`），钉选后本轮可 `analyze_document`。轮中粘贴走已有 `POST /api/sessions/:id/inject`（DeepSeek inject）。
2. **工作台期限页、谈话页**：除 textarea 外接收拖放 PDF/图片；先 OCR 成文本再走现有抽出。手工路径仍要确认按钮。
3. **路径**：指令里的绝对/相对路径，模型用 `list_dir` / `search_host` / `read_host_file`。工作区外只回 `hit_id`，律师允许后再读——已有本机能力，档案包必须把这些工具广告出来。
4. **OCR**：`analyze_document` 已有 Tesseract。默认在 OCR 为空且已配合同一模型视觉端点时走视觉兜底（今天要 `LAWMIND_DOC_READ_MODE=ocr_then_vision`）。律师不应设环境变量。仍空则工具返回明确错误，模型不得 `apply_*`。
5. **关联案件**：继续用「用于对话」和 compose 案件芯片。本期不要求对话里用自然语言模糊搜案自动绑定（可第 3 波用 `list_matters`）。

## 8. 分波施工

后一波不改前一波的存储形状。每一波有独立 cassette / 单测，失败就停，不铺下一项。

### 第 1 波 — 写穿（没有这一波，后面都是表演）

引擎 + 披露 + Skill/提示词 + 工作台 HTTP 改走同一 helper（若现在路由里内联抽取，抽到 `src/lawmind/desk/` 再两边调）。

触点：

- `src/lawmind/agent/tools/legal/` 新 `desk-tools.ts`（或拆 events/intake/profile）
- `legal-tools.ts` 注册
- `tool-name-sets.ts`、`governance.ts` hints、`requires-action.ts` 中文名、`tool-lawyer-card.ts`
- `disclosed-turn-tools.ts` 档案包
- `list-more-tools.test.ts`、`disclosed-turn-tools.test.ts`
- `system-prompt.ts`、四份 Skill
- `turn-orchestrator-cassettes.test.ts` 新增（见第 9 节）
- desk 路由改为调用与工具相同的 apply helper，避免确认写入与工具写入分叉

验收：关联案件 + 传票文本/文件，「按传票把开庭补上」→ `deadlines.jsonl` 有开庭；工作台期限列表读到同一 `deadlineId`。谈话同理 `intake-brief.json` 带 `confirmedAt`。

### 第 2 波 — 材料口（照片和路径）

- 对话 paste 图片钉选 + 单测
- 工作台期限/谈话 drop 文件（B 仍确认）
- OCR 空则视觉兜底，去掉律师配 env 的默认
- 目录钉选 / 路径指令：cassette 断言第一轮广告 `explore_folder` + `import_host_file` + `update_matter_profile`
- `revert_desk_write` + 回报文案

验收：粘贴一张传票截图（夹具图）+「补到本案」→ 期限出现。给已授权文件夹路径 +「按里面的材料补卷宗」→ 文件进 `cases/<id>/materials/`，读到的案号进卷宗。

### 第 3 波 — 铺开同一模式（不新发明哲学）

仍是同一套读+写+披露，只换触发：

- 身份证/执照照片 → 卷宗当事人（认不清不写）
- 发票/流水 → 已有 `ops.invoice` 补上 `import_host_file` + 必要时 `analyze_spreadsheet`（已有表格披露）
- 无案件 + 一包材料 → 才允许 `create_matter`（要单独 cassette：禁止在已关联案件时另造一卷）
- 邮件正文里的开庭通知 → `desk.events` 包在 `ops.court_sms` 已覆盖；确认邮件短路径不会冻住 `apply_legal_events`（playbook deny 只冻误发/重建原件）

工作台手工框不删。若律师后来觉得对话已经够用，再另议收敛 UI。

## 9. 准入测试（对齐 Codex cassette）

假模型、真 `runTurn`、真工具名。断言下一轮请求体广告了什么、execute 写了什么。用尽脚本必须失败（HTTP 400），不许默默补一条助手收尾。

至少这些（名字可改，意图不能改）：

1. **summons-fill-advertises-desk-write**：指令「按这份传票把开庭补上」+ 传票 pin → `request(0)` 有 `extract_legal_events` 与 `apply_legal_events`；没有也能 `list_more_tools` 目录查到它们。
2. **summons-fill-writes-deadline**：脚本 `analyze_document` → `extract_legal_events` → `apply_legal_events` → 磁盘 `deadlines.jsonl` 含开庭；`listDeadlinesForMatter` 与工作台 API 同源。
3. **talk-fill-confirms-brief**：谈话指令写入 `confirmedAt`。
4. **folder-fill-advertises-host**：目录 pin +「按这个文件夹补卷宗」→ 广告 `explore_folder`、`import_host_file`、`update_matter_profile`。
5. **list-more-covers-desk**：不绑定档案类时，核心表仍无 `apply_legal_events`；`list_more_tools` 无参目录含该名；传入 name 后本会话可 execute。
6. **review-does-not-write-docket**：合同审查回合不自动广告 `apply_legal_events`（除非律师同时说补期限）。
7. **empty-ocr-does-not-apply**：`analyze_document` 返回空文本时，即使模型调用 `apply_legal_events` 也 `ok: false`，jsonl 不增行。
8. **steer-second-photo**：第一轮进行中 inject 第二张图，下一模型请求含新 pin（已有 steer/inject 基础设施，补一条档案场景）。

金标集：已有 `summons-file` → `ops.court_sms`、`talk-file` → `litigation.talk`。补：文件夹 +「补卷宗」→ `matter.intake`；传票图扩展名 `.jpg` 同样 `ops.court_sms`。

桌面：compose 粘贴图片钉选的组件测试；工作台 drop 抽出仍走确认的测试。不为此新开 Playwright 大规格，除非粘贴必须过 preload。

## 10. 律师可见过程（DeepSeek 三刀不回退）

- 工具卡用第 4 节中文名，详情带「开庭 10 月 12 日」这种结果，不露 `deadlines.jsonl`。
- Stop：已 `apply_*` 的不自动回滚（避免半删除）；未调用的不再写。撤销靠工作台或 `revert_desk_write`。
- 轮中补材料：inject pins 后披露包按**更新后的 pins**重算（今天 `mergeTurnDisclosedToolNames` 已读 pins；确认 tool-round 中途 inject 目录时会带上写工具）。
- 不得把「候选已列在聊天里」标成任务完成。完成 = 写入函数返回 ok，或诚实说没写上因为没读到日期。

## 11. 明确不做

- 办件菜单、冷启动三问、写入前确认弹窗（对话路径）。
- 飞书/Outlook 日历直写（ICS 导出保留）。
- 把核心工具扩到 30 个、每轮塞全表。
- 为每个工作台按钮做平行自然语言 DSL。
- 未授权全盘读写。
- 用对话笔记代替 `deadlines.jsonl`。
- 在补档案工具上套 `send_email` 那套待拍板。

## 12. 建议实施顺序（给人看的）

先做第 1 波到 cassette 全绿，再用真传票 PDF 在桌面拖一次核对工作台。然后第 2 波粘贴截图。第 3 波才铺证件和建新案。

第 1 波没绿就不要改 UI 文案吹牛。
