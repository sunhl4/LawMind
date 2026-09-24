# 第 37 章 记忆与学习模块详解

第 6 章讲了记忆与学习的机制。这一章逐个文件说清 `src/lawmind/memory/` 与 `src/lawmind/learning/` 里每个模块干什么。给要改这块代码的人看。

## 37.1 `memory/` 逐个文件

### 核心加载与路径

| 文件                | 职责                                                         | 关键导出                                                                                                                                                                                                                                                                                                          |
| ------------------- | ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `index.ts`          | 记忆加载入口与路径助手                                       | `loadMemoryContext`、`caseFilePath`、`ensureCaseWorkspace`、`matterStrategyPath`、`clausePlaybookPath`、`courtAndOpponentProfilePath`、`clientProfileFilePath`、`extractClientIdFromCaseMarkdown`、`upsertMatterDisplayName`、`ensureFirmProfile`、`ensureClientProfile`、`appendTodayLog`、`appendLawyerProfile` |
| `case-workspace.ts` | 案件工作区路径与初始化（**不 import `index.ts`，避免循环**） | `caseFilePath`、`matterStrategyPath`、`ensureCaseWorkspace`                                                                                                                                                                                                                                                       |
| `case-md-lock.ts`   | CASE.md 的读-改-写串行化                                     | `withCaseMdLock`                                                                                                                                                                                                                                                                                                  |
| `case-writes.ts`    | CASE.md / MATTER_STRATEGY.md 的各节写入                      | `writeMarkdownBulletToSection`、`appendCaseSectionBullet`、5 个段落写入器、`appendMatterStrategyDecision`                                                                                                                                                                                                         |

**`case-md-lock.ts` 为什么必要**（注释原文）：

> Serialize CASE.md read-modify-write per matter. Concurrent appends/projections otherwise lose updates (empty §9, torn templates).

「torn templates」说的是两个写入者同时改，把模板撕成两半。锁的键是 `工作区\0案件id`。

### 采纳（这一块是重点）

| 文件                           | 职责                                           |
| ------------------------------ | ---------------------------------------------- |
| `adoption-service.ts`          | 五态状态机 + 去重 + 两层锁 + 审计              |
| `unified-pending-adoptions.ts` | 把采纳队列与学习队列合并成一个待办列表         |
| `adoption-apply.ts`            | **Inspector 的写入器**：每个 kind 落到哪个文件 |
| `adoption-preview-diff.ts`     | 采纳前的差异预览                               |
| `memory-target-path.ts`        | 从 scope 推目标文件路径                        |
| `write-gateway.ts`             | Markdown 记忆改动的统一入口                    |

**`adoption-apply.ts` 是理解「一条建议最终写到哪」的关键**。它的映射表：

| kind                                                                      | 目标文件                                                                              |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `lawyer.profile_learning`                                                 | `LAWYER_PROFILE.md`                                                                   |
| `lawyer.habit_pattern`                                                    | `LAWYER_PROFILE.md` + `lawmind/lawyer-preferences.json` + `lawmind/stance/items.json` |
| `assistant.profile_section`                                               | `assistants/<id>/PROFILE.md`                                                          |
| `case.progress`                                                           | `cases/<id>/session-summary.md` + 标题行进 CASE.md                                    |
| `case.core_issue` / `case.risk_note` / `case.task_goal` / `case.artifact` | `cases/<id>/CASE.md`                                                                  |
| `playbook.clause_learning`                                                | `playbooks/CLAUSE_PLAYBOOK.md`                                                        |
| `firm.preference`                                                         | `FIRM_PROFILE.md`                                                                     |
| `client.profile_note`                                                     | `clients/<id>/CLIENT_PROFILE.md`                                                      |
| `opponent.note`                                                           | `playbooks/COURT_AND_OPPONENT_PROFILE.md`                                             |
| `project.note` + `historical.knowledge`                                   | `memory/topics/historical-scan.md`                                                    |
| `review_label`                                                            | 走 `applyReviewLabelFromAdoption`                                                     |
| `source.annotation`                                                       | 已在创建时落盘（记 noop）                                                             |

`noopReason` 的几种：`empty_payload`、「project 暂无落盘存储面」、`kind X 无对应落盘 writer`。

**注意 `lawyer.habit_pattern` 会写三个地方**——这是唯一一个多落点的 kind。

### 档案与提示词窗口

| 文件                           | 职责                                                        |
| ------------------------------ | ----------------------------------------------------------- |
| `lawyer-profile-for-prompt.ts` | 过滤档案（**空模板不注入**）                                |
| `lawyer-profile-learning.ts`   | 追加学习条目 + §八 轮转                                     |
| `applied-preferences.ts`       | 从 §八 抽「已生效偏好」                                     |
| `executable-preferences.ts`    | 可执行偏好的 JSON 存储（`lawmind/lawyer-preferences.json`） |
| `prompt-windows.ts`            | 各层的字符上限（`PROMPT_WINDOW`）                           |
| `memory-sources.ts`            | 生成「记忆来源分层」报告                                    |
| `memory-md-migrate.ts`         | 迁移过期的库存 MEMORY.md 口径                               |

**`prompt-windows.ts` 那一串数字**（它们决定「模型能看到多少记忆」）：

| 窗口                     | 值    |
| ------------------------ | ----- |
| `matterContextChars`     | 8000  |
| `caseFileReadChars`      | 4000  |
| `lawyerProfileChars`     | 6000  |
| `lawyerFingerprintChars` | 800   |
| `clientProfileChars`     | 4000  |
| `dayLogChars`            | 3000  |
| `assistantProfileChars`  | 3000  |
| `retrievalMemoryChars`   | 2500  |
| `similarCaseReadChars`   | 64000 |
| `caseProgressMaxBullets` | 80    |

`lawyerFingerprintChars = 800` 就是第 6 章说的「§八 只注入 800 字指纹」。

### 召回与摘要

| 文件                     | 职责                                                                                          |
| ------------------------ | --------------------------------------------------------------------------------------------- |
| `similar-case-recall.ts` | 跨案 CASE.md 相似度召回（各节权重：争点 2.6 / 风险 2.2 / 策略 1.6 / 基本信息 1.2 / 进度 0.9） |
| `relevant-recall.ts`     | 每回合相关记忆清单（上限 4 条）                                                               |
| `session-summary.ts`     | 会话摘要提取与追加（`cases/<id>/session-summary.md`）                                         |
| `team-memory-sync.ts`    | 团队记忆同步（默认关 + 密钥扫描）                                                             |

`similar-case-recall` 的读取上限是 64000 字（读前 75% + 后 25%）——这个「读头尾」的策略是因为 Markdown 文档的重点常在开头和结尾。

`session-summary` 的触发条件：消息数 ≥4、字符数 ≥3500、距上次摘要至少 1 个回合。

### 团队记忆同步的密钥扫描

`team-memory-sync.ts` 里的 `SECRET_PATTERNS` 值得单列（它决定「什么样的内容不许同步出去」）：

```text
sk-…（OpenAI 风格）
AKIA…（AWS）
-----BEGIN (RSA |EC )?PRIVATE KEY-----
Bearer …
api_key[:=]…
```

**默认是关的**，而且要求 firm 版 + 配了端点。

## 37.2 `learning/` 逐个文件

| 文件                                      | 职责                                   | 存储                                         |
| ----------------------------------------- | -------------------------------------- | -------------------------------------------- |
| `edit-examples.ts`                        | 改稿范例（原文→改后）作为可检索素材    | `edits/edit-examples.jsonl`                  |
| `suggestion-queue.ts`                     | 传统学习队列（现镜像到采纳服务）       | `learning/suggestions.json`                  |
| `draft-edit-learning.ts`                  | 从改稿 delta 提候选（两条通道）        | 偏好走采纳 + 样例走 `edits/`                 |
| `rejection-ratchet.ts`                    | 驳回分门别类                           | 工作记录事件                                 |
| `rewrite-amplitude.ts`                    | 改稿幅度指标                           | `quality/rewrite-amplitude.json`             |
| `apply-review-labels.ts`                  | 审核标签写多处 + 提升黄金样本          | `golden/<taskId>.golden.json`                |
| `contract-review-draft.ts`                | 合同审查草稿（待确认）                 | `learning/contract-reviews/drafts/<id>.json` |
| `contract-revision-pack.ts`               | 合同修订积累包                         | `learning/contract-revisions/<id>/`          |
| `contract-revision-on-review-approved.ts` | 审核通过后定稿积累包                   | 回写草稿字段                                 |
| `review-learning-suggest.ts`              | 「需修改」→ 待采纳建议                 | 采纳队列                                     |
| `agent-specialization.ts`                 | 各助手/角色的通过率                    | `quality/agent-specialization.json`          |
| `assistant-growth.ts`                     | 助手成长报告（无自己的存储，聚合读取） | —                                            |
| `desk-settings.ts`                        | 工作台设置                             | `lawmind/desk-settings.json`                 |
| `suggestion-record.ts`                    | 只读类型（渲染层安全）                 | —                                            |

### `edit-examples.ts` 的两个上限

第 6 章讲过「存得宽、注入得省」：

| 常量                          | 值  | 作用         |
| ----------------------------- | --- | ------------ |
| `MIN_EXAMPLE_DELTA_CHARS`     | 12  | 改动太小不算 |
| `MAX_EXAMPLE_CHARS`           | 600 | 存储上限     |
| `MAX_EXAMPLE_CHARS_IN_PROMPT` | 220 | 注入上限     |
| `DEFAULT_EXAMPLE_LIMIT`       | 2   | 默认取几条   |

而且**律师说明写在标题行**（每例最靠前）——这是被截断挤出过一次之后的教训。

注入时的块标题是「## 改稿参照（本所律师对系统稿的实际修改）」，性质是**素材而不是指令**。

### `draft-edit-learning.ts` 的两条通道

一次改稿捕捉会同时产出：

| 通道     | 目标                                | 用途           |
| -------- | ----------------------------------- | -------------- |
| 偏好通道 | `lawyer.profile_learning`（待确认） | 影响之后的风格 |
| 样例通道 | `edits/edit-examples.jsonl`         | 作为参照素材   |

上限：`MAX_CANDIDATES = 3`、`MIN_DELTA_CHARS = 6`、`MAX_CANDIDATE_CHARS = 160`。

### `rejection-ratchet.ts` 的分类优先级

```
空标签 → 不写任何东西
verify（引用有误/不完整）→ 优先
template（模板不匹配）
skill（语气过强/过弱、受众定位）
playbook（兜底）
```

**「空标签不写任何东西」**是关键：光点驳回不带信息，没法学。

### `contract-revision-pack.ts` 的目录结构

```text
learning/contract-revisions/<revisionId>/
  manifest.json
  initial/<文件名>        初稿
  final/<文件名>          终稿
  KEY_MODIFICATIONS.md    关键修改点
learning/contract-revisions/_index/by-key/<slug>.json   按关键点索引
```

id 格式 `cr_<YYYYMMDD>_<6位hex>`。它的用途是把「这份合同我们改了哪些地方」存成可复用的数据资产。

关键修改点还会喂给立场库（`upsertStanceFromKeyModification`）。

### `apply-review-labels.ts` 写几处

| 标签类型     | 写到哪                                          |
| ------------ | ----------------------------------------------- |
| 一般标签     | 律师档案                                        |
| 语气/受众类  | 助手档案                                        |
| 条款类       | `playbooks/CLAUSE_PLAYBOOK.md`                  |
| 「质量范例」 | 提升为黄金样本（`golden/<taskId>.golden.json`） |

而且审计会记 `memory.profile_updated` / `memory.playbook_updated` / `golden.example_promoted`。

## 37.3 一次完整的「学到东西」的流程

把上面这些串起来，看一次真实的学习闭环（以「审稿时打了『语气过强』标签」为例）：

```text
① 律师在审核时打标签「语气过强」
② applyReviewLabelsMemoryWrites 被调用
③ 标签分类：属于 skill 类（语气过强）
④ 写入三处：律师档案 + 助手档案 + playbook（按标签类型）
⑤ 同时入采纳队列（kind: review_label，scope: lawyer）
⑥ 镜像到学习队列（learning/suggestions.json）
⑦ 审计记 memory.profile_updated 等
⑧ 下次起草时：LAWYER_PROFILE 的指纹 + playbook 的相关条目进提示词
⑨ 效果体现在下一次的草稿语气上
```

**第 ⑧ 步是「闭环」的关键**：光写进文件不算闭环，得在下一轮真的被读到。这也正是为什么第 6 章要强调「加载了 ≠ 进提示词」。

## 37.4 三个「写入路径」的区别

改这块代码的人最容易混的是三个入口：

| 入口                                      | 谁用                   | 是否经采纳服务              | 是否要确认                         |
| ----------------------------------------- | ---------------------- | --------------------------- | ---------------------------------- |
| `writeCaseMemorySection`（write-gateway） | `add_case_note` 等工具 | 会（`trackAdoption: true`） | 否（自动采纳，因为写的是案件事实） |
| `suggestMemoryAdoption`                   | 各处提建议             | 是                          | 是（pending）                      |
| `adoptMemorySuggestion`                   | Inspector 确认时       | 是（改状态）                | 已确认                             |

也就是说：**案件事实类的写入可以自动采纳**（`case.*` 那些），**风格/偏好类的要确认**。这个区分在 `case-writes.ts` 里体现为「每个 case.* 写入都带 `suggestMemoryAdoption(scope:"matter", autoAdopt:true)`」。

**为什么案件事实可以自动**：因为它是「记录发生过的事」，不是「总结你的偏好」。记录事实错了容易被发现（打开卷宗就看到了），偏好错了很难发现。

## 37.5 已知坑（本章相关）

- **`case-workspace.ts` 不 import `index.ts`**（避免循环依赖）。加东西时注意别破坏这一点。
- **`lawyer.habit_pattern` 会写三个地方。** 改它要同时考虑档案、偏好文件、立场库。
- **CASE.md 的叙事小节不回写 JSON。**
- **进度条目会轮转**（超过 80 条时挪到 `progress-archive.md`）。
- **§八 轮转不影响模型行为**（模型只看 800 字指纹）。
- **`prompt-windows` 的每个数字都影响模型能看到多少记忆。** 改之前想清楚代价。
- **`session-summary` 有触发门槛**（≥4 条消息、≥3500 字），不是每轮都写。
- **团队记忆同步默认关。** 开了会扫密钥，但那只防明显的泄露模式。
- **改稿谱例的字段顺序是设计。** 说明必须在标题行。
- **空标签的驳回不写任何东西。** 别为了「有记录」而写一条无信息的。
- **案件事实自动采纳、偏好要确认。** 这个区分不要混。
