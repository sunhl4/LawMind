# 第 1 章 总览：产品、术语与架构

本章是全书的地基。读完它，你应该能回答三个问题：LawMind 是什么、代码分成哪几层、同一个功能该去哪一层找。

## 1.1 一句话定位

LawMind 是一个**本地优先的律师工作台**：律师提出交办并提供材料后，系统选择并组合最合适的能力，持续执行到可用的交付物，而不是停在「对话轮次」。

它由三部分构成，缺一不可：

- **桌面壳**：`apps/lawmind-desktop/electron/`，Electron 主进程，负责窗口、菜单、IPC、原生对话框、本地 API 子进程监督、自动更新。
- **本地 HTTP API**：`apps/lawmind-desktop/server/`，渲染进程唯一的状态写侧；只监听回环地址。
- **法律引擎**：`src/lawmind/`，Agent 循环、工具与治理、草稿与改稿、检索、记忆、门禁、审计、安全层。

产品 UI 只有**桌面应用**一种形态。

## 1.2 律师产品五条铁律

所有产品与工程取舍必须同时满足下表五条（来源：`GOALS.md` §二，`VISION.md` 的英文摘要与之对应）。

| #   | 铁律             | 律师侧含义                                                                 |
| --- | ---------------- | -------------------------------------------------------------------------- |
| 1   | 上手简单         | 少配置、少迷路；默认路径就能交办与跟进                                     |
| 2   | 交付结果质量高   | 交件达到可直接使用的专业水准，尽量顶掉律师一稿                             |
| 3   | 交付结果稳定性高 | 同样交办结果不飘，失败可解释                                               |
| 4   | 先复用，后自研   | 先检索并验证外部 Skill、插件、MCP、工具和工作流                            |
| 5   | 发挥模型能力     | 默认模型持续变强；判断交给模型。硬控只留安全、空交付、明确授权和不可逆操作 |

**可审计不是产品价值**。日志、来源、哈希链、审批页只在服务具体用途（调试、恢复、撤销、安全调查、明确法规义务）时保留。

## 1.3 术语表（本手册用词）

本手册严格遵循 `docs/LAWMIND-TERMINOLOGY.md` 的「一动作一词」。下表是**速查**：完整口径（适用范围、分场景细则、禁词归类）以那份文档为准；写代码时以英文标识符为准。

| 术语       | 定义                                             | 代码标识符（对照）                                | 禁用近义词                                               |
| ---------- | ------------------------------------------------ | ------------------------------------------------- | -------------------------------------------------------- |
| 案件       | 律师承办的一件委托事项，系统内唯一实体词         | `matter`                                          | 项目、事项、案子                                         |
| 交办       | 律师把一件事交给系统去办的唯一动词               | `task`（交办事项）/ `instruction`（交办动作）     | 派单、下单、提交任务、发起任务                           |
| 在办       | 正在进行、需要跟进的事项集合；**也是工作面名称** | `agents`（视图）/ `fleet`                         | 待办、办理中                                             |
| 改稿       | 对文稿做修订的唯一动词；也是改稿工作面名称       | `apply_surgical_edits` / `render_tracked_draft`   | 修订（作动词）、修改文稿、文书台、批稿                   |
| 审核       | 律师审阅系统产出、决定能否通过的唯一过程词       | `review`（`reviewStatus`、`src/lawmind/review/`） | 复核、审查（指律师看稿时）、审批（指过程时）             |
| 签批       | 律师对产出做出最终批准的唯一动词，签批前不得对外 | `approve`                                         | 批准（作动词）、通过（作按钮动词）、签发                 |
| 待我拍板   | 所有需要律师决定的事项的唯一入口名称             | approvals / judgment escalations                  | 待办中心、审批中心、待处理                               |
| 交付       | 把签批后的成品渲染成可发送 / 送达的形式          | `render` / `delivery`                             | 出货、导出成品（作栏目名时）                             |
| 记忆       | 系统经律师确认后记住的偏好、习惯与案件事实       | `memory`（`adoption` 是写回机制名，不进律师面）   | 学习（作名词）、知识库（指个人记忆时）、注入             |
| 助手       | 系统内干活的角色                                 | `assistant` / `role`                              | Agent、智能体、机器人、AI 员工                           |
| 材料       | 律师提供给案件使用的文件与证据                   | `materials`                                       | 语料 / 语料库（指律师自己的材料时）、上下文文件、context |
| 本机文件夹 | 律师选出、允许助手读取的目录（可多个、可绑案件） | host folder / mount                               | 项目目录（新文案禁用）、挂载盘                           |
| 本机查找   | 在已选文件夹或系统查找中定位文件，点开才读正文   | `search_host`（定位）/ `read_host_file`（读正文） | 全盘扫描、Spotlight（UI）、host search                   |
| 收进本案   | 把本机文件复制进当前案件，成为本案材料           | `import_host_file`                                | 导入工作区、ingest、import to workspace                  |
| 必核清单   | 签批前必须逐项确认的核对项                       | `acceptanceChecklist`                             | 检查点、checkpoint、gate 项                              |

§1.15 讲三个最容易看错的**代码 ↔ 用词**陷阱，以及这套词表的执法方式。

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

> **口径归属**：**层次划分与各层装了什么**（职责清单、路由清单、阶段规划）以 `docs/LAWMIND-ARCHITECTURE.md` 为准，研究笔记见 `docs/lawmind/LAWMIND-ARCHITECTURE-STUDY.md`。**运行规则与排查口径**（谁在调引擎、两套写侧、tick 主人互斥、事件总线与契约）以**本节**为准——它更贴当前代码。两处冲突时按本节 + 代码改回去：已发生过 `RunTurnEvent` 的位置、「`.env*` 保护」被抄错（见 32 章那套「一处定义」的教训）。所以本节只讲手册必需的部分，不含各层的文件清单。

实际部署边界按四层落地，这四层都是**运行域**（回答「代码跑在哪个进程里」）。概念上的 Router / Memory / Retrieval / Reasoning / Artifact 五层仍可用来理解数据流，见 1.11。

| 层              | 路径                                 | 这一层的角色                                                               | 读代码时要记住的边界                                                                                                                          |
| --------------- | ------------------------------------ | -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| ① 桌面壳        | `apps/lawmind-desktop/electron/`     | Electron 主进程：唯一能碰原生能力、进程生命周期与本地凭据的层              | **不 import 引擎**，只走 HTTP 或 spawn                                                                                                        |
| ② 本地 HTTP API | `apps/lawmind-desktop/server/`       | 独立子进程；**引擎的真实宿主**（同进程、直接 import）；对界面暴露 `/api/*` | 只监听回环（`127.0.0.1` + `::1`）                                                                                                             |
| ③ 引擎          | `src/lawmind/`                       | 干活的那层；无自己的界面                                                   | **不是「只被本地 API 调用」**——见下「谁在调引擎」                                                                                             |
| ④ 界面          | `apps/lawmind-desktop/src/renderer/` | 律师看到的界面；只负责呈现与收集输入                                       | **不能上外网**（CSP 只放行回环）、**不能直接用 `node:fs`**；但能经 IPC 文件桥读写工作区文件，也能进程内 import 引擎的「零 Node 依赖」叶子模块 |

每层装了什么（文件清单 / 路由清单 / 能力清单）不在本节重复：路径级职责见 1.4，完整架构叙述见 `docs/LAWMIND-ARCHITECTURE.md` 的「二、总体架构」与「十一b、桌面应用架构」。另外**三种东西不属于运行域**，别按层去理解：文档站（构建产物）、`workspace/` 与 `artifacts/`（数据/交付面）、`scripts/lawmind/`（CLI 入口）。

两个**同名但不是同一个东西**的文件，读代码时最容易混：`apps/lawmind-desktop/electron/local-server.mjs` 是主进程侧的主管/凭据代理（选端口、装密钥、spawn 子进程、崩溃重启、把 `apiBase` 经 IPC 推给界面），`apps/lawmind-desktop/server/lawmind-local-server.ts` 才是引擎 + API 本体。打包后真正跑的是 `resources/lawmind-server/lawmind-local-server.cjs`（`pnpm lawmind:bundle:desktop-server` 用 esbuild 打出来的 CJS）；开发态用 tsx 直跑 TS 入口。

### 谁在调引擎（这里最容易记错）

| 调用者                    | 方式                                | 说明                                                                                                         |
| ------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| 本地 API（`server/`）     | **进程内直接 import**               | 引擎的真实宿主；会话/草稿/案件/审批/记忆的权威状态都从这里进出                                               |
| 桌面壳（`electron/`）     | **只走 HTTP / spawn**               | 生产代码里 0 个引擎 import                                                                                   |
| 界面（`renderer/`）       | **进程内直接 import（受门禁约束）** | 只许零 `node:` 依赖的叶子模块（常量、纯函数、类型）；由 `check-renderer-node-imports` 把关，违反即 CI 红     |
| CLI（`scripts/lawmind/`） | **进程内**                          | `pnpm lawmind:round`、`lawmind:doctor` 等                                                                    |
| `lawmindd` 守护进程       | **进程内**                          | 同一个入口脚本以 `LAWMIND_DAEMON=1` 启动，**在监听之前就 return，不监听 HTTP**；后台自动化与长跑任务跑在这里 |

所以准确说法是：**引擎的权威状态只经本地 API 进出；纯计算叶子模块允许界面进程内直调；CLI 与 `lawmindd` 是另外两个宿主。**「只通过本地 API 被调用」是错的。

**同一入口三种模式**（读这段代码时最容易踩的坑）：`server/lawmind-local-server.ts` 一个脚本同时是①桌面 API、②`lawmindd`（`LAWMIND_DAEMON=1`）、③守护监督进程（`LAWMIND_DAEMON_SUPERVISOR=1`）。两个硬约束：

- **监督进程必须在任何重活之前分支**——否则它会重复干一遍子进程的活，并且**持有两份状态**。
- **`.env.lawmind` 必须先于 skill seed 加载**——否则 `SKILL.sig` 会用「按工作区路径派生」的兜底密钥签名，而消费方用加载后的密钥验签，必然不通过 ⇒ **技能静默失效**。

### 同一时刻只有一个 tick 主人（第三处、也是最重要的一处）

`lawmindd` 会写引擎域状态（工作流 job、委派、自动化），所以「唯一写侧」只对**渲染进程**成立。两个引擎宿主不会并行写同一份真相源，靠两道闸：

- **桌面 API 启动时主动收掉守护进程**——「窗口开着的时候 tick 归桌面」：

```text
apps/lawmind-desktop/server/lawmind-local-server.ts（节选）
  if (!daemonMode) {
    try {
      stopDaemonProcess(workspaceDir);
    } catch {
      /* desktop owns ticks while the window is open */
    }
  }
```

- **守护进程自己再抢一次单实例锁**（`wx` 原子创建、陈锁接管、只释放属于自己的锁），抢不到就退出：

```text
apps/lawmind-desktop/server/lawmind-local-server.ts（节选）
  if (daemonMode) {
    // 抢锁才是互斥依据：pid 文件的「读→判→写」之间有竞态。
    const lock = acquireDaemonLock(workspaceDir);
    if (!lock.acquired) {
```

**被抢占时正在跑的回合不会凭空消失**：`lawmindd` 收到 SIGTERM 即退出（不排空），而中断的回合会被呈现为一个状态并派生「继续本件 / 弃办」卡片（`src/lawmind/agent/turn-interrupt.ts`），job 侧记 `interrupted_by_restart`。所以「关窗那一刻正在办的事」是可恢复的，不是丢了。

### 两套写侧（第二处容易记错的地方）

| 写什么                                                                                                                                              | 走哪                                                                                                                    |
| --------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| **引擎域状态**：会话、任务、草稿、审核、案件、助手、模型、记忆采纳                                                                                  | 本地 API（`/api/*`）——**对渲染进程而言这是唯一写侧**（`lawmindd` 是第二个引擎宿主，见上「同一时刻只有一个 tick 主人」） |
| **应用配置 / 密钥 / 授权 / 文件字节**：`desktop-config.json`、`.env.lawmind`、`lawmind-secrets.json`、`host-access.json`、Word 侧载清单、工作区文件 | Electron 主进程的 IPC handler 直接落盘，**不走 API**                                                                    |

「唯一状态写侧」只在**引擎域**成立。配置类改动走 IPC 是刻意的（密钥要进系统钥匙串、端口与进程生命周期归主进程管），排查问题时别去 `/api/*` 找它们。

**文件字节这条写侧与引擎同口径地保护治理面**：`lawmind.policy.json`、`.env` / `.env.*`（**任意深度**）、`lawmind/`（含 MCP 配置）、`audit/`、`sessions/`、`tasks/`、`matters/`、以及任意深度的 `RULES.md` / `ethics-wall.json` / `.lawmind-dms.json` 一律拒写——包括 `fs:mkdir` / `fs:rename` / `fs:delete` / `fs:copy` 这些会连带整棵子树的动词，以及「删掉一个**包含**保护文件的目录」。

口径**一处定义、两处落地、两个分支**，别记成「只有一个判定点」：

|       | 位置                                                                     | 判什么                                                                                                 |
| ----- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| 规范  | `src/lawmind/runtime/protected-workspace-rels.ts`                        | 路径身份（精确名 / 前缀 / 任意深度 basename）                                                          |
| 镜像① | `apps/lawmind-desktop/electron/fs-bridge.mjs` `resolveFsPath` write 分支 | 同上（主进程是 `.mjs`，import 不了 TS，故手抄）                                                        |
| 镜像② | 同上 `findProtectedEntryUnder`                                           | **子树扫描**：删/改名会连带整棵树时，看树里有没有保护文件（超 20k 节点按「可能有」处理，**失败关闭**） |

镜像与规范由 `apps/lawmind-desktop/electron/fs-bridge.test.ts` 的**行为等价**语料守着（比源码解析更耐重排版）；拒写文案与机器可读 code 也逐字对齐。同类的跨进程镜像还有一处：`electron/lawmind-model-probe.cjs` 的 `parseProbeErrorBody`（规范在 `src/lawmind/models/probe.ts`）——**这类镜像都要配一份漂移守卫**，这是本仓库的一条既定规矩。

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

说「异步通知统一走 SSE」要打个折。**服务端发起的**数据推送确实全是 SSE（没有 WebSocket、没有 socket.io、没有长轮询），但是**三条各自独立实现的流**，而且主进程还有三条 IPC 推送：

| 通道                                                                           | 心跳           | 用途                                                                                                                                                                                  |
| ------------------------------------------------------------------------------ | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/events`                                                              | **15 秒**      | 全局事件流：`fs:change`、`task:update`、`review:status`、`approval:update`、`delegation:update`；支持 `*` 与 `task:*` 通配订阅，重连时可带 `lastEventId` 做有界回放                   |
| `POST /api/chat`                                                               | **25 秒** ping | 回合流：助手文本 `delta`、`tool_call_start` / `tool_call_end`、`compact_boundary`、中途拍板事件、末端 `payload` + `done`                                                              |
| `GET /api/jobs/:id/stream`                                                     | **25 秒** ping | 工作流/异步任务的进度快照                                                                                                                                                             |
| `lawmind:loopback-config` / `lawmind:notification-click` / `lawmind:file-menu` | —              | 主进程 → 渲染进程的 IPC 推送，**不经过 SSE**                                                                                                                                          |
| **客户端定时轮询**（不是推送）                                                 | —              | 少数面板仍靠轮询补洞：`useLawmindBackgroundWatch` 每 **1.5 秒**、`LawmindAutomationsPanel` 每 **5 秒**。所以「界面会自己刷新」不只有 SSE 一条路——排查「为什么还在发请求」时别忘了它们 |

用 `fetch` + `ReadableStream` 手写 SSE 解析而不是 `EventSource`，是因为 `EventSource` 不能自定义 `Authorization` 头，而本地 API 要求 Bearer。

事件契约**分在五个地方**，别记成一个：

| 契约                                                             | 位置                                             |
| ---------------------------------------------------------------- | ------------------------------------------------ |
| `RunTurnEvent`（回合内事件的联合类型）                           | `src/lawmind/agent/turn-orchestrator-events.ts`  |
| `/api/chat` 的 **SSE 事件名清单**（转发的就是它）                | `src/lawmind/agent/embed-turn-events.ts`         |
| `/api/events` 的载荷契约                                         | `apps/lawmind-desktop/server/lawmind-sse-bus.ts` |
| `TaskExecutionState`、`GateDecision`、`AuditEnvelope` 等平台契约 | `src/lawmind/platform/contracts.ts`              |
| 会话与回合的持久化结构                                           | `src/lawmind/agent/types.ts`                     |

前两条都是「事件」，但职责不同：一条声明**类型**，一条声明**名字**。

「渲染进程与引擎共享同一份状态理解」要分两半看：

- `platform/contracts.ts` 真的被两侧共享（渲染层有十几个文件 import 它）。
- `RunTurnEvent` **只在引擎与本地 API 之间共享**（`server/` import 它）；渲染层不 import 它，而是按 `embed-turn-events.ts` 的事件名解析 SSE 帧。渲染层那份事件名现在是从清单里取值，所以引擎改/加事件名会在渲染层**编译期报错**，而不是静默漏掉。

**门禁（gate）不是独立事件**：判定结果跟着回合末端的 `payload.gateDecisions` 一起回来；中途需要律师拍板时走 `approval_request`（带 `gateDecision`）与 `requires_action`。

## 1.6 两个引擎入口：经典流水线 vs Agent 循环

引擎有两条并存的主链路。对话回合由模型选工具；出稿、审核、导出这些交付步骤仍走固定工序。读代码时先分清这段属于哪一条：

|          | 经典流水线                                                                                                                                                                                                                                                               | Agent 循环                                                                                          |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| 工厂函数 | `createLawMindEngine`（`src/lawmind/engine/factory.ts`）                                                                                                                                                                                                                 | `createLawMindAgent`（`src/lawmind/agent/agent-factory.ts`），回合进入 `runTurn`                    |
| 阶段     | plan → confirm → research → draft → review → render。`confirm` 出现在这条链上，也出现在 Agent 把流水线当工具调用的时候                                                                                                                                                   | 一个回合内模型自行决定调用哪些工具，直到产出交付物                                                  |
| 入口路径 | `src/lawmind/engine/{planning,researching,drafting,reviewing,rendering}.ts`                                                                                                                                                                                              | `src/lawmind/agent/turn-orchestrator.ts`                                                            |
| 谁在用   | CLI（`pnpm lawmind:round`）、引擎级测试与门禁；桌面审核 / 导出 / 打回重审直接调 `engine.review`、`engine.render`、`engine.reopenDraftReview`；Agent 工具内部也会整段跑这条流水线（`src/lawmind/agent/tools/engine/engine-pipeline-tools.ts`、`engine-workflow-tool.ts`） | 桌面对话、在办、改稿的回合主路径                                                                    |
| 公开导出 | `createLawMindEngine` 从 `src/lawmind/index.ts` 导出                                                                                                                                                                                                                     | `createLawMindAgent` 从 `src/lawmind/index.ts` 导出；`runTurn` 从 `src/lawmind/agent/index.ts` 导出 |

取舍是：模型决定**要不要走、走到哪**；工序决定**走的时候交付物怎么落盘、怎么被拦住**。技能、工作台、案件副本、交付棘轮、洞察挂在 Agent 循环与桌面路径上。审核、导出、打回重审仍直接打在流水线方法上。经典流水线同时是可单测的底座和评测入口。本手册第 3 章专讲 Agent 循环，第 8 章讲草稿与改稿，第 53 章讲流水线本身。

**怎么判断一段代码属于哪条链**：看它是不是被 `createLawMindEngine` 的工序之一调用。桌面对话的回合在 `runTurn`。审核、导出、打回重审是本地 API 直接调引擎方法（`apps/lawmind-desktop/server/lawmind-server-route-review.ts`、`lawmind-server-route-draft-revision.ts`）。草稿文件只有一个写入口 `commitDraft`（`src/lawmind/drafts/commit-draft.ts`）。经典起草走 `persistDraftPipeline`（`src/lawmind/engine/shared.ts`，先写审计、检索快照、推理图，再以 `channel: "pipeline"` 提交；缺检索快照会在写稿前抛错），只有 `engine/drafting.ts` 调用它。Agent 工具走 `persistDraft`，即 `channel: "file"`，不附带流水线副作用。每次提交另写 `drafts/<taskId>.completion.json`（起草中 / 机械验收绿 / 已通过审核 / 已签批）。审核落盘同样走 `commitDraft`，侧车与稿一起更新；审核台仍以 `reviewStatus` 为准，侧车把律师签批和系统自动通过分成 `signed` 与 `review_passed`。机械拦挡合成 `evaluateMechanicalVerdict`（`src/lawmind/drafts/mechanical-verdict.ts`）。正式 Word 导出是否因引用被拦，用的是同一文件里的 `citationViewBlocksExport`。第 53 章讲流水线那十二件事。

## 1.7 真相源与派生层

这条约定回答「改了哪里才算真的改了」。删了会丢、别人拿它重建别的东西，就是账本；删了还能算回来的，是派生。判断一个新文件按 §1.13 的顺序，先命中先停。文件全清单在附录 C，不要在别处再抄一张长表。

下面列的都是**工作区里的文件**。`src/lawmind/indexing/`、`cases/`、`metrics/`、`insights/` 是程序，删了不能从账本里长回来。

| 类别        | 工作区文件                                                                                                                                        | 谁写入                                                                                                                                        | 删了会怎样                   |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| 案件账本    | `matters/<id>/matter.json`、`deliverables/*.json`、`approvals.jsonl`、`queue.jsonl`、`deadlines.jsonl`                                            | `src/lawmind/adapters/matter-storage/`：JSON 先写临时文件再改名，JSONL 校验后追加，外加文件锁                                                 | 案子状态没了                 |
| 案件作战    | `matters/<id>/ops/scope.json`、`plan.json`、`theory-lite.json`、`raid.jsonl`                                                                      | `src/lawmind/matter-ops/storage.ts`，与主账本同一套原子写、校验和文件锁                                                                       | 范围、计划、风险、理论没了   |
| 草稿 / 任务 | `drafts/<taskId>.json`、`tasks/*.json`                                                                                                            | 草稿只经 `commitDraft`（`src/lawmind/drafts/commit-draft.ts`）。`drafts/` 对通用写文件、文件页和脚本沙箱是拒写的；任务见 `src/lawmind/tasks/` | 审核稿和任务行没了           |
| 会话        | `sessions/<id>.json`、`<id>.turns.jsonl`、`<id>.transcript.jsonl`、`<id>.events.jsonl`                                                            | 前三份由 `src/lawmind/agent/session.ts`（transcript 经 `adapters/session-transcript/`）；事件行由 `session-event-log.ts`                      | 这轮对话接不上               |
| 人读记忆    | `MEMORY.md`、`LAWYER_PROFILE.md`、`FIRM_PROFILE.md`、`CLIENT_PROFILE.md`、`memory/YYYY-MM-DD.md`，以及 `cases/<id>/CASE.md` 里第 4、6、7、8、9 节 | 建议走 `src/lawmind/memory/adoption-service.ts`。争点、进展等仍可由 `memory/case-writes.ts`、`memory/index.ts` 直接落盘，采纳队列只做镜像     | 偏好和案情叙述没了           |
| 审计与采纳  | `audit/YYYY-MM-DD.jsonl`、`memory-adoption/suggestions.jsonl`                                                                                     | 审计走哈希链；采纳状态是另一本账，和 Markdown 不在同一把锁里                                                                                  | 不能从案件 JSON 重放         |
| 指标事件    | `lawmind/metrics/product-events.jsonl`、`runtime-events.jsonl`                                                                                    | 运行时追加。比率和趋势快照从这里重算                                                                                                          | 事件历史没了；快照可以再算   |
| 派生        | `lawmind/search-index.sqlite`；内存里的案件索引（`src/lawmind/cases/` 现算，不落盘）；`quality/*.json` 等指标快照；`insights/` 算完即用、不落盘   | 索引由检索写入                                                                                                                                | 可以重建。拿它们当事实会看错 |

`CASE.md` 要拆开。第 1 节基本信息是 `matter.json` 的投影（`src/lawmind/application/matter-projection.ts`），投影重跑会盖掉手改。叙事节是账本，`buildMatterIndex` 读的就是这些节。

检索是 **FTS5 全文检索**。`indexing/embeddings/` 只在 `LAWMIND_EMBEDDING_ENABLED=1` 时启用本地哈希占位，不参与这套工作区索引。显式重建是 `POST /api/search/workspace/rebuild`，需要 `LAWMIND_ALLOW_INDEX_REBUILD=1`，否则 403。索引文件还不存在时，知识检索会在进程内自己重建，不看这个开关。

待办和审批的读路径仍会把 JSON 与从案卷、任务、草稿、审计现算的条目按 id 合并（`src/lawmind/application/services/queue-service.ts`）。旧工作区因此可能和 `matter.json` 不一致。写的时候以 JSON 账本为准。

## 1.8 三档 Edition 与功能门禁

`src/lawmind/policy/edition-features.ts` 是功能键表（浏览器可安全导入）；`edition.ts` 负责运行时解析。解析优先级为 `policy.edition` > 环境变量 `LAWMIND_EDITION` > 默认值 `solo`（字符串大小写不敏感；永不报错，不存在「许可缺失」状态）。许可证文件里的 edition **不驱动**这张表（软提醒另见第 15 章）：

| Edition id       | 中文名       | 典型差异（节选）                                                                                                                                                                   |
| ---------------- | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `solo`           | 独立律师版   | **主产品档**：单人能用的能力默认开（自定义文书、跨案概览、验收包、审计完整性等）；`wordAddinAutoRun` 默认**开**；`guardianTrackedRedlineBlock` 默认**关**（修订稿结论为 advisory） |
| `firm`           | 律所协作版   | 在 Solo 之上开多律师墙：利益冲突墙、强制同行审核、案件副本协作、危险工具硬批准；修订稿独立审稿默认**硬墙**；Word 插件自动跑默认**关**                                              |
| `private_deploy` | 私有化部署版 | 在 Firm 之上额外开合规审计导出、SBOM 安全面板                                                                                                                                      |

门禁以 `isFeatureEnabled(featureKey)`（或带覆盖的专用解析器）在引擎侧强制；渲染层通过 `GET /api/policy/edition` 消费同一份 `features`（`use-edition` 的失败回退与 Solo 表一致）。`GET /api/policy/workspace` 是出网 / 白名单等策略读侧，**不是** Edition 入口。

专用覆盖（比表更高优先）：`wordAddinAutoRun`、`guardianTrackedRedline`、`ethicsWall.enabled`、`matterReplica.enabled`、路由 `forcePeerReview`，以及前瞻性的 `policy.features.<key>` 布尔覆盖。`src/lawmind/build-channel.ts` 另有一条 `LAWMIND_BUILD_CHANNEL=oss|commercial` 的商业隔离开关，与 Edition 是两件事（见 §1.14）。

完整 17 键对照表见第 15 章 §15.8。

## 1.9 安全层速览

安全不是单独进程，而是贯穿本地 API、引擎与平台契约的一组默认策略。细节见第 15 章，这里先记住「两个统一出口」：

- **出口代理**：`src/lawmind/platform/outbound-proxy.ts` 是引擎侧出站 HTTP 的规范出口（scheme 规则、SSRF 黑名单、拒绝 URL 内嵌凭据、超时重试、代理环境变量、根证书注入、`outbound_http` 审计事件且不记 body / query）。模型、检索、MCP HTTP、Graph 邮件、SharePoint 已接入。
- **命令网关**：`src/lawmind/platform/safe-command.ts` 是引擎侧子进程的规范出口（绝对路径解析、默认 `allowShell:false`、过滤掉 API key 的最小子环境变量、`allowedRoots` cwd 围栏、超时杀进程、`safe_command` 审计事件）。MCP stdio、工具沙箱、lawmindd、officecli 修订稿、邮件转 docx / 读 `.doc`、本机 Spotlight（`mdfind`）、分析脚本沙箱（ipc）已接入。

再叠四条：

- **工作区写保护**：`lawmind.policy.json`、`.env` / `.env.*`（任意深度）、以及 `lawmind/`、`audit/`、`sessions/`、`tasks/`、`matters/` 等由 `src/lawmind/runtime/protected-workspace-rels.ts` 保护，工具与渲染进程无法直接覆盖。
- **权限模式**：`src/lawmind/agent/permission-mode.ts` 把会话分为 `standard`、`strict`、`readonly`、`research` 四档。`readonly` / `research` 由 `permissionModeMiddleware` 按工具名白名单硬拦；`strict` 是把危险工具改成必须律师批准（见 `turn-orchestrator`），不是另一套白名单。只读仍允许本机挂载检索与联网检索——它不是操作系统隔离。
- **工具管线**：`runtime/tool-pipeline.ts` 是工具调用的唯一承载式强制点（预算 / 角色白名单 / 审批 / 澄清门 / 参数 schema / 超时 / 审计 / 执行）。出网、起进程、写保护是另外三道闸，不在这条链上。
- **审计完整性**：`src/lawmind/audit/hash-chain.ts` 与 `root-anchor.ts` 为每个工作区维护完整性链与根锚，支持导出与事后篡改检测（根锚与链同处工作区，防的是「只改链文件」）。

**有意保留的例外**（第 15 章详述）：Electron 主进程拉起本地 API（`electron/local-server.mjs`）仍直接 `spawn`——`.mjs` 一时接不上 TS 网关，且不是律师数据出口（铁律 1/4：不另造镜像拖累 Day-1）。新增出网 / 起进程能力时，默认接上面两扇门。

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

四层（部署）回答的是「代码放在哪个进程里跑」；五层回答的是「数据怎么流」。层与层之间交的是结构化契约，不是聊天记录。

Retrieval 交给 Reasoning 的契约是 `ResearchBundle` → `LegalReasoningGraph`。结论已经引用的合同、案件文件、工作区文件才写入对应争点的 `facts`。工作区检索只产出来源、不产结论，所以 `CASE.md` 和客户画像不会自动变成某条争点的事实——那样等于替模型判定「这条争点用了这份材料」。它们只出现在交付风险里，文案是「起草时自行判断是否写入」，不计入事实数，也不拦截交付。来源上的 `citation` 是短摘录（跳过标题行），不是整份档案。

推理图的往返真相是 `drafts/<taskId>.reasoning.json`：先写临时文件再改名；读回时校验形状，坏文件当作没有图。给人看的 Markdown 会写出案件事实，但 `parseLegalReasoningGraphMeta` 只恢复任务号、案件号、置信度和时间，不拿 Markdown 还原整图。

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
   - 算出本轮工具表（7 级链：允许集收窄，披露再加回）
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
⑨ 草稿落 drafts/<taskId>.json；推理层侧车落 drafts/<taskId>.reasoning.json（原子写入，读回校验形状）
⑩ 交付物落 matters/<id>/deliverables/；审计按天写 audit/YYYY-MM-DD.jsonl
```

**每一步的失败处理**：第 ③ 步失败返回错误信封；第 ⑤ 步失败落错误回合；第 ⑥ 步模型失败会发 `model_error` 并落助手错误气泡；第 ⑦ 步失败会清理。

## 1.13 判断「什么是真相源」：按顺序用的四条

第 1.7 节列了真相源清单。遇到一个新文件时，按下面的顺序判，**先命中先停**。四条并列去打勾会对不上：审计日志删了会丢、但人不该改；`CASE.md` 第 1 节人能改、但投影会盖掉；`drafts/` 是账本，同时对通用写文件拒写。写保护回答的是「通用文件接口能不能碰」，不是「它是不是事实」。

1. **别的文件能把它重算出来，而且重算不会丢掉律师写的或审计过的事实？** 能 → 派生（投影、索引、指标快照）。手改不算数。
2. **删了会丢掉一份别处没有的事实？** 会 → 账本。这类文件有指定写入口（草稿是 `commitDraft`，案件 JSON 是 matter storage，审计是哈希链追加）。通用写文件、文件页、脚本沙箱不是这个入口。
3. **人可以打开改、并且改完以这份为准？** 这只用来认出人读账本（`MEMORY.md`、`CASE.md` 叙事节）。投影和派生文件即使能打开改，也不算。
4. **路径被写保护？** 这是控制，不是分类。密钥和治理文件（`lawmind.policy.json`、`RULES.md`、整棵 `lawmind/`）会被拒写，其中有的是策略、有的是派生索引。`MEMORY.md` 是账本，却故意不在这张拒写表里。

按这个顺序过一遍：

| 文件                                   | 删了丢信息？                | 人可改生效？                       | 别人以它为准？       | 结果   |
| -------------------------------------- | --------------------------- | ---------------------------------- | -------------------- | ------ |
| `matter.json`                          | 是                          | 是                                 | 是                   | 真相源 |
| `CASE.md` 第 1 节                      | 否，可从 `matter.json` 重修 | 手改会被投影盖掉                   | 否                   | 投影   |
| `CASE.md` 叙事节（争点、进展、风险等） | 是                          | 是                                 | 是，案件索引用这些节 | 真相源 |
| `drafts/<id>.json`                     | 是                          | 通用写文件被拒；只经 `commitDraft` | 是                   | 真相源 |
| `audit/YYYY-MM-DD.jsonl`               | 是                          | 否                                 | 是                   | 真相源 |
| `lawmind/metrics/product-events.jsonl` | 是                          | 否                                 | 是，快照从它重算     | 真相源 |
| `artifacts/` 导出文件                  | 否，可从草稿再导出          | 文件页可改；`write_document` 拒写  | 否                   | 派生   |
| `search-index.sqlite`                  | 否                          | 否                                 | 否                   | 派生   |
| `decisions` 样本                       | 否，事件可重放              | —                                  | —                    | 派生   |
| `LAWYER_PROFILE.md`                    | 是                          | 是                                 | 是                   | 真相源 |
| `golden/*.json`                        | 是                          | 是                                 | 是                   | 真相源 |

## 1.14 Edition 与 build-channel 的区别

两个看起来都在「分版本」，词不能混用，改的入口也不能混用。

|            | Edition                               | build-channel                                                                        |
| ---------- | ------------------------------------- | ------------------------------------------------------------------------------------ |
| 变量       | `policy.edition` 或 `LAWMIND_EDITION` | `LAWMIND_BUILD_CHANNEL`（只在进程启动时读一次）                                      |
| 取值       | `solo` / `firm` / `private_deploy`    | `oss` / `commercial`。其它值，包括 Edition 的三个 id，一律当成 `oss`                 |
| 什么时候定 | 运行时。策略文件优先于环境变量        | 进程启动。之后再改环境变量不生效；`lawmind.policy.json` 里的 `buildChannel` 会被丢掉 |
| 影响什么   | 功能显隐（`edition-features.ts`）     | 商业平台代理能否打开。`oss` 进程里 `isPlatformAuthorityProxyEnabled` 恒为 false      |
| 谁能改     | 用户 / IT                             | 打包或商业 CI，在进程起来之前写入环境变量                                            |

把 `commercial` 或 `oss` 写进 Edition，不会变成商业构建，也不会打开私有化才有的合规导出。把 `firm` 写进 build-channel，不会打开平台代理。

一句话：**Edition 管「给谁用」，build-channel 管「这个进程是不是商业构建」。** 源码里两条路径都在；隔离靠启动盖章，不靠策略文件。

## 1.15 代码 ↔ 用词的三个陷阱与词表执法

§1.3 已经给了完整速查表；这里只讲**看代码时真正会踩的三个坑**，以及这套词表怎么被机械守住。律师用词的分场景细则（「合同审查」为什么保留、「语料」为什么有两种意思等）见第 32 章 §32.3。

| 陷阱                                | 说明                                                                                                                                                                                            |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`review` 一个前缀照两个律师词**   | `review`（审阅判断）是**审核**；改稿工作面用的是 `apply_surgical_edits` / `render_tracked_draft` / `drafts/`。`src/lawmind/review/` 是 CLI 审核门，不是改稿。别把 `review` 同时当两个词的代码列 |
| **`在办` 不是案件状态**             | `matter.status` 有 `active` 这一档，但它不叫「在办」——「在办」只指工作台/工作面那个入口。看到 `active` 别顺手翻译成「在办」                                                                     |
| **`必核清单` 的标识符是 camelCase** | 真实标识符是 `acceptanceChecklist`（`src/lawmind/agent/assistant-presets.ts`），不是界面上的「acceptance checklist」                                                                            |

三个坑在代码里各有一把锁，不靠读手册时记住：

- `matter.status = active` 的律师标签是「进行中」（`matterStatusLabel`）。测试锁住它不能写成「在办」。
- 必核清单的字段名是 `acceptanceChecklist`（`assistant-presets.ts`）。预设测试锁住不存在带空格的 `acceptance checklist` 键。
- `review` 前缀只服务审核。改稿落盘走 `update_draft` → `commitDraft`，不走 `write_document` 改 `drafts/`。

词表不是靠自觉：renderer 文案有两档机械执法（`pnpm lawmind:ui-copy-lint`，详见第 32 章 §32.5）。含中文的行即使提到 `/api/` 也照查，不能靠贴一条路由把禁词藏过去：

- **硬拦档**（`BANNED_PATTERNS`，共 **26 条**）：14 条工程师语言 + 12 条「存量已归零」的近义词（含文书台、复核），命中即失败。
- **棘轮档**：仍有存量的近义词（待办、审批、批准、修订）计数冻结在 `scripts/lawmind/ui-copy-lint-synonym-baseline.json`，**新增即失败，只许下降**。

维护规矩是**单向**：先改 `docs/LAWMIND-TERMINOLOGY.md`，再同步 `lawmind:ui-copy-lint` 的禁词清单与棘轮地板。

## 1.16 怎么读这个仓库的代码

如果你想深挖某一章讲的实现，按这个顺序进入最省时间：

1. **先看目录的 `index.ts` 或 README。** 有 README 的目录（`audit/`、`clause/`、`evaluation/`、`metrics/`、`platform/`）通常把口径写得很清楚。
2. **再找一个 `.test.ts` 看行为。** 测试标题往往比注释更能说明「这东西实际怎么用」。
3. **然后看实现文件的头部注释。** 这个仓库的头部注释经常包含「为什么这么设计」和「踩过的坑」。
4. **最后看函数签名。** 签名告诉你边界（必填/可选、返回什么），但不告诉你为什么。

四步里最有价值的是第二步和第三步：**测试告诉你行为，头部注释告诉你原因。**

还有一条：新的案件账本写入要走 `adapters/matter-storage` 的原子写、校验和文件锁。`matter-ops/storage.ts` 已经接上这套（第 7 章）；不要再新增裸 `writeFileSync`。

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

按第 1.2 节的五条铁律和 `VISION.md`，有几件事是明确不做的：

| 不做                         | 原因                                                     |
| ---------------------------- | -------------------------------------------------------- |
| 不做网页版工作台             | 产品就是本机桌面应用                                     |
| 不把「可审计」当卖点         | 记录过程不等于结论正确                                   |
| 不发明「安全分」             | 无法验证的分数是虚假代理指标                             |
| 不在没样本时报 0%            | 「没有数据」和「没有漏网」是两件事                       |
| 不自动外发                   | 外发永远要人点                                           |
| 不自动合并冲突文件           | 两份法律文件不许机器裁决                                 |
| 不编造法条/案号              | 查不到就标待核实                                         |
| 不静默写入记忆               | 未确认零写入                                             |
| 不锁死产品（许可到期只提醒） | 信任优先                                                 |
| 不下载运行外部技能包         | 只登记元数据与方法借鉴                                   |
| 不用判断类硬控冒充质量       | 默认模型持续变强；硬控只留安全、空交付、授权和不可逆操作 |

这十一条合起来，构成了一份比功能列表更能说明「这是什么产品」的说明。
