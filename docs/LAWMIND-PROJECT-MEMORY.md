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
   - `workspace/sessions/*.json` + `*.turns.jsonl`（Agent 对话）
5. 若要继续当前技术实现，优先看最近新增的测试文件，测试即行为边界。
6. 理解两套入口：
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
11. ~~**per-assistant 记忆文件**~~ ✅（基础）— `assistants/<assistantId>/PROFILE.md` 由 runtime 加载进 system prompt；`appendAssistantProfileMarkdown()` 可供后续「显式采纳」；**待**：桌面 UI 写入入口与审核联动。

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

## 7) 更新日志

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
