# 第 1 章 总览：产品、术语与架构

本章是全书的地基。读完它，你应该能回答三个问题：LawMind 是什么、代码分成哪几层、同一个功能该去哪一层找。

## 1.1 一句话定位

LawMind 是一个**本地优先的律师工作台**：律师提出交办并提供材料后，系统选择并组合最合适的能力，持续执行到可用的交付物，而不是停在「对话轮次」。

它由三部分构成，缺一不可：

- **桌面壳**：`apps/lawmind-desktop/electron/`，Electron 主进程，负责窗口、菜单、IPC、原生对话框、本地 API 子进程监督、自动更新。
- **本地 HTTP API**：`apps/lawmind-desktop/server/`，渲染进程唯一的状态写侧；只监听回环地址。
- **法律引擎**：`src/lawmind/`，Agent 循环、工具与治理、草稿与改稿、检索、记忆、门禁、审计、安全层。

产品 UI 只有**桌面应用**一种形态（安装包里的 `LawMind.app`，或开发态的 `pnpm lawmind:desktop`）。开发服务器 `http://127.0.0.1:5174` 只是 Electron 的渲染进程来源，不是可用的网页版工作台。

## 1.2 律师产品四条铁律

所有产品与工程取舍必须同时满足下表四条（来源：`GOALS.md` §二，`VISION.md` 的英文摘要与之对应）。

| #   | 铁律             | 律师侧含义                                      | 否决标准（一例）                                          |
| --- | ---------------- | ----------------------------------------------- | --------------------------------------------------------- |
| 1   | 上手简单         | 少配置、少迷路；默认路径就能交办与跟进          | 让首跑 / 单人主路径变难 → 不做或收到次要入口              |
| 2   | 交付结果质量高   | 交件达到可直接使用的专业水准，尽量顶掉律师一稿  | 只能产出待填摘要、不能改稿 / 计算 / 成套文书 → 不做主路径 |
| 3   | 交付结果稳定性高 | 同样交办结果不飘，失败可解释                    | 同任务结果更飘 / 更偶发 → 先修稳态再扩面                  |
| 4   | 先复用，后自研   | 先检索并验证外部 Skill、插件、MCP、工具和工作流 | 未做外部检索和差距验证就新造同类能力 → 不立项             |

一条容易误读的边界：**可审计不是产品价值**。日志、来源、哈希链、审批页只在服务具体用途（调试、恢复、撤销、安全调查、明确法规义务）时保留，不得包装成「可信法律 AI」。

## 1.3 术语表（本手册用词）

本手册严格遵循 `docs/LAWMIND-TERMINOLOGY.md` 的「一动作一词」。以下是最常用的对照，写代码时以英文标识符为准。

| 术语       | 定义                                             | 代码标识符（对照）                     |
| ---------- | ------------------------------------------------ | -------------------------------------- |
| 案件       | 律师承办的一件委托事项，系统内唯一实体词         | `matter`                               |
| 交办       | 律师把一件事交给系统去办的唯一动词               | `instruction` / `task`                 |
| 在办       | 正在进行、需要跟进的事项集合；也是工作面名称     | `agents`（视图）/ `fleet`              |
| 改稿       | 对文稿做修订的唯一动词；也是工作面名称           | `review` / `redline` / `surgical edit` |
| 审核       | 律师审阅系统产出、决定能否通过的唯一过程词       | `review`                               |
| 签批       | 律师对产出做出最终批准的唯一动词，签批前不得对外 | `approve`                              |
| 待我拍板   | 所有需要律师决定的事项的唯一入口名称             | approvals / judgment escalations       |
| 交付       | 把签批后的成品导出 / 送达                        | `render` / `delivery`                  |
| 记忆       | 系统经律师确认后记住的偏好、习惯与案件事实       | `memory` / adoption                    |
| 助手       | 系统内干活的角色                                 | `assistant` / `role`                   |
| 材料       | 律师提供给案件使用的文件与证据                   | `materials`                            |
| 本机文件夹 | 律师选出、允许助手读取的目录（可多个、可绑案件） | host folder / mount                    |
| 本机查找   | 在已选文件夹或系统查找中定位文件，点开才读正文   | `search_host` / `read_host_file`       |
| 收进本案   | 把本机文件复制进当前案件，成为本案材料           | `import_host_file`                     |
| 必核清单   | 签批前必须逐项确认的核对项                       | acceptance checklist                   |

已被判为禁用的近义词（本手册不再使用）：待办、复核、文书台、审批、批准、出货、智能体。

## 1.4 仓库地图

顶层职责划分（详见 `docs/LAWMIND-REPO-LAYOUT.md`）：

| 路径                                 | 职责                                                                       |
| ------------------------------------ | -------------------------------------------------------------------------- |
| `src/lawmind/`                       | 法律引擎：Agent、工具、草稿、检索、记忆、门禁、审计、安全                  |
| `apps/lawmind-desktop/electron/`     | Electron 主进程与 IPC 桥、本地 API 子进程监督                              |
| `apps/lawmind-desktop/server/`       | 本地 HTTP API 源码（路由注册表 + 鉴权 + SSE）                              |
| `apps/lawmind-desktop/src/renderer/` | 律师界面（React），含 `stores/` 局部状态                                   |
| `apps/lawmind-docs/`                 | VitePress 文档站；构建前把 `docs/LAWMIND-*.md` 与 `docs/lawmind/` 同步进来 |
| `docs/`                              | 文档单一事实来源；历史快照在 `docs/archive/`（只读）                       |
| `scripts/lawmind/`                   | CLI 与运维入口（对应 `pnpm lawmind:*`）                                    |
| `workspace/`                         | 开发 / 演示工作区盘面；运行数据由 `.gitignore` 排除                        |

引擎内部的模块怎么分层见 1.5；「哪些文件才算真相源」这条约定见 1.7。

## 1.5 四层架构与数据主链路

实际部署边界按四层落地（概念上的 Router / Memory / Retrieval / Reasoning / Artifact 五层仍可用来理解数据流）：

1. **桌面壳（Electron shell）**：`apps/lawmind-desktop/electron/`。渲染进程不直接访问文件系统或网络，所有敏感动作经本地 API 或 IPC 完成。
2. **本地 HTTP API**：`apps/lawmind-desktop/server/`。提供 `/api/*` 端点，承担会话、任务、草稿、审核、案件、助手、模型、记忆采纳等状态写侧。它是 Electron 本地可信边界向引擎的延伸。
3. **引擎（Engine）**：`src/lawmind/`。不直接暴露 UI，只通过本地 API 被调用。
4. **界面与交付**：`apps/lawmind-desktop/src/renderer/` 提供律师界面；`apps/lawmind-docs/` 提供文档站；`workspace/` 与各案件的 `artifacts/` 承载交付物。

数据主链路：

```text
律师指令（renderer）
  → 本地 API（apps/lawmind-desktop/server）
  → 引擎运行（Agent / 工具 / lint / 审计 / 安全层）
  → 状态回写（workspace 下的 JSON / JSONL / Markdown）
  → renderer 同步（HTTP 查询 + SSE 推送）
  → 律师审核 / 签批
  → 交付物渲染
  → 审计事件
```

异步通知统一走 **SSE**：`/api/events` 是全局事件流（15 秒心跳、支持 `task:*` 通配订阅），`/api/chat` 长连接流式返回助手文本、`tool_call_start` / `tool_call_end` / 门禁快照 / 压缩等事件。

事件契约**分在三个文件里**，别记成一个：

| 契约                                                             | 位置                                            |
| ---------------------------------------------------------------- | ----------------------------------------------- |
| `RunTurnEvent`（回合内事件）                                     | `src/lawmind/agent/turn-orchestrator-events.ts` |
| `TaskExecutionState`、`GateDecision`、`AuditEnvelope` 等平台契约 | `src/lawmind/platform/contracts.ts`             |
| 会话与回合的持久化结构                                           | `src/lawmind/agent/types.ts`                    |

渲染进程与引擎共享同一份状态理解，靠的就是前两个文件。

## 1.6 两个引擎入口：经典流水线 vs Agent 循环

引擎有两条并存的主链路，读代码时务必先分清：

|          | 经典流水线                                                                  | Agent 循环                                                              |
| -------- | --------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| 工厂函数 | `createLawMindEngine`（`src/lawmind/engine/factory.ts`）                    | `createLawMindAgent`（`src/lawmind/agent/agent-factory.ts`）+ `runTurn` |
| 阶段     | plan → research → draft → review → render，五段显式                         | 一个回合内模型自行决定调用哪些工具，直到产出交付物                      |
| 入口路径 | `src/lawmind/engine/{planning,researching,drafting,reviewing,rendering}.ts` | `src/lawmind/agent/turn-orchestrator.ts`                                |
| 谁在用   | CLI（`pnpm lawmind:round`）、引擎级测试与门禁                               | 桌面产品主路径（对话 / 在办 / 改稿 / 会议室）                           |
| 公开导出 | `src/lawmind/index.ts` 同时导出两者                                         | 同上                                                                    |

结论：**近两年的律师新功能几乎都挂在 Agent 循环与桌面路径上**（技能、工作台、案件副本、交付棘轮、洞察），经典流水线更多是稳定的底座与评测入口。本手册第 3 章专讲 Agent 循环，第 8 章讲草稿与改稿。

**怎么判断一段代码属于哪条链**：看它是不是被 `createLawMindEngine` 的五段之一调用。`engine/` 下的实现只跑在 CLI 与评测里；桌面上做的事，最终都会落进 `runTurn`。唯一容易混的是草稿落盘（`persistDraftPipeline`）——两条链都会用，所以它被单独抽出来（第 53 章讲）。

## 1.7 真相源与派生层

这是全仓库最重要的分层约定，直接决定「改了哪里才算真的改了」：

| 类别          | 位置 / 组件                                                                                                             | 说明                                                                |
| ------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| 案件真相源    | `workspace/matters/<id>/matter.json`、`deliverables/*.json`、`approvals.jsonl`、`queue.jsonl`、`deadlines.jsonl`        | 由 `src/lawmind/adapters/matter-storage/` 读写，原子写 + JSONL 追加 |
| 会话真相源    | `sessions/*.json` + 会话 transcript 行                                                                                  | 由 `src/lawmind/agent/session.ts`、`session-event-log.ts` 维护      |
| 记忆真相源    | `MEMORY.md`、`LAWYER_PROFILE.md`、`FIRM_PROFILE.md`、`CLIENT_PROFILE.md`、`memory/YYYY-MM-DD.md`、`cases/<id>/CASE.md`  | Markdown 人工可读，写入收敛到记忆采纳服务                           |
| 派生 / 可重建 | `src/lawmind/indexing/`（SQLite FTS5）、`src/lawmind/cases/` 索引、`src/lawmind/metrics/` 统计、`src/lawmind/insights/` | 删掉可从真相源重建；不把派生层当事实                                |

检索索引是 **FTS5 全文检索（非向量）**，且 Markdown / JSONL 始终是真相源，索引可重建（`POST /api/search/workspace/rebuild`）。

## 1.8 三档 Edition 与功能门禁

`src/lawmind/policy/edition.ts` 定义三档，解析优先级为 `policy.edition` > 环境变量 `LAWMIND_EDITION` > 默认值 `solo`（永不报错，不存在「许可缺失」状态）：

| Edition id       | 中文名       | 典型差异（节选）                                                                                         |
| ---------------- | ------------ | -------------------------------------------------------------------------------------------------------- |
| `solo`           | 独立律师版   | 默认档；`wordAddinAutoRun` 默认**开**；`guardianTrackedRedlineBlock` 默认**关**（修订稿结论为 advisory） |
| `firm`           | 律所协作版   | 开协作摘要、利益冲突墙、强制同行审核、案件副本协作；修订稿独立审稿默认**硬墙**                           |
| `private_deploy` | 私有化部署版 | 额外开合规审计导出、SBOM 安全面板                                                                        |

门禁以 `isFeatureEnabled(featureKey)` 的形式在引擎与渲染进程两侧消费；`GET /api/policy/edition`、`GET /api/policy/workspace` 是读侧入口。`src/lawmind/build-channel.ts` 另有一条 `LAWMIND_BUILD_CHANNEL=oss|commercial` 的商业隔离开关，与 Edition 是两件事。

## 1.9 安全层速览

安全不是单独进程，而是贯穿本地 API、引擎与平台契约的一组默认策略。细节见第 15 章，这里先记住「两个统一出口」：

- **出口代理**：`src/lawmind/platform/outbound-proxy.ts` 是唯一的 HTTP 出口（scheme 规则、SSRF 黑名单、拒绝 URL 内嵌凭据、超时重试、代理环境变量、根证书注入、`outbound_http` 审计事件且不记 body / query）。
- **命令网关**：`src/lawmind/platform/safe-command.ts` 是唯一的子进程出口（绝对路径解析、默认 `allowShell:false`、过滤掉 API key 的最小子环境变量、`allowedRoots` cwd 围栏、超时杀进程、`safe_command` 审计事件）。

再叠四条：

- **工作区写保护**：`.env*`、`lawmind.policy.json` 等由 `src/lawmind/runtime/protected-workspace-rels.ts` 保护，工具与渲染进程无法直接覆盖。
- **权限模式**：`src/lawmind/agent/permission-mode.ts` 把会话分为 `standard`、`strict`、`readonly`、`research` 四档，由 `src/lawmind/runtime/tool-pipeline.ts` 的 `permissionModeMiddleware` 在执行层硬拦。
- **工具管线**：`runtime/tool-pipeline.ts` 是唯一承载式强制点（预算 / 角色白名单 / 审批 / 澄清门 / 参数 schema / 超时 / 审计 / 执行）。
- **审计完整性**：`src/lawmind/audit/hash-chain.ts` 与 `root-anchor.ts` 为每个工作区维护完整性链与根锚，支持导出与事后篡改检测。

## 1.10 怎么读后面的章节

- 第 2 章是唯一需要「照做」的章节：装好、跑通首跑、认全界面。
- 第 3 章起进入单个功能面；每章都遵循同一结构：**定位 → 怎么用 → 边界 → 实现调用链 → 关键文件 → 已知坑**。
- 涉及「一家之言」的设计判断，本手册只陈述代码里的事实，并指向对应的现行文档（`GOALS.md`、`docs/LAWMIND-*.md`）。

## 1.11 五层概念模型与四层落地

第 1.5 节说的是「实际部署边界」的四层。但如果你去看架构文档，会看到另一套**五层**的说法：

```text
Router → Memory → Retrieval → Reasoning → Artifact
```

两套是不同视角，不是矛盾：

| 五层（概念） | 回答什么               | 落到哪                                                |
| ------------ | ---------------------- | ----------------------------------------------------- |
| Router       | 这件事该怎么归类和路由 | `src/lawmind/intent/`、`src/lawmind/router/`          |
| Memory       | 参考什么背景           | `src/lawmind/memory/`                                 |
| Retrieval    | 去哪里找依据           | `src/lawmind/retrieval/`                              |
| Reasoning    | 怎么做判断和组织       | `src/lawmind/reasoning/`、`src/lawmind/drafts/`       |
| Artifact     | 交付成什么             | `src/lawmind/artifacts/`、`src/lawmind/deliverables/` |

四层（部署）回答的是「代码放在哪个进程里跑」；五层回答的是「数据怎么流」。

**读代码时的实用价值**：如果你想知道「一个功能在链路的哪一环」，用五层去看；如果你想知道「它跑在哪、谁能碰它」，用四层去看。

## 1.12 一条完整的指令流（逐步展开）

第 1.5 节给了一条压缩过的数据主链路。这里把它展开成一次真实的调用序列（以「审一份合同」为例）：

```text
① 律师在渲染层输入指令（或拖入文件）
② 渲染层 → POST /api/chat（带 apiBase + 派生凭据）
③ 本地 API 分发：
   - CORS 头 / 回环 Host 门 / 鉴权 / 客户端范围 / Content-Type 检查
   - 命中 lawmind-server-route-chat
④ 路由处理器构造 AgentConfig 与工具注册表
⑤ runTurn 开始：
   - 会话回合门（串行化同会话）
   - 挂载 MCP
   - 解析预算与权限模式
   - 装载/新建会话
   - 回合分类（是不是 Word 改稿 / 邮件短路径 / 无任务）
   - 构造 AgentContext
   - 算出本轮工具表（7 级收窄链）
   - 组装系统提示（技能正文进这里）
   - 写用户消息、冻结回合上下文、落盘占位轮次
   - 发 turn_begin / intent / token_budget 事件
   - 必要时压缩历史并重注红线
⑥ 模型↔工具循环（可能多轮）：
   - 每轮：claim 中途注入 → 重建工具表 → 采样 → 执行工具批次
   - 工具执行走 18 道中间件
   - 需要审批时中断，进待我拍板
⑦ 收尾：finalizeAgentTurn
   - 落盘回合结果
   - 处理 Word 改稿的自动导出
   - 清理隐藏消息
⑧ 事件通过 SSE 回到渲染层（delta / tool_call_* / final）
⑨ 草稿落 drafts/<taskId>.json，交付物落 matters/<id>/deliverables/
⑩ 审计按天写 audit/YYYY-MM-DD.jsonl
```

**每一步的失败处理**：第 ③ 步失败返回错误信封；第 ⑤ 步失败落错误回合；第 ⑥ 步模型失败会发 `model_error` 并落助手错误气泡；第 ⑦ 步失败会清理。

## 1.13 判断「什么是真相源」的四条可操作标准

第 1.7 节列了真相源清单。但遇到一个新文件时，怎么判断它是不是真相源？四条标准：

1. **删了它会不会丢信息？** 会 → 真相源。不会（能重算）→ 派生数据。
2. **它是不是人可以打开直接改并且生效？** 是 → 真相源（记忆类的 Markdown 都是）。
3. **有没有别的代码「以它为准」来重建别的东西？** 有 → 真相源。
4. **它的路径有没有被写保护？** 被保护 → 通常是治理/真相源类（`lawmind.policy.json`、`RULES.md`）。

按这四条过一遍：

| 文件                  | 删了丢信息？         | 人可改生效？ | 别人以它为准？ | 结果   |
| --------------------- | -------------------- | ------------ | -------------- | ------ |
| `matter.json`         | 是                   | 是           | 是             | 真相源 |
| `CASE.md`（结构化段） | 是（可从 JSON 重建） | 是           | 否             | 投影   |
| `drafts/<id>.json`    | 是                   | 是           | 是             | 真相源 |
| `search-index.sqlite` | 否                   | 否           | 否             | 派生   |
| `decisions` 样本      | 否（事件可重放）     | —            | —              | 派生   |
| `LAWYER_PROFILE.md`   | 是                   | 是           | 是             | 真相源 |
| `golden/*.json`       | 是                   | 是           | 是             | 真相源 |

## 1.14 Edition 与 build-channel 的区别

两个看起来都在「分版本」，但完全不同：

|            | Edition                               | build-channel                          |
| ---------- | ------------------------------------- | -------------------------------------- |
| 变量       | `policy.edition` 或 `LAWMIND_EDITION` | `LAWMIND_BUILD_CHANNEL`                |
| 取值       | `solo` / `firm` / `private_deploy`    | `oss` / `commercial`                   |
| 什么时候定 | 运行时（可改）                        | 构建时                                 |
| 影响什么   | 功能显隐                              | 代码隔离（商业版里有开源版没有的东西） |
| 谁能改     | 用户 / IT                             | 只有构建者                             |

一句话：**Edition 管「给谁用」，build-channel 管「哪份代码」。**

## 1.15 术语表的完整对照

第 1.3 节给了常用术语。这里给一份更完整的对照（代码标识符 ↔ 界面用词 ↔ 禁用词）：

| 代码                      | 界面用词      | 禁用词                     |
| ------------------------- | ------------- | -------------------------- |
| `matter`                  | 案件          | 项目、事项、案子           |
| `instruction` / `task`    | 交办          | 派单、下单、提交任务       |
| `agents`（视图）          | 在办          | 待办、办理中               |
| `review`（动作）          | 审核          | 复核、审查（指律师看稿时） |
| `review`（工作面）        | 改稿          | 修订、文书台、批稿         |
| `approve`                 | 签批          | 批准、通过（作按钮）、签发 |
| approvals + escalations   | 待我拍板      | 待办中心、审批中心         |
| `render` / `delivery`     | 交付          | 出货、导出成品             |
| `memory` / adoption       | 记忆          | 学习（作名词）、知识库     |
| `assistant` / `role`      | 助手          | Agent、智能体、机器人      |
| `materials`               | 材料          | 语料、上下文文件           |
| host folder / mount       | 本机文件夹    | 项目目录、挂载盘           |
| `search_host`             | 本机查找      | 全盘扫描                   |
| `import_host_file`        | 收进本案      | 导入工作区                 |
| acceptance checklist      | 必核清单      | 检查点、gate 项            |
| `redline` / surgical edit | 改稿 / 写修订 | —                          |

维护规矩是**单向**：先改 `docs/LAWMIND-TERMINOLOGY.md`，再同步 `lawmind:ui-copy-lint` 的禁词清单。

## 1.16 怎么读这个仓库的代码

如果你想深挖某一章讲的实现，按这个顺序进入最省时间：

1. **先看目录的 `index.ts` 或 README。** 有 README 的目录（`audit/`、`clause/`、`evaluation/`、`metrics/`、`platform/`）通常把口径写得很清楚。
2. **再找一个 `.test.ts` 看行为。** 测试标题往往比注释更能说明「这东西实际怎么用」。
3. **然后看实现文件的头部注释。** 这个仓库的头部注释经常包含「为什么这么设计」和「踩过的坑」。
4. **最后看函数签名。** 签名告诉你边界（必填/可选、返回什么），但不告诉你为什么。

四步里最有价值的是第二步和第三步：**测试告诉你行为，头部注释告诉你原因。**

还有一条：**看到 `matter-ops/storage.ts` 这类绕过协议的模块，不要模仿它**（第 7 章那个已知问题）。

## 1.17 几个「一眼会看错」的地方

| 看起来像                        | 实际是                                                         |
| ------------------------------- | -------------------------------------------------------------- |
| `src/lawmind/integration/`      | **只有测试**，不是运行时能力                                   |
| `src/lawmind/legal/`            | 单个文件（免责声明文案）                                       |
| `src/lawmind/review/`           | 单个文件（CLI 审核门）                                         |
| `agent/tool-name-sets.ts`       | 在 `agent/` 下，**不在 `tools/` 下**                           |
| `platform/local-api-schemas.ts` | 服务端和引擎共享的 zod schema                                  |
| `lawmind/policy.json`           | 真实名字是 **`lawmind.policy.json`，在工作区根**               |
| `LAWMINd_*` 之类                | 全大写 `LAWMIND_*`，小写是笔误                                 |
| `context_deferral_bounce`       | 事件成员**只声明一次**；别把服务端 switch 里的两处当成重复成员 |

## 1.18 这家产品明确不做什么

按第 1.2 节的四条铁律和 `VISION.md`，有几件事是明确不做的：

| 不做                         | 原因                               |
| ---------------------------- | ---------------------------------- |
| 不做网页版工作台             | 产品就是本机桌面应用               |
| 不把「可审计」当卖点         | 记录过程不等于结论正确             |
| 不发明「安全分」             | 无法验证的分数是虚假代理指标       |
| 不在没样本时报 0%            | 「没有数据」和「没有漏网」是两件事 |
| 不自动外发                   | 外发永远要人点                     |
| 不自动合并冲突文件           | 两份法律文件不许机器裁决           |
| 不编造法条/案号              | 查不到就标待核实                   |
| 不静默写入记忆               | 未确认零写入                       |
| 不锁死产品（许可到期只提醒） | 信任优先                           |
| 不下载运行外部技能包         | 只登记元数据与方法借鉴             |

这十条合起来，构成了一份比功能列表更能说明「这是什么产品」的说明。
