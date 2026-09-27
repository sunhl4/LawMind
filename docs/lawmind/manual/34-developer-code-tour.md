# 第 34 章 开发者代码导览

这一章是一条阅读路线：**从入口开始，按数据流走一遍，每站告诉你该看哪几个文件、看什么。**

## 34.1 三条阅读路线

按你的目的选一条：

| 目的                           | 路线                                           |
| ------------------------------ | ---------------------------------------------- |
| 想懂「一个回合怎么跑」         | 34.2 → 34.3 → 34.4（入口 → 编排器 → 模型循环） |
| 想懂「一份稿子怎么变成交付物」 | 34.5 → 34.6（草稿 → 渲染）                     |
| 想懂「界面怎么拿数据」         | 34.7 → 34.8（本地 API → 渲染层）               |

## 34.2 第一站：入口在哪

三个入口，分别对应三种用法：

| 入口                   | 文件                                                  | 什么时候用                                                            |
| ---------------------- | ----------------------------------------------------- | --------------------------------------------------------------------- |
| 引擎工厂（经典流水线） | `src/lawmind/engine/factory.ts`                       | CLI、评测、引擎级测试；桌面审核 / 导出 / 打回重审；Agent 工具内部复用 |
| Agent 工厂             | `src/lawmind/agent/agent-factory.ts`                  | 桌面对话回合的主路径                                                  |
| 本地服务               | `apps/lawmind-desktop/server/lawmind-local-server.ts` | 进程级入口                                                            |

**从这里开始读**：

1. `src/lawmind/index.ts` —— 引擎的公开导出面。看它导出了什么，就知道引擎对外承诺了什么。
2. `src/lawmind/engine/factory.ts` 的 `createLawMindEngine` —— 经典流水线是怎么拼起来的。
3. `src/lawmind/agent/agent-factory.ts` 的 `createLawMindAgent` —— 它每次 `chat()` 都会**新建一个 ToolRegistry**，然后调 `runTurn`。

**关键判断**：近两年的律师新功能几乎都挂在 Agent 那条路上。所以除非你在做评测或 CLI，从 `agent/` 进最快。

## 34.3 第二站：回合编排器

主文件：`src/lawmind/agent/turn-orchestrator.ts`。

**怎么读**（按函数出现的顺序）：

| 看什么                       | 有什么用                                             |
| ---------------------------- | ---------------------------------------------------- |
| `runTurn` 的参数             | 一个回合能带什么（权限模式、钉选、预批准、澄清答案） |
| 前面几十行的分步注释         | 第 3 章那 18 步的原文                                |
| 「算出本轮工具表」那一段     | 第 3.7 节那条 7 级收窄链                             |
| `emitEvent`                  | 事件是怎么发出去的（三条消费方）                     |
| 短路链那几行                 | 哪五种情况会提前结束回合                             |
| 调 `runModelToolLoop` 的地方 | 主循环的入口                                         |

**配套文件**（同一目录）：

| 文件                              | 管什么                     |
| --------------------------------- | -------------------------- |
| `turn-orchestrator-model-loop.ts` | 模型↔工具循环              |
| `turn-orchestrator-tool-round.ts` | 一批工具怎么执行           |
| `turn-orchestrator-finalize.ts`   | 收尾与清理                 |
| `turn-orchestrator-shortcuts.ts`  | 五种短路                   |
| `turn-orchestrator-prompt.ts`     | 提示上下文准备             |
| `turn-orchestrator-events.ts`     | 事件定义与几个文案构造函数 |
| `turn-step-context.ts`            | 回合上下文冻结与每步重建   |

**读的顺序建议**：先把 `turn-orchestrator.ts` 通读一遍（不求细节），再挑一个你关心的功能（比如压缩）去对应的配套文件看。

## 34.4 第三站：模型循环里的每轮前奏

`turn-orchestrator-model-loop.ts` 里那个 `while` 循环是核心。**每轮开始前有一串固定动作**，顺序很重要：

```text
中断检查
→ claim 中途钉选（并重算工具表、递增 world state 纪元）
→ 应用稿面补丁
→ 无任务回合时清空计划
→ 应用回合计划
→ claim 中途指示（steer）
→ 应用工作目标
→ 同步权限模式与案件
→ 中途压缩（除非在等审批/澄清）
→ 重建此步工具表 → 算 disclosure delta → 发事件
→ 模型采样
→ 执行工具批次
```

**为什么中途注入只在轮次开始 claim**：因为不能在已经发出的采样中间塞东西。所以侧车文件（`pending-steer.json`、`pending-context-pins.json`）是「排队」，claim 才是「生效」。

**调试建议**：如果你在查「为什么模型没看到我刚补的材料」，先确认那个 claim 有没有跑到——看有没有 `worldStateEpoch` 递增。

## 34.5 第四站：草稿这条线

从「模型说要改稿」到「文件里真的有改动」，中间经过五道（第 8 章的五个落槌边界）：

| 边界         | 文件                                                     | 读它看什么                         |
| ------------ | -------------------------------------------------------- | ---------------------------------- |
| B1 模型输入  | `drafts/apply-surgical-edits.ts`                         | 收到 find/replace 后怎么拆最短改动 |
| B2 hunk 生成 | `drafts/redline-proposal.ts` → `drafts/surgical-diff.ts` | 提案里 span 怎么算                 |
| B3 文件落盘  | `artifacts/render-docx-tracked.ts`                       | 怎么调 officecli、为什么从右到左   |
| B4 Word 插件 | `integrations/word-addin/review-requests.ts`             | 怎么把 hunk 转成插件锚点           |
| B5 成品复核  | `drafts/tracked-xml-qa.ts`                               | 怎么读实际 .docx 的 w:del/w:ins    |

**核心算法在** `drafts/minimal-edit-script.ts`：

- `computeMinimalEditSpans(before, after)` —— 反复摘最长公共片段
- `auditMinimalEditSpans(params)` —— 审计
- `MINIMAL_ANCHOR_CHARS = 4` / `MINIMAL_EDIT_MAX_UNCHANGED_RUN = 6` —— 两个门槛

**读它的测试**（`minimal-edit-script.test.ts`）：里面有一组 **200 组随机对照**，验证「回放=改后文本」且「审计无违规」。这是理解算法的捷径。

## 34.6 第五站：交付物这条线

要理解「一份稿子能不能出」，读这条链：

```text
deliverables/registry.ts              规格注册表（27 个 spec）
deliverables/validator.ts             验收检查（validateDraftAgainstSpec）
deliverables/reasoning-validator.ts   推理门
deliverables/verification-checklist.ts 必核清单
delivery/resolve-delivery-tier.ts     交付档位
delivery/auto-deliver.ts              自动交付判定
engine/rendering.ts                   真正落地渲染（门禁在这里拦）
```

**核心函数链**：

```text
validateDraftAgainstSpec(draft) → AcceptanceReport { ready, checks, blockerCount }
  ↓
isDraftReadyForRender(draft)
  ↓
engine/rendering.ts 里：
  strict = opts?.strictGates ?? isFeatureEnabled("acceptanceGateStrict")
  if (!acceptanceReport.ready || (reasoningReport.required && !reasoningReport.ready)) → 拒绝 + 审计 artifact.render_blocked
```

**想看门禁的全部种类**：搜 `gate-category.ts` 的 `SAFETY_HARD_GATES`。

## 34.7 第六站：本地 API 这条线

```text
lawmind-local-server.ts            进程入口、启动顺序、双协议族监听
  ↓
lawmind-server-dispatch.ts         六道关（CORS → Host → OPTIONS → 豁免 → 鉴权 → CSRF）
  ↓
lawmind-server-route-registry.ts   59 个 handler 的有序数组
  ↓
lawmind-server-route-*.ts          各领域路由
```

**读的顺序**：

1. `lawmind-server-dispatch.ts` 通读 —— 这是所有请求的必经之路。
2. `lawmind-local-api-auth.ts` —— 两道鉴权门 + 客户端范围。
3. `lawmind-server-route-registry.ts` —— 看 handler 顺序（顺序有意义）。
4. 挑一个你关心的路由读（比如 `-chat.ts` 看 SSE 流式）。

**配套**：

| 文件                                  | 管什么                   |
| ------------------------------------- | ------------------------ |
| `lawmind-server-helpers.ts`           | CORS、错误、模型配置构造 |
| `lawmind-server-jobs.ts`              | 后台任务的持久化与调度   |
| `lawmind-sse-bus.ts`                  | 事件总线                 |
| `lawmind-server-word-addin-runner.ts` | 插件取件 tick            |

## 34.8 第七站：渲染层这条线

```text
App.tsx                          入口
  ↓
app/LawmindAppRootView.tsx       骨架（侧栏 + 顶栏 + 主体）
  ↓
app/LawmindMainBodyContent.tsx   按当前视图分支
  ↓
律师能打开的五支：LawmindWorkspaceMainPane / LawmindLawyerWorkbench /
            AgentFleetView / ReviewView / LawmindArchiveOrganizePage
```

`MeetingView` 不在这棵树上。`mainView === "meeting"` 没有自己的分支，会落到对话主面板。`pickMeetingViewProps` 只被单测调用。

**数据怎么来**：

| 层          | 文件                                              | 说明                    |
| ----------- | ------------------------------------------------- | ----------------------- |
| HTTP 客户端 | `api-client.ts`、`api-client-proxy.ts`            | 统一请求                |
| 路由常量    | `lawmind-api-routes.ts`                           | 路径集中管理            |
| 查询        | `lawmind-query-hooks.ts`、`lawmind-query-keys.ts` | TanStack Query          |
| 事件        | `sse-client.ts`、`useSseSubscription.ts`          | SSE 订阅                |
| 局部状态    | `stores/*.ts`                                     | zustand（五个域 store） |
| 桥          | `lawmind-desktop-bridge.ts`                       | 访问 preload 暴露的 API |

**约定**（`stores/README.md`）：一个域一个文件、actions 跟 state 一起、临时态与持久态分开、组件用 selector 订阅。

**界面文案**：改文案前读第 32 章，改完跑 `pnpm lawmind:ui-copy-lint`。引擎里的用量桶、模型窗口、工具回包可以留在 `context-budget` 和会话路由里；律师面只在对话变长或已经整理过时说「这场对话」，不要把这些桶画到输入栏上。

## 34.9 按功能找文件的索引

| 我想找…            | 去哪个目录                                                            |
| ------------------ | --------------------------------------------------------------------- |
| 意图怎么判         | `src/lawmind/intent/`                                                 |
| 技能怎么注入       | `src/lawmind/skills/`                                                 |
| 工具怎么注册       | `src/lawmind/agent/tools/`                                            |
| 工具调用怎么被检查 | `src/lawmind/runtime/tool-pipeline.ts`                                |
| 上下文怎么算       | `src/lawmind/agent/context-budget.ts`                                 |
| 压缩怎么做         | `src/lawmind/agent/compact*.ts`、`mid-turn-compact.ts`                |
| 会话怎么存         | `src/lawmind/agent/session*.ts`                                       |
| 改稿算法           | `src/lawmind/drafts/`                                                 |
| 渲染 Word          | `src/lawmind/artifacts/`                                              |
| 交付物规格         | `src/lawmind/deliverables/`                                           |
| 独立审稿           | `src/lawmind/guardian/`                                               |
| 案件数据           | `src/lawmind/adapters/matter-storage/`                                |
| 案件逻辑           | `src/lawmind/cases/`、`src/lawmind/application/services/`             |
| 工作台             | `src/lawmind/desk/`                                                   |
| 记忆               | `src/lawmind/memory/`                                                 |
| 学习               | `src/lawmind/learning/`                                               |
| 立场库             | `src/lawmind/stance/`                                                 |
| 检索               | `src/lawmind/retrieval/`                                              |
| 研究               | `src/lawmind/research/`                                               |
| 索引               | `src/lawmind/indexing/`                                               |
| 邮件               | `src/lawmind/mail/`                                                   |
| 协作               | `src/lawmind/agent/collaboration/`、`src/lawmind/agent/orchestrator/` |
| 案件副本           | `src/lawmind/matter-replica/`                                         |
| 安全出口           | `src/lawmind/platform/`                                               |
| 审计               | `src/lawmind/audit/`                                                  |
| 版本与策略         | `src/lawmind/policy/`                                                 |
| 指标               | `src/lawmind/metrics/`                                                |
| 评测               | `src/lawmind/evaluation/`                                             |
| Electron 壳        | `apps/lawmind-desktop/electron/`                                      |
| 本地 API           | `apps/lawmind-desktop/server/`                                        |
| 界面               | `apps/lawmind-desktop/src/renderer/`                                  |
| CLI                | `scripts/lawmind/`                                                    |

## 34.10 阅读技巧

### 技巧一：先看测试

测试标题往往比注释更能说明「这东西实际怎么用」。比如：

```bash
# 看某模块的测试标题
rg "^describe|^\s+it\(" src/lawmind/memory/adoption-service.test.ts
```

### 技巧二：看头部注释

这个仓库的头部注释经常包含：

- 为什么这么设计
- 边界在哪
- 踩过什么坑（第 29 章那些案例大多来自这里）
- 「不要改成这样」的禁令

### 技巧三：搜报错文案

遇到一个报错时，直接在仓库里搜那句话——通常会把你带到**产生它的地方**，而且附近有解释。

### 技巧四：看导出面

每个目录的 `index.ts` 是它的公开面。想知道「这个模块对外提供什么」，看 `index.ts` 比读实现快。

### 技巧五：小心「绕过协议」的模块

工程研究笔记里列了几个已知问题，读代码时别把它们当范例：

| 模块                          | 问题                                                                     |
| ----------------------------- | ------------------------------------------------------------------------ |
| `matter-ops/storage.ts`       | 已接原子写、zod 和文件锁。坏的 `scope.json` 读出来像空的，保存会拒绝覆盖 |
| `metrics/lawyer-dashboard.ts` | 历史上存在失败计数重复计（同一批缺陷算两遍）                             |

### 技巧六：注意两份镜像

`runtime/protected-workspace-rels.ts` 与 `electron/fs-bridge.mjs` 是两份手抄常量，改一处必须改另一处。**有一道守卫**：`electron/fs-bridge.test.ts` 会逐项比对两侧的拒写文案、错误码与白名单——所以只改一边会红（见 29.22）。

## 34.11 两个常见误解

**误解一**：「`src/lawmind/index.ts` 是引擎的全部能力。」

**实际**：它只是公开导出面。很多能力（尤其桌面端新功能）挂在更深的模块里，不从这个 barrel 出。找功能要看目录树，不要只看 `index.ts`。

**误解二**：「`src/lawmind/integration/` 是集成层。」

**实际**：那个目录**只有测试**（跨模块验收套件）。集成连接器在 `integrations/`（有 s）。

## 34.12 已知坑（本章相关）

- **`agent/tool-name-sets.ts` 在 `agent/` 下，不在 `tools/` 下。**
- **`integration/`（单数）只有测试；`integrations/`（复数）才是连接器。**
- **`matter-ops/storage.ts` 已接写协议。** 新代码继续走原子写和锁，不要退回裸 `writeFileSync`。
- **两份清单要手工同步。** 改一处看另一处——`electron/fs-bridge.test.ts` 会替你抓漏改的一侧。
- **`index.ts` 不是全部能力。**
- **`engine/` 那条路和 `agent/` 那条路是并行的两套。** 改之前先确认你改的是产品在用的那条。
- **测试标题是最好的文档。** 先看测试再看实现。
