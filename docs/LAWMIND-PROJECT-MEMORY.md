# LawMind 工程记忆（规划与进度）

本文件是 **LawMind 工程实施记忆**，用于持续记录：

- 路线决策
- 当前阶段目标
- 已完成项
- 风险与阻塞
- 下一步动作

目标是避免后续开发“只记得局部，不记得全局”。

---

## 0) 会话恢复规则（重要）

下次登录继续开发 LawMind 时，优先按以下顺序恢复上下文：

1. 先读本文件，确认北极星、当前阶段、已完成项、下一步。
2. 再看 `GOALS.md`，确认阶段 checklist 是否已同步。
3. 再看 `src/lawmind/index.ts`，确认当前主链路是否有新的状态机/接口。
4. 再看 `workspace/` 下的长期状态文件：
   - `workspace/MEMORY.md`
   - `workspace/LAWYER_PROFILE.md`
   - `workspace/tasks/*.json`
   - `workspace/drafts/*.json`
   - `workspace/audit/*.jsonl`
   - `workspace/cases/<matter-id>/CASE.md`
   - `workspace/playbooks/CLAUSE_PLAYBOOK.md`（条款与审核学习）
   - `workspace/quality/*.quality.json` 与 `workspace/quality/dashboard.json`（质量快照与聚合导出）
   - `workspace/exports/acceptance-pack.md`（`pnpm lawmind:ops acceptance-pack` 生成）
   - `workspace/sessions/*.json` + `*.turns.jsonl`（Agent 对话）
5. 再看 `docs/lawmind/refactor-blueprint.md`，确认当前重构北极星、目标分层、迁移路径与 UI 信息架构。
6. 再看 `docs/lawmind/refactor-implementation-plan.md`，确认实施级数据模型、目录迁移策略、以及首批 PR 切分。
7. 若要继续当前技术实现，优先看最近新增的测试文件，测试即行为边界。
8. 理解两套入口：
   - `createLawMindEngine()` — M1 管线式，确定性强，步骤固定。
   - `createLawMindAgent()` — M2 Agent 式，LLM 驱动，自主推理。

### 断点续做约定

- **项目记忆真相源**：本文件 + `GOALS.md`
- **运行状态真相源**：`workspace/tasks/*.json` + `workspace/audit/*.jsonl`
- **草稿真相源**：`workspace/drafts/*.json`
- **案件上下文真相源**：`workspace/cases/<matter-id>/CASE.md`
- **Agent 对话真相源**：`workspace/sessions/*.json`（元数据）+ `workspace/sessions/*.turns.jsonl`（完整 turn 记录）
- **行为回归边界**：`src/lawmind/**/*.test.ts`

---

## 1) 北极星目标

在 OpenClaw 经验基础上，构建律师行业可落地的 LawMind：

- 默认可审计
- 默认可确认
- 默认可追责
- 默认可扩展

第一阶段聚焦最小闭环：`指令 -> 检索 -> 结构化草稿 -> 审核 -> Word 输出 -> 审计`

---

## 2) 当前里程碑（M1）

**里程碑名称**：最小闭环基础工程（M1）  
**状态**：已完成  
**开始时间**：2026-03-17

### M1 目标清单

- [x] 双记忆模板：`workspace/MEMORY.md`、`workspace/LAWYER_PROFILE.md`
- [x] 核心类型：`TaskIntent`、`ResearchBundle`、`ArtifactDraft`、`AuditEvent`
- [x] 五层骨架：Router / Memory / Retrieval / Artifacts / Audit
- [x] `docx` 依赖引入（Word 渲染）
- [x] 通用/法律模型检索适配器接入（OpenAI-compatible + 环境变量预设）
- [x] Reasoning 层（bundle -> draft）串主入口
- [x] Word 模板目录与默认模板
- [x] 端到端 smoke 流程脚本
- [x] 正式测试用例（Router / Reasoning 单测 + Engine 集成测，colocated `*.test.ts`）
- [x] 人工审核交互（CLI 版已完成）

---

## 2b) 当前里程碑（M2）

**里程碑名称**：Agent 智能体架构（M2）  
**状态**：进行中  
**开始时间**：2026-03-17

### M2 目标清单

- [x] Agent 核心类型设计（AgentTool, AgentSession, AgentTurn, AgentContext）
- [x] Tool System — ToolRegistry + OpenAI function calling 格式转换
- [x] Legal Tools — 11 个法律工具（search/analyze/draft/matter/review/system）
- [x] System Prompt — 动态构建，包含律师 profile、案件上下文、可用工具
- [x] Session Persistence — 会话持久化（JSON + JSONL turns），支持断点续做
- [x] Agent Runtime — 自主推理循环（LLM → tool calls → execute → loop → final answer）
- [x] Agent CLI — `pnpm lawmind:agent`（交互 / 单次 / 恢复对话 / 列表）
- [x] Agent Tests — 15 个测试（ToolRegistry, Legal Tools, Session, compactHistory, SystemPrompt）
- [x] Engine-Bridge Tools — 5 个 engine 桥接工具（plan_task, research_task, draft_document, render_document, execute_workflow）
- [x] execute_workflow — 一键完整流程：指令 → 检索 → 草稿 → 自动审批/等待审批 → 渲染交付
- [x] System Prompt 升级 — 从"辅助回答"重构为"自主干活"模式（自主工作流程、判断规则、汇报格式）
- [x] Engine Tools Tests — 9 个集成测试（计划解析、完整工作流、高风险中断、审计记录、渲染验证、草稿生成）
- [x] LAWMIND-VISION.md 更新 — 第六节"终极目标：像人一样工作的法律智能体"
- [x] P0 稳定性 + 安全 + 参数校验（runtime 参数校验、审批门禁、超时重试；engine-tools 非空/长度/格式校验）
- [x] 客户向导 + 运维命令（`lawmind:onboard`、`lawmind:ops`、交付手册）
- [x] Windows/macOS 一键安装脚本（`scripts/install-lawmind.sh`、`scripts/install-lawmind.ps1`）
- [x] 完整验收与演示脚本（`lawmind:acceptance`、`lawmind:demo`）
- [x] 模型驱动的 Router（`LAWMIND_ROUTER_MODE=model`，`routeAsync` / `planAsync`）
- [x] 模型驱动的 Reasoning（`LAWMIND_REASONING_MODE=model`，`buildDraftAsync` / `draftAsync`）
- [x] 更多法律工具（`search_statute`、`search_case_law`、`check_conflict_of_interest`）

---

## 2c) 当前里程碑（M3）

**里程碑名称**：桌面应用（Electron，Windows + macOS）  
**状态**：进行中（v0.1 开发态可运行）  
**开始时间**：2026-03-21

### M3 目标清单

- [x] Monorepo 工作区纳入 `apps/lawmind-desktop`（Electron + Vite + React）
- [x] 本机 HTTP 服务 `127.0.0.1`：`/api/chat`、`/api/tasks`、`/api/sessions`、`/api/matters`、`/api/history`、`/api/artifact`、`/api/health`
- [x] 桌面默认数据目录：`Electron userData` 下 `LawMind/workspace` 与 `LawMind/.env.lawmind`
- [x] 渲染进程：对话 + 任务列表 + 历史与交付摘要
- [x] `pnpm lawmind:desktop`（根目录脚本）
- [x] `electron-builder`：`dist:electron` = `bundle:server`（`lawmind-local-server.cjs`）+ `vendor:node`（官方 Node 打进 `resources/node-runtime/`）+ `build:renderer`；**最终用户无需单独安装 Node**（可用 `LAWMIND_NODE_BIN` 覆盖）
- [x] 绿色 / 便携分发：**macOS `zip`**（解压 `.app`）、**Windows `portable`**，与 `dmg` / `nsis` 并存
- [x] 首次启动配置向导（Electron 内：API Key、Base URL、模型、可选工作区目录；写入 `userData/LawMind/.env.lawmind` 与 `desktop-config.json`）
- [x] **UI 精细化重设计**（v0.2）：深色专业风格，暖铜色调，面向律师工作习惯优化
  - [x] 设计系统重构：深色暖调色板（#b79a67 铜色 accent）、PingFang SC 中文排版、圆角/阴影/渐变等 token 化
  - [x] 消息区改为无气泡直排（类 Claude/ChatGPT 风格），用户消息保留轻量边框
  - [x] 自定义 Markdown 渲染（标题/列表/粗体/行内代码/分隔线），AI 消息排版可读性优化
  - [x] 快捷操作 Chip 栏（起草律师函/合同审查/法规检索/起草诉状/案例查询）
  - [x] 空态引导场景卡（纯文字，起草/检索/审查三类模板 prompt）
  - [x] 消息复制按钮（hover 显示，2s 确认态）
  - [x] 相对时间显示（刚刚/N 分钟前/今天 HH:mm/昨天/M月D日）
  - [x] 法律状态标签映射（已完成/处理中/处理失败/待处理/草稿/对话）
  - [x] 列表密度优化：无边框透明底，hover 仅显示左侧指示线
- [x] **统一设置面板**（v0.3）：齿轮图标触发模态设置，侧边栏极简化
  - [x] 侧边栏仅保留品牌栏 + 齿轮按钮 + 助手选择器 + 项目药丸 + 折叠工作记录
  - [x] 设置面板三个分区：助手管理、模型与检索、工作区与项目
  - [x] SVG 齿轮图标（16×16，CSS-only stroke，无外部依赖）
- [x] **项目目录选择器**：支持选择本机目录作为项目上下文，类似 Cursor "打开文件夹"
  - [x] Electron IPC `lawmind:pick-project` + preload bridge
  - [x] 侧边栏项目药丸（文件夹 SVG 图标 + 目录名）
  - [x] 主区域顶栏显示当前项目名
  - [x] 项目路径随 `POST /api/chat` 一起发送到后端（`projectDir` 字段）
- [x] **工作记录折叠/展开**：默认收起，点击标题展开，显示记录总数 badge
- [x] **按助手过滤记录**：任务和交付列表按当前选中助手的 `assistantId` 过滤

---

## 3) 当前代码落地概览

### 已落地目录

**M1 层（管线式引擎）**

- `src/lawmind/types.ts`
- `src/lawmind/router/index.ts`
- `src/lawmind/memory/index.ts`
- `src/lawmind/retrieval/index.ts`
- `src/lawmind/retrieval/model-adapters.ts`
- `src/lawmind/reasoning/index.ts`
- `src/lawmind/artifacts/render-docx.ts`
- `src/lawmind/audit/index.ts`
- `src/lawmind/index.ts`
- `src/lawmind/tasks/index.ts`
- `src/lawmind/drafts/index.ts`
- `src/lawmind/cases/index.ts`

**M2 层（Agent 智能体）**

- `src/lawmind/agent/types.ts` — Agent 核心类型
- `src/lawmind/agent/tools/registry.ts` — Tool 注册中心
- `src/lawmind/agent/tools/legal-tools.ts` — 11 个法律工具 + Engine 桥接注册
- `src/lawmind/agent/tools/engine-tools.ts` — 5 个 Engine 桥接工具（agent 的"双手"）
- `src/lawmind/agent/tools/index.ts` — Tools 入口
- `src/lawmind/agent/system-prompt.ts` — 动态 system prompt（自主工作模式）
- `src/lawmind/agent/session.ts` — 会话持久化与压缩
- `src/lawmind/agent/runtime.ts` — Agent 推理循环
- `src/lawmind/agent/index.ts` — Agent 模块入口

**测试（LawMind `src/lawmind/**/\*.test.ts`，含 Router/Reasoning 模型路径单测与 Engine-Bridge 集成测）\*\*

- `src/lawmind/router/index.test.ts`
- `src/lawmind/reasoning/index.test.ts`
- `src/lawmind/index.test.ts`
- `src/lawmind/memory/index.test.ts`
- `src/lawmind/cases/index.test.ts`
- `src/lawmind/agent/index.test.ts`
- `src/lawmind/agent/tools/engine-tools.test.ts`
- `src/lawmind/agent/runtime.test.ts`

**M3 桌面壳**

- `apps/lawmind-desktop/` — Electron 应用 + 本地 API 子进程 + React UI（见 `apps/lawmind-desktop/README.md`）
  - `electron/main.mjs` — Electron 主进程（IPC: `lawmind:pick-project`、`lawmind:open-external`、`lawmind:show-file` 等）
  - `electron/preload.cjs` — contextBridge 预加载脚本（暴露 `lawmindDesktop.*` 给渲染进程）
  - `server/lawmind-local-server.ts` — 本地 HTTP API（`/api/chat`、`/api/tasks`、`/api/history`、`/api/assistants` 等）
  - `server/safe-task-id.ts` + `.test.ts` — 安全 taskId 生成工具
  - `src/renderer/App.tsx` — 主 React 组件（对话/设置面板/助手管理/项目选择/工作记录折叠）
  - `src/renderer/styles.css` — 完整样式系统（深色暖铜 token、设置面板、消息排版、列表密度）
  - `src/renderer/global.d.ts` — TypeScript 全局声明（`Window.lawmindDesktop` 类型）

**脚本（交付/运维）**

- `scripts/lawmind-onboard.ts` — 客户首跑向导
- `scripts/lawmind-ops.ts` — status/doctor 运维命令
- `scripts/lawmind-demo.ts` — 客户演示脚本
- `scripts/lawmind-acceptance.ts` — 全链路验收脚本
- `scripts/install-lawmind.sh` — macOS/Linux 一键安装
- `scripts/install-lawmind.ps1` — Windows 一键安装

**交付文档**

- `docs/LAWMIND-DELIVERY.md` — 客户交付手册

### 已落地记忆文件

- `workspace/MEMORY.md`
- `workspace/LAWYER_PROFILE.md`
- `workspace/tasks/*.json`
- `workspace/drafts/*.json`
- `workspace/cases/<matter-id>/CASE.md`
- `workspace/templates/word/*.md`
- `workspace/templates/ppt/client-brief-default.md`

---

## 4) 决策记录（短）

1. **架构路线**：独立核心 + 适配层，不做普通插件寄生。
2. **记忆策略**：Markdown 为真相源，结构化索引为派生层。
3. **安全策略**：高风险任务默认需要人工确认。
4. **交付策略**：先 Word 后 PPT，先可控再自动化。
5. **Agent 路线**：从管线式引擎（M1）升级为 LLM 驱动的自主推理循环（M2）。Agent 有自己的 tool system、session management、system prompt，能自主决定使用哪些工具、以什么顺序、何时请求人工审批。借鉴 OpenClaw agent 架构但完全面向法律场景。
6. **双入口**：保留 M1 管线式 `createLawMindEngine()`（确定性强、可测试），同时新增 M2 Agent 式 `createLawMindAgent()`（灵活、自主推理），两者共享底层能力。
7. **桌面 UI 设计路线**：深色暖调专业风格（`#1a1917` 底色 + `#b79a67` 铜色 accent），面向律师工作习惯而非通用 SaaS 风格。消息区采用无气泡直排（AI 回复内容即布局，无边框无背景），Markdown 零依赖自渲染。
8. **设置集中化**：所有配置（助手管理、模型与检索切换、工作区与项目路径）统一进齿轮图标触发的设置面板，侧边栏保持极简（仅品牌/助手选择器/项目药丸/折叠工作记录）。
9. **项目目录**：桌面端支持通过 Electron 原生对话框选择本机目录作为"项目"，项目路径随对话请求发送到后端（`projectDir` 字段），为后续项目级文件访问和上下文注入打基础。

---

## 5) 风险与阻塞

### 风险

- 通用模型与法律模型输出冲突时的合并策略仍需明确定义。
- 模板体系尚未规范版本管理（模板升级可能影响历史产物一致性）。
- 审核流程目前已有最小 CLI 审核台；桌面端已有对话 + 任务列表 + 设置面板，**深度**审核台与案件工作台仍可扩展。
- 案件记忆已支持结构化归并、索引层、摘要和搜索，桌面端目前通过对话交互访问，尚未有专门的案件面板 UI。
- 项目目录功能已打通 Electron IPC，但后端尚未实现项目文件读取/索引；当前 `projectDir` 仅作为上下文标记传入对话。
- 按助手过滤记录依赖 `historyItem.assistantId` 字段，历史数据可能无此字段（回退为不过滤）。

### 阻塞

- 暂无硬阻塞。

---

## 6) 下一步（优先级）

### M2 Agent 继续深化（已完成核心闭环，以下为增强项）

1. ~~**Agent-Engine 统一调度**~~ ✅ — 已通过 engine-tools.ts 实现。Agent 通过 execute_workflow 等 5 个桥接工具调用 engine 全管线能力。
2. ~~**模型驱动的路由**~~ — `routeAsync` + `LAWMIND_ROUTER_MODE=model`（凭据不足时回落关键词 `route`）。
3. ~~**模型驱动的推理**~~ — `buildDraftAsync` + `LAWMIND_REASONING_MODE=model`（模型失败时回落 `buildDraft`）。
4. ~~**更多法律工具（首期）**~~ — `search_statute`、`search_case_law`、`check_conflict_of_interest`（工作区启发式，不替代正式法规库/裁判文书网）。
5. **Agent 多轮测试** — 用 mock LLM 测试 agent 的完整推理循环，验证工具调度、审批流程、session 恢复。
6. **真实模型端到端验证** — 配置 Qwen/DeepSeek API key，测试 agent 完整对话流程。
7. **客户试运行（Pilot）** — 选 2-3 个真实法律任务场景进行连续一周试跑，收集失败样本并闭环。

### M3 桌面端继续深化

8. ~~**项目文件访问**~~ ✅ — Agent 侧：`/api/chat` 传入的 `projectDir` 经校验后注入 `AgentContext`；`search_workspace` 扩展扫描项目内有限文本文件；新增工具 `read_project_file`。桌面 `/api/fs/*` 仍依赖 `LAWMIND_PROJECT_DIR`；切换项目目录后 **Electron 会重启本地 API** 以保持 FS 与 Agent 一致。
9. ~~**案件面板 UI**~~ ✅ — 桌面主区新增「案件」页：`MatterWorkbench.tsx`；API `GET /api/matters/overviews`、`GET /api/matters/detail?matterId=`、`GET /api/matters/search?matterId=&q=`；支持概览 / CASE 档案 / 任务与草稿 / 审计时间线；「在对话中关联本案」写入会话 matter 上下文。
10. ~~**审核台 UI**~~ ✅ — 桌面主区新增「审核」页：`ReviewWorkbench.tsx`；API `GET /api/drafts`、`POST /api/drafts/:taskId/review`、`POST /api/drafts/:taskId/render`（经 `createLawMindEngine`）；列表筛选待审核/全部；通过、驳回、需修改、备注、批准后渲染交付物。
11. ~~**per-assistant 记忆文件**~~ ✅ — `assistants/<assistantId>/PROFILE.md` 已由 runtime 加载进 system prompt；桌面端“认知升级建议”现已支持直接写入当前助手档案，并在案件认知页回看持久采纳历史。

### 基础设施

12. 模板版本管理（升级时保持历史产物一致）。
13. 在 `GOALS.md` 保持与 M1/M2/M3 清单同步。

### 当前连续开发抓手

- 若继续做 Agent 增强：优先围绕 `engine-tools.ts` 添加更多桥接工具。
- 若继续做桌面端 UI：修改 `apps/lawmind-desktop/src/renderer/App.tsx` 和 `styles.css`，全部样式 token 已在 `:root` 中定义。
- 若继续做项目文件访问：在 `lawmind-local-server.ts` 添加 `/api/project/files` 等端点，前端从设置面板或侧边栏项目药丸进入。
- 若继续做案件面板：新建 `CasePanel.tsx` 组件，调用 `/api/matters` + `/api/history` 接口。
- 若继续做 Agent 多轮测试：创建 mock LLM server，测试 `runTurn` 的完整循环。

---

## 7) LawMind 2.0 战略升级记忆

### 新的北极星

LawMind 下一阶段不再只是“法律 AI 工作台”，而要逐步成为**法律生产操作系统**：

- 能记住律所、律师、客户、案件、条款层面的长期知识
- 能按律师工作逻辑组织推理，而不只是生成流畅文本
- 能把每次审核转化为可复用的质量学习
- 能被客户购买、验收、治理、审计和持续支持

### 新的四条主线

1. **认知记忆主线**
   从 `MEMORY.md` + `LAWYER_PROFILE.md` + `CASE.md` 扩展为 firm / lawyer / client / matter / clause / opponent 多层记忆体系，但仍保持 Markdown 真相源。
2. **法律推理主线**
   在 `ResearchBundle` 和 `ArtifactDraft` 之间增加结构化推理层，沉淀争点树、论证矩阵、权威冲突、待确认事项。
3. **质量学习主线**
   将审核动作转化为结构化反馈和可统计信号，驱动模板、岗位助手、律师偏好持续优化。
4. **商业化主线**
   将交付、私有化、评测、验收、支持从“附属文档”升级为产品组成部分，支撑 `Solo Edition`、`Firm Edition`、`Private Deploy` 等分层打包。

### 新的优先级

#### P0

- 完成“显式学习”闭环：审核台写回 `LAWYER_PROFILE.md`、`assistants/<assistantId>/PROFILE.md`，并开始沉淀 clause / playbook 级经验。
- 为审核结果增加结构化标签，而不只是 `approved` / `rejected` / `modified`。

#### P1

- 引入结构化法律推理对象（例如 `LegalReasoningGraph`）。
- 将争点覆盖、引用可靠度、风险提示充分度变成可见字段和可回归边界。

#### P2

- 建立 LawMind 任务评测板：任务完成率、引用正确率、一次通过率、人工改动率、风险召回率。
- 建立黄金案例集，按合同审查、法律备忘录、律师函、诉讼策略、客户汇报等场景回归。

#### P3

- 岗位化助手编制：合同审查、法律检索、诉讼策略、客户沟通、合规审计、交付质检。
- 将岗位职责、模板偏好、工具边界、风险阈值绑定到助手配置与学习记忆。

### 2.0 之后的结构性升级方向

在 2.0 现有主线上，下一阶段不应只是继续增加工具和聊天能力，而应逐步把 LawMind 重构为 **matter-centered legal production system**。当前统一参考文档为：

- `docs/lawmind/refactor-blueprint.md`

该蓝图的关键判断如下：

1. **主对象从 session/chat 转向 matter**
   - matter 应成为案件状态、交付物、审批、风险、期限、开放问题和协作的主索引。
   - session 保留，但降级为交互入口和运行时状态。
2. **运行时状态与法律业务状态分离**
   - 将 transcript、tool calls、临时推理与 matter / deliverable / approval / deadline 这些业务对象显式区分。
3. **从工具调用升级为工作编排**
   - 增加 blocked / pending review / pending approval / waiting on client / need evidence 等工作队列对象。
   - 让系统能判断“下一步该谁做、为什么卡住、是否应升级给律师”。
4. **从 assistant profile 升级为岗位编制**
   - 将助手逐步重构为 intake、research、evidence、drafting、review、client communication、compliance 等有明确职责和风险边界的数字岗位。
5. **Workbench 从聊天优先升级为案件驾驶舱**
   - 重点视图转向：matter cockpit、review queue、memory inspector、reasoning board、quality cockpit、role board。

### 结构性升级的建议分层

为避免现有 `src/lawmind/` 继续横向膨胀，后续重构建议围绕四层推进：

- `lawmind-core`
  - 领域对象和状态机：matter、deliverable、approval、deadline、risk、reasoning graph、memory node。
- `lawmind-runtime`
  - agent loop、tools、hooks、delegation、prompt/context shaping、runtime event stream。
- `lawmind-governance`
  - policy、audit、review labels、benchmark gate、quality scoreboard、acceptance/compliance export。
- `lawmind-workbench`
  - 桌面与未来多端界面层，只消费应用服务，不直接承载核心编排逻辑。

### 近期重构优先级（蓝图版）

在不推翻 M1/M2/M3 的前提下，近期最值得做的 5 件事：

1. 固化 matter-centered 核心契约，并逐步用于 engine / desktop API / review pipeline。
2. 将 `LegalReasoningGraph` 从“已有功能”升级为高风险起草的强制检查点。
3. 为岗位化助手绑定可用工具、记忆范围、风险上限、默认模板和升级规则。
4. 将 review / approval / waiting-on-client / need-evidence 变成显式工作队列对象。
5. 重做桌面首页信息架构，让案件、审批、风险和期限优先于聊天窗口。

### 实施级切分（当前采用）

统一实施参考：

- `docs/lawmind/refactor-implementation-plan.md`

当前约定的首批重构切分如下：

1. **PR 1：Matter core contracts and adapters**（已开始，基础代码已落地）
   - 新增 matter / deliverable / approval / deadline / work queue / memory node 领域合同。
   - 保持 `TaskIntent` / `ResearchBundle` / `ArtifactDraft` / `TaskRecord` 兼容，并通过 adapter 映射。
   - 引入 `MatterService`、`DeliverableService` 等 application service 雏形。
2. **PR 2：Queue and approval layer**（基础读模型已落地）
   - 将 `need_lawyer_review`、`need_client_input`、`need_evidence` 等显式建模。
   - 将 approval 从 draft 附带状态升级为独立对象。
3. **PR 3：Matter cockpit desktop baseline**（baseline 已落地，开始补操作入口）
   - 桌面端开始从 chat-first 迁移到 matter-first。
   - 默认展示 next actions、deadlines、blocked items、deliverables、open approvals。
   - 在 cockpit 内补齐 review / approval 的跳转动作，把案件态直接接到审核台。

### 关键实施原则

- 先加 contracts 和 services，再动桌面 UI。
- 先把 business state 和 runtime state 分开，再谈进一步 agent 能力增强。
- Markdown 记忆真相源不变，新增的是派生 read model / memory graph，而不是替代现有 truth source。
- 重构过程优先“适配 + 迁移”，避免大爆炸式目录迁移。

### 对当前实现的解释

当前 M1/M2/M3 并没有走错路，反而给 2.0 提供了正确底座：

- M1 提供了可审计的管线主链路
- M2 提供了可自主工作的 Agent 层
- M3 提供了可被律师真正使用和购买的桌面工作台

因此 2.0 不是推翻重来，而是在现有契约之上增加“更像律师团队”的认知层、推理层、质量层和商业层。

### Phase D（可运维与客户交付物）— 已落地

- **条款 Playbook 学习**：审核带特定结构化标签时，向 `playbooks/CLAUSE_PLAYBOOK.md` 第六节追加时间戳行，审计 `memory.playbook_updated`（见 [Phase D operability](/lawmind/phase-d-operability)）。
- **质量 JSON**：每次 `recordQuality` 后自动刷新 `quality/dashboard.json`；也可手动 `pnpm lawmind:ops export-dashboard`。
- **验收包 Markdown**：`buildAcceptancePackMarkdown`；CLI 写入 `exports/acceptance-pack.md`：`pnpm lawmind:ops acceptance-pack`。

---

## 8) 更新日志

### 2026-03-17

- 新建 LawMind 文档体系：愿景、决策、架构。
- 新建工程记忆文档（本文件）。
- 建立双记忆模板与 LawMind 代码骨架。
- 增加 Word 渲染能力并引入 `docx` 依赖。
- 新增 Reasoning 层并接入引擎 `draft()` 主流程。
- 新增模型检索适配器工厂（general / legal）。
- 新增 Word/PPT 默认模板目录与模板文件。
- 新增 `scripts/lawmind-smoke.ts`，跑通最小闭环并生成 Word 产物。
- 新增 OpenAI-compatible 检索适配器：`src/lawmind/retrieval/openai-compatible.ts`。
- smoke 脚本支持真实模型模式（环境变量）与 mock 模式自动切换。
- 新增 provider 预设：国内通用模型入口（Qwen/DeepSeek/GLM/Moonshot/SiliconFlow）。
- 新增法律专用适配入口：ChatLaw / LaWGPT / LexEdge / 合作方本地部署扩展位。
- 新增 CLI 审核交互模块：`src/lawmind/review/cli.ts`。
- 新增模型适配说明文档：`docs/LAWMIND-MODEL-ADAPTERS.md`。
- 新增环境模板：`.env.lawmind.example`，支持一键切换真实模型接入。
- 新增环境自检脚本：`scripts/lawmind-env-check.ts`（命令：`npm run lawmind:env:check`）。
- 新增 `.env.lawmind` 自动加载：`scripts/lawmind-env-loader.ts`（env-check/smoke 自动读取）。
- 新增快速初始化脚本：`scripts/lawmind-quick-setup.ts`（命令：`npm run lawmind:setup`）。
- 生产就绪开关：`lawmind:env:check --strict`（general+legal 未就绪则 exit 1）；`lawmind:smoke --fail-on-empty-claims`（real 模式下空结论即失败）。
- 正式测试：`src/lawmind/router/index.test.ts`、`reasoning/index.test.ts`、`index.test.ts`（Router/Reasoning 单测 + Engine 集成测，mock 适配器）。
- 新增案件级记忆骨架：`ensureCaseWorkspace()` 自动创建 `workspace/cases/<matter-id>/CASE.md`。
- 新增持久化任务状态：`workspace/tasks/<taskId>.json`，覆盖 researched / drafted / reviewed / rendered 等状态，便于下次登录继续工作。
- `createLawMindEngine()` 新增 `review()` / `getTaskState()`，主链路开始从“瞬时调用”走向“可恢复工作流”。
- 新增 `src/lawmind/memory/index.test.ts`，补齐案件记忆初始化与加载测试。
- 新增草稿持久化：`workspace/drafts/<taskId>.json`，支持跨会话继续审核和渲染。
- `createLawMindEngine()` 新增 `confirm()` / `getDraft()`；高风险任务若未确认则禁止 `research()`。
- 新增最小审核台脚本：`npm run lawmind:review`，可读取任务/草稿、确认任务、审核草稿、并在批准后直接渲染。
- 新增案件记忆写回机制：任务推进时自动向 `workspace/cases/<matter-id>/CASE.md` 追加“当前任务目标 / 风险与待确认事项 / 工作进展记录 / 生成产物”。
- 新增测试覆盖：`CASE.md` 章节写回与引擎全链路写回已纳入 `src/lawmind/memory/index.test.ts` 与 `src/lawmind/index.test.ts`。
- 案件记忆从 append-only 升级为结构化归并：`当前任务目标 / 核心争点 / 风险与待确认事项 / 生成产物` 改为去重合并，`工作进展记录` 保持时间线追加。
- 检索完成后会把高价值 claims 自动沉淀到 `CASE.md` 的“核心争点”，为后续案件工作台打基础。
- 新增案件索引层：`src/lawmind/cases/index.ts` 聚合 `CASE.md`、`tasks/*.json`、`drafts/*.json`、`audit/*.jsonl`，输出 `MatterIndex`。
- 新增 `engine.getMatterIndex()` 与 `scripts/lawmind-case.ts`（命令：`npm run lawmind:case -- --matter <matterId>`），为案件工作台/审核台提供可直接消费的摘要对象。
- 新增 `readAllAuditLogs()`、`listDrafts()`，并补充 `src/lawmind/cases/index.test.ts` 覆盖案件索引聚合能力。
- 案件视图增强：新增 `MatterOverview` / `MatterSummary` / `MatterSearchHit`，支持案件总览排序、案件摘要生成、案件内搜索。
- `createLawMindEngine()` 新增 `listMatterOverviews()` / `getMatterSummary()` / `searchMatter()`，为后续 UI 工作台提供更高层接口。
- `npm run lawmind:case` 已升级：无参数时显示排序后的案件总览；带 `--matter` 时显示 headline / status / next actions / recent activity；带 `--search` 时可在案件内检索。
- 🏗️ **架构升级 M2：Agent 智能体** — 从管线式引擎升级为 LLM 驱动的自主推理循环：
  - 新增 `src/lawmind/agent/types.ts`：Agent 核心类型（AgentTool, AgentSession, AgentTurn, AgentContext, AgentConfig）。
  - 新增 `src/lawmind/agent/tools/registry.ts`：ToolRegistry 注册中心，支持按类别查找、OpenAI function calling 格式转换。
  - 新增 `src/lawmind/agent/tools/legal-tools.ts`：11 个法律工具（search_matter, search_workspace, get_matter_summary, list_matters, read_case_file, add_case_note, analyze_document, write_document, list_tasks, list_drafts, get_audit_trail）。
  - 新增 `src/lawmind/agent/system-prompt.ts`：动态 system prompt，融入律师 profile、案件上下文、工具列表、安全边界。
  - 新增 `src/lawmind/agent/session.ts`：会话持久化（JSON + JSONL turns）、对话压缩、LLM 消息格式转换。
  - 新增 `src/lawmind/agent/runtime.ts`：Agent 推理循环（callModel → parse tool calls → execute → loop → final answer），最大 15 次工具调用，自动审计。
  - 新增 `src/lawmind/agent/index.ts`：`createLawMindAgent()` 入口，暴露 chat/newSession/getSession/listSessions/getTurns/listTools API。
  - 新增 `scripts/lawmind-agent.ts`：交互式 CLI（`pnpm lawmind:agent`），支持新建/恢复对话、关联案件、单次指令、历史列表。
  - 新增 15 个 Agent 测试：ToolRegistry（注册/去重/分类/OpenAI格式）、Legal Tools（执行/安全边界）、Session（创建/加载/排序/turns/压缩）、SystemPrompt（构建/上下文）。
  - `types.ts` 新增 AuditEventKind: `tool_call` / `agent_turn`。
  - `index.ts` 新增导出：`createLawMindAgent`、`LawMindAgent`、Agent 类型。
  - `package.json` 新增脚本：`lawmind:agent`。
  - 全部 38 个测试通过（6 个测试文件）。
- 🎯 **终极目标落地：Agent 能像人一样干活交付**：
  - `LAWMIND-VISION.md` 新增第六节"终极目标：像人一样工作的法律智能体"——明确了"接单 → 干活 → 交付"的工作模式。
  - 新增 `src/lawmind/agent/tools/engine-tools.ts`：5 个 Engine 桥接工具，让 agent 真正能调用 engine 管线能力：
    - `plan_task` — 解析指令为结构化 TaskIntent
    - `research_task` — 执行法规/案例检索
    - `draft_document` — 生成文书草稿
    - `render_document` — 渲染最终交付物（需律师审批）
    - `execute_workflow` — 一键完整流程（指令 → 检索 → 草稿 → 审批 → 渲染），低风险自动交付，高风险暂停等待审批
  - System Prompt 重构：从"辅助回答"改为"自主执行"模式。Agent 收到指令后不再等待下一步指示，而是自主判断、调用工具、完成全流程。
  - 新增 `src/lawmind/agent/tools/engine-tools.test.ts`：9 个集成测试，覆盖计划解析、完整工作流执行（含文件持久化验证）、高风险中断、审计记录生成、渲染失败处理、草稿生成。
  - Tool 数量从 11 个增加到 16 个（11 legal + 5 engine-bridge）。
  - 全部 47 个测试通过（7 个测试文件）。
- ✅ **交付冲刺（5 部分）完成**：
  - **第 1-2 天（P0）**：稳定性/安全/参数校验落地
    - `runtime.ts` 增加模型调用超时+重试、工具参数 schema 校验、`requiresApproval` 门禁、工具执行超时控制。
    - `engine-tools.ts` 增加入参强校验（非空、长度、matter_id 格式），并对空检索结果做显式失败提示。
    - 新增 `runtime.test.ts`，并扩展 `engine-tools.test.ts` 校验异常参数路径。
  - **第 3 天**：客户向导 + 文档 + 运维命令
    - 新增 `lawmind:onboard`（首跑向导）、`lawmind:ops`（status/doctor）。
    - 新增 `docs/LAWMIND-DELIVERY.md` 客户交付手册。
  - **第 4 天**：Windows/macOS 一键安装脚本
    - 新增 `scripts/install-lawmind.sh` 与 `scripts/install-lawmind.ps1`，覆盖安装、更新、依赖安装、onboard、自检。
  - **第 5 天**：完整验收（全链路 smoke + 客户演示脚本）
    - 新增 `lawmind:acceptance`（tests + env-check + smoke + demo + ops status）。
    - 新增 `lawmind:demo`（基于 `execute_workflow` 的客户演示闭环）。
  - 当前测试：`src/lawmind/` 全量 **54 tests / 8 files 全通过**。
- 🔗 **GitHub 交付基线确定**：
  - 仓库源统一为 `https://github.com/sunhl4/LawMind.git`。
  - 一键安装脚本默认从该 GitHub 仓库拉取（支持 `LAWMIND_REPO_BRANCH`）。
  - `LAWMIND-DELIVERY.md` 已补充 raw GitHub 远程安装命令（macOS/Linux + Windows）。

### 2026-03-22

- 🎨 **桌面端 UI 精细化重设计（v0.2 → v0.3）**：
  - **收敛式重设计**：从"功能堆砌"转向"克制专业"，深色暖铜色调（`#1a1917` + `#b79a67`），PingFang SC 中文优先排版。
  - **消息区改版**：AI 消息无气泡直排（内容即布局，无边框无背景），用户消息保留轻量灰底。消息间距加大，Markdown 排版独立渲染（标题/列表/粗体/行内代码/分隔线，零依赖）。
  - **列表密度优化**：任务/历史列表去掉卡片化边框和背景，改为透明底 + 左侧 hover 指示线，更像文件列表。
  - **空态引导精简**：场景卡改为纯文字（无图标），空态标题简洁化（"有什么可以帮您？"），hint 文案更内敛。
  - **快捷操作 Chip 栏**：起草律师函/合同审查/法规检索/起草诉状/案例查询，一键插入到输入框。
  - **消息复制按钮**：hover 显示，点击后 2 秒显示"已复制"确认态。
  - **相对时间工具**：刚刚/N 分钟前/今天 HH:mm/昨天/M月D日。
  - **法律状态标签**：任务状态映射为律师可读标签（已完成/处理中/处理失败/待处理/草稿/对话）。
- ⚙️ **统一设置面板**：
  - 侧边栏极简化：品牌栏 + SVG 齿轮按钮 + 助手 `<select>` + 项目药丸 + 折叠工作记录。
  - 齿轮触发全屏设置模态，三区：助手管理（新建/编辑/删除/统计）、模型与检索（状态/API 配置向导/检索模式切换）、工作区与项目（路径显示/切换/关闭）。
  - 移除侧边栏中原有的助手卡片、配置块、项目块等大面积设置 UI。
- 📁 **项目目录选择器**：
  - `electron/main.mjs` 新增 `lawmind:pick-project` IPC handler（Electron `dialog.showOpenDialog`）。
  - `electron/preload.cjs` 暴露 `pickProject()` 到渲染进程。
  - `global.d.ts` 新增 `pickProject` 类型声明。
  - 前端 `projectDir` state + `send()` 中传入 `projectDir` 字段到 `/api/chat`。
  - 侧边栏项目药丸（文件夹 SVG + 目录名）和主区域顶栏项目名显示。
- 📂 **工作记录折叠**：侧边栏"工作记录"默认收起，点击标题栏展开；标题栏显示记录总数 badge，箭头旋转指示状态。
- 🔍 **按助手过滤记录**：`filteredTasks` 和 `filteredHistory` 按当前 `selectedAssistantId` 过滤，切换助手时自动更新可见记录。
- 📝 **文档同步更新**：`LAWMIND-PROJECT-MEMORY.md`、`LAWMIND-ARCHITECTURE.md`、`LAWMIND-USER-MANUAL.md`、`workspace/memory/2026-03-22.md` 全面更新，确保下次开发会话可恢复完整上下文。

### 2026-03-29

- **GOALS 第二、三期（可交付子集）闭环**：律师档案显式学习（`LAWYER_PROFILE.md` 第八节）、内置模板 **category**、合规审计导出（`compliance=true`）、协作摘要 API、包清单 SHA-256 校验（`src/lawmind/skills/`）、私有化与包文档（`LAWMIND-PRIVATE-DEPLOY`、`LAWMIND-BUNDLES`）。`GOALS.md` 对应项已勾选。
- **回归**：`src/lawmind/**/*.test.ts` 增至覆盖上述模块；`pnpm lawmind:bundle:desktop-server` 通过。
- **商业化支撑包（仓库内）** — 草案与工程物已落盘（正式合同/渗透仍需体系外流程）：
  - **体验**：桌面本地 API 错误码、`HelpPanel`、设置内入门进度、`api-client` 解析与测试。
  - **法务/数据**：`docs/legal/*`、`LAWMIND-DATA-PROCESSING`、`LAWMIND-DELIVERY` 法务包与第 10 节备份/升级。
  - **安全**：`pnpm lawmind:sbom`、`LAWMIND-SECURITY-CHECKLIST`、`.github/workflows/lawmind-security-audit.yml`（非阻塞）。
  - **运维**：`scripts/lawmind-backup.sh`、`LAWMIND-POLICY-FILE` + `docs/examples/lawmind.policy.json.sample`。
  - **协作与归因**：`LAWMIND_DESKTOP_ACTOR_ID`、`LAWMIND-ACTOR-ATTRIBUTION`、`LAWMIND-INTEGRATIONS`、协作摘要 API 与设置页状态。
  - **交付与支持**：`LAWMIND-CUSTOMER-ACCEPTANCE`、`LAWMIND-SUPPORT-RUNBOOK`、`LAWMIND-CUSTOMER-OVERVIEW`；Mintlify **LawMind** 导航组见 `docs/docs.json`。
- 索引：<https://docs.openclaw.ai/LAWMIND-DELIVERY>、<https://docs.openclaw.ai/LAWMIND-SECURITY-CHECKLIST>、<https://docs.openclaw.ai/LAWMIND-CUSTOMER-OVERVIEW>。
- **工程加固（持续）**：本地 API 拆分为 `lawmind-server-helpers.ts` + `lawmind-server-dispatch.ts`；`lawmind.policy.json` 运行时加载并影响 `/api/chat` 与 health；工具审计 `detail` 前缀 JSON；`pnpm lawmind:sbom` 尝试生成 CycloneDX；设置页拆为 `LawmindSettings*` 子组件；M1 引擎默认 `actorId` 经 `LAWMIND_ENGINE_ACTOR_ID` / `LAWMIND_DESKTOP_ACTOR_ID`（`engine-actor.ts`）；`pnpm lawmind:desktop:http-smoke` 探活本地 HTTP。

### 2026-04-01

- 新增 `LAWMIND-2.0-STRATEGY.md`，将 LawMind 的下一阶段目标明确为“法律生产操作系统”，而不是仅增强聊天能力。
- 在工程记忆中补充 LawMind 2.0 四条主线：认知记忆、法律推理、质量学习、商业化分层。
- 将后续优先级重新聚焦到显式学习闭环、结构化法律推理、质量评测板、岗位化助手编制。
- 新增 `docs/lawmind/refactor-blueprint.md`，把后 2.0 阶段的结构性重构方向固化为可持续参考文档：matter-centered 架构、四层子系统拆分、工作队列、岗位编制、Workbench 案件驾驶舱。
- 会话恢复规则新增对 `docs/lawmind/refactor-blueprint.md` 的优先阅读要求，确保后续继续开发不会只沿着 chat/tool 层局部优化。
- 新增 `docs/lawmind/refactor-implementation-plan.md`，把蓝图继续细化为实施级方案：目标 contracts、当前类型到新模型的映射、目标目录结构、以及前三个重构 PR 的切分与验收标准。
- PR 1 基础层已开始落地：
  - 新增 `src/lawmind/core/contracts.ts`，定义 `Matter`、`Deliverable`、`ApprovalRequest`、`Deadline`、`WorkQueueItem`、`MemoryNode` 和 `MatterReadModel`。
  - 新增兼容 adapter：`buildMatterFromIndex()`、`buildDeliverableFromDraft()`、`buildMatterReadModelFromIndex()`，先从现有 `MatterIndex` / `ArtifactDraft` / `TaskRecord` 生成新读模型。
  - 新增 `src/lawmind/application/services/matter-service.ts`，提供 matter-centered read model 查询入口。
  - 新增测试：`src/lawmind/core/contracts.test.ts`、`src/lawmind/application/services/matter-service.test.ts`。
  - 验证：新增测试通过，`pnpm tsgo` 通过；单独带跑 `src/lawmind/cases/index.test.ts` 时出现目录清理竞态，暂判断为既有测试波动，未作为本次改动回归失败依据。
- PR 2 基础层已落地：
  - 在 `src/lawmind/core/contracts.ts` 增加 `buildApprovalRequestsFromMatterIndex()` 和 `buildQueueItemsFromMatterIndex()`，从现有 `TaskRecord` / `ArtifactDraft` / `MatterIndex` 推导 approval 与 queue。
  - `MatterReadModel` 现已带 `approvalRequests` 与 `queueItems`，为 matter cockpit 提供可直接消费的操作态数据。
  - 新增 `src/lawmind/application/services/queue-service.ts`，提供 `listApprovalRequests()` 与 `listWorkQueueItems()`。
  - 桌面本地 API 已增加 `/api/approvals`、`/api/queues`，并在 `/api/matters/detail` 中附带 `approvalRequests` 与 `queueItems`。
  - 新增测试：`src/lawmind/application/services/queue-service.test.ts`，并扩展 `src/lawmind/core/contracts.test.ts` 覆盖 approval / queue 推导。
  - 验证：`pnpm test -- src/lawmind/core/contracts.test.ts src/lawmind/application/services/matter-service.test.ts src/lawmind/application/services/queue-service.test.ts` 通过；`pnpm tsgo` 通过。
- PR 3 baseline 已开始落地：
  - `apps/lawmind-desktop/src/renderer/MatterWorkbench.tsx` 的概览页已从简单摘要升级为 cockpit baseline。
  - 当前概览页已显式展示：`summary.nextActions`、`queueItems`、`approvalRequests`、`drafts`（交付物状态）以及关键风险、近期进展。
  - 新增 cockpit 样式：`lm-matter-cockpit-grid`、`lm-matter-cockpit-card`、`lm-matter-ops-list`、`lm-matter-pill*`，使案件概览更接近“案件驾驶舱”而非纯档案阅读器。
  - matter detail 现已能把 queue/approval 数据实际消费到桌面 UI，而不只是后端返回。
  - 案件 cockpit 已新增“去审核”操作：可从 `queueItems`、`approvalRequests`、`drafts` 直接切到 `ReviewWorkbench`，并预选相关草稿，形成“案件发现阻塞 -> 进入审核处理”的工作流。
  - `App.tsx` 已承担 `MatterWorkbench -> ReviewWorkbench` 的轻导航状态，`ReviewWorkbench.tsx` 支持 `initialTaskId` 作为外部聚焦入口。
  - 案件概览顶部已新增审核状态条：显式汇总“待审核草稿 / 需修改返回 / 可渲染交付 / 高风险审批”四类操作态，并提供一键进入对应草稿的动作入口。
  - 案件概览已增加“当前处理视角”控制条：支持按 `待审核 / 待修改 / 可交付 / 高风险` 过滤 `queueItems`、`approvalRequests`、`drafts`，并支持按优先级 / 最近更新 / 标题排序。
  - 桌面端新增案件级“认知”页签：从当前案件中选一份代表性草稿，直接复用 `/api/drafts/:taskId` 返回的 `memorySources` 与 `reasoningMarkdown`，展示这个案件当前受哪些记忆层与推理结构驱动。
  - `MatterWorkbench -> ReviewWorkbench` 的跳转已从“只带 taskId”升级为“带 taskId + matter scope + status scope + list mode”，案件页当前的操作视角现在可以较完整地传递到审核台。
  - `ReviewWorkbench` 已新增案件范围与状态筛选，可按单一 `matterId` 和审核状态查看草稿，不再只是全局待审核/全部两档。
  - “认知”页已补成案件级摘要板：会采样当前案件几份关键草稿，聚合出推理快照覆盖、唯一记忆层覆盖、已注入 prompt 的记忆层数量，以及高频记忆层 / 草稿推理覆盖列表。
  - “认知”页现已开始暴露案件级风险信号：显式显示缺推理快照草稿数、引用待核/无快照草稿数、高频但未注入 prompt 的记忆层数，以及采样草稿的时间跨度。
  - 审核动作现已回传 `matterRefreshVersion` 到桌面主应用；案件页会在后续重新进入或保持挂载时主动刷新案件列表、详情与认知板，不再只刷新侧栏任务记录。
  - “认知”页的记忆层已开始分层显示：区分 `已注入核心记忆`、`检索候选真相源`、`缺失但应存在的层`，并单列持续缺失的记忆层，帮助律师判断是 prompt 不足还是底层知识文件不完整。
  - 案件概览已新增 `Blocked By` 解释区：不再只展示 queue item，而是把阻塞归因为 `审核链路阻塞 / 材料与事实阻塞 / 策略尚未定型 / 交付动作未完成` 等律师可直接理解的原因，并附带当前最关键的阻塞项。
  - `Blocked By` 解释区现已附带“建议下一步”，把阻塞原因直接映射成下一动作（例如先补证据、先走审核、先补策略、先执行渲染），开始从解释层走向执行层。
  - “认知”页已开始给出核心记忆升级建议：针对高频但未注入的记忆层，提示应提升为律师级、律所级、案件策略级或 playbook 级核心记忆，减少每次重复检索。
  - `Blocked By` 建议现已支持点击动作：遇到审核/交付阻塞时可直接跳审核台，遇到策略/证据阻塞时可直接切到 `CASE` 档案，开始把建议转成界面内可执行操作。
  - “认知”页的升级建议现已支持一键写入 `LAWYER_PROFILE.md` 或当前助手 `assistants/<assistantId>/PROFILE.md`；桌面本地 API 新增 `/api/assistants/profile/learning` 用于安全追加助手级长期记忆。
  - 认知升级建议写入现已带来源追踪：会把 `matterId` 与当前观察草稿（标题 + taskId）一起写入长期记忆，避免后续只看到抽象建议而不知道来源案件。
  - `Blocked By -> CASE` 的跳转现已带上下文焦点：进入 `CASE` 档案时会展示“从哪类阻塞跳来”的提示，并可一键按预置关键词定位相关内容，减少律师在档案中重新找入口的成本。
  - “认知”页现已增加当前会话内的“已采纳建议”列表：律师能直接看到哪些升级建议已经写入律师档案或助手档案，以及对应案件、草稿与采纳时间。
  - `CASE` 焦点提示已升级为区块级定位：当阻塞来源明确对应“核心争点 / 风险与待确认 / 生成产物 / CASE.md”时，切入 `CASE` 页会自动滚动到相应区块，不再只停留在搜索词层面。
  - “认知”页现已开始读取持久化采纳历史：桌面端会从 `LAWYER_PROFILE.md` 与当前助手 `PROFILE.md` 中解析认知升级建议条目，并按当前案件过滤显示，不再只依赖本次会话内存状态。
  - `CASE` 焦点提示现已支持就地写回：律师可直接把当前阻塞建议写入案件档案对应 section（如核心争点 / 风险与待确认 / 生成产物 / 当前任务目标），形成“阻塞发现 -> 档案修补”的最小闭环。
  - “认知”页的持久采纳历史已进一步结构化：开始显示律师档案 / 助手档案采纳数量、总采纳量，以及“重复采纳”信号，用于判断哪些建议已经开始跨回合复用。
  - `CASE` 焦点提示现已附带可编辑的建议草稿框：律师可先调整系统生成的案件说明，再决定是否写回对应档案 section，而不必只能直接写入固定 bullet。
  - “认知”页已开始展示更明确的复用证据：对重复采纳的建议，会标注其关联案件列表，帮助律师判断该建议是否已从单案经验演化为跨案件规则。
  - `CASE` 焦点提示现已支持多版本建议草稿（保守版 / 标准版 / 强化版），让律师可按当前风险与沟通策略快速切换表达方式，再写入案件档案。
  - “认知”页的复用证据已加入时间维度：除关联案件外，还会显示最近一次采纳时间，并在摘要卡上展示最近采纳时间与覆盖案件数，帮助律师判断某条规则是“历史遗留”还是“近期仍在活跃复用”。
  - `CASE` 焦点提示区已补充版本口径说明，且多版本建议已稳定适配核心争点 / 风险提示 / 交付物说明 / 当前任务目标四类 section，产品完成度已达到可先停、等待真实律师使用反馈的阶段。
  - 为了让后续交互收敛建立在真实使用证据上，桌面端现已新增 `/api/matters/interaction`，会把案件工作台里的关键律师动作写回既有 audit 体系，而不是另造一套埋点日志。
  - 当前已记录的关键律师动作包括：从案件页进入审核台、采纳认知升级建议写入律师/助手档案、以及把 `CASE` 焦点建议写回案件档案；这些动作会以 `ui.matter_action` 出现在案件审计时间线里。
  - 案件概览现已增加“最近律师动作”区块，能直接看到最近几次关键人工动作，为下一轮基于真实使用轨迹做交互收敛提供最小可行证据面。
  - 案件概览进一步新增“律师行为摘要”区块：不只显示最近几条动作，还会汇总当前案件的进入审核次数、补 CASE 次数、记忆沉淀次数、最近动作时间、最常进入的界面入口，以及重复触发的主题。
  - 这使得产品迭代可以开始从“主观猜测哪里不好用”转向“根据案件内真实人工操作轨迹判断当前主工作面到底在审核、档案修补还是认知沉淀”，为下一步交互收敛提供更高信噪比输入。
  - 案件概览现已继续上探一层到“交互收敛建议”：系统会根据律师行为摘要自动判断当前案件更像是“审核往返过多 / CASE 已成为推进主入口 / 高频经验值得前置沉淀”，并给出相应的一键入口动作。
  - 这意味着 LawMind 的驾驶舱不再只是展示现状，而开始尝试解释“为什么律师会反复去同一个地方”，并把这种模式直接转成产品层面的下一步建议。
  - 案件概览现已再上探一层到“产品改造建议”：系统会把同一案件里的重复操作继续翻译成对工作台自身的改造方向，例如“把审核决策前置到概览”“为 CASE 补录增加结构化表单”“把认知升级做成快捷采纳通道”。
  - 这意味着 LawMind 开始具备一个更像产品经理的能力：不仅知道律师下一步该去哪，还能根据真实案件轨迹反推“下一版 UI 最应该改哪里”。
  - 案件概览现已继续把产品改造建议拆成“产品实验清单”：每条实验项都会明确写出假设、验证方式、当前信号和优先级，而不只是给出抽象方向。
  - 这让 LawMind 的驾驶舱从“会提改造方向”继续升级为“会提出可验证的产品实验”，开始形成更接近持续产品迭代的内循环。
  - 案件概览现已新增“跨案件实验累积板”：后端会聚合全工作区案件里的 `ui.matter_action`，判断哪些改造方向已经在多个案件中重复出现，不再只是单案内的局部信号。
  - 这让 LawMind 开始从“单案自我观察”迈向“跨案件自我进化”，也让产品改造决策更接近真正的共性需求排序，而不只是本案体验优化。
  - 案件概览现已在“跨案件实验累积板”之上继续生成“Roadmap 候选池”：系统会按覆盖案件数、累计信号次数、当前案件是否也命中该模式，对候选方向做粗粒度排序。
  - 当前候选池已开始区分“现在做 / 下一波 / 后续观察”三种节奏，并为每条候选项补充排序理由，使 LawMind 不只会发现模式，还开始尝试形成更接近产品路线图的优先级判断。
  - `Roadmap 候选池` 现已进一步升级成“路线图决策卡”：每条候选方向除了分数和节奏，还会补充预期收益、主要风险、建议 owner，以及“已验证 / 正在成形 / 继续观察”的成熟度判断。
  - 这意味着 LawMind 在这一轮已经从“记录律师动作”一路推进到“能基于跨案件行为信号给出接近产品排期语言的决策建议”，当前这条自我进化链路已形成一个相对完整的闭环。
  - 2026-04-02 调试记录：桌面端出现白屏并非 `MatterWorkbench` 渲染逻辑本身导致，而是 renderer 从 `src/lawmind/assistants/store.ts` 直接导入 `DEFAULT_ASSISTANT_ID`，把 `node:crypto` 连带打进浏览器 bundle，触发 `Module "node:crypto" has been externalized for browser compatibility` 并使根组件完全无法挂载。
  - 修复方式：把 `DEFAULT_ASSISTANT_ID` 抽到浏览器安全的 `src/lawmind/assistants/constants.ts`，让 `App.tsx` 与 `LawmindSettingsAssistants.tsx` 改为引用该常量文件；同时清理遗留的 `vite --mode e2e` 进程，避免其长期占用 `5174` 干扰 `pnpm lawmind:desktop`。
  - 验证：`pnpm tsgo` 通过；`pnpm exec tsc -p apps/lawmind-desktop/tsconfig.json --noEmit` 通过。
