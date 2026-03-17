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
   - `workspace/audit/*.jsonl`
   - `workspace/cases/<matter-id>/CASE.md`
5. 若要继续当前技术实现，优先看最近新增的测试文件，测试即行为边界。

### 断点续做约定

- **项目记忆真相源**：本文件 + `GOALS.md`
- **运行状态真相源**：`workspace/tasks/*.json` + `workspace/audit/*.jsonl`
- **案件上下文真相源**：`workspace/cases/<matter-id>/CASE.md`
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
**状态**：进行中  
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
- [~] 人工审核交互（CLI 版已完成，待 UI 版）

---

## 3) 当前代码落地概览

### 已落地目录

- `src/lawmind/types.ts`
- `src/lawmind/router/index.ts`
- `src/lawmind/memory/index.ts`
- `src/lawmind/retrieval/index.ts`
- `src/lawmind/retrieval/model-adapters.ts`
- `src/lawmind/reasoning/index.ts`
- `src/lawmind/artifacts/render-docx.ts`
- `src/lawmind/audit/index.ts`
- `src/lawmind/index.ts`
- `src/lawmind/router/index.test.ts`
- `src/lawmind/reasoning/index.test.ts`
- `src/lawmind/index.test.ts`
- `src/lawmind/memory/index.test.ts`
- `src/lawmind/tasks/index.ts`

### 已落地记忆文件

- `workspace/MEMORY.md`
- `workspace/LAWYER_PROFILE.md`
- `workspace/tasks/*.json`
- `workspace/cases/<matter-id>/CASE.md`
- `workspace/templates/word/*.md`
- `workspace/templates/ppt/client-brief-default.md`

---

## 4) 决策记录（短）

1. **架构路线**：独立核心 + 适配层，不做普通插件寄生。
2. **记忆策略**：Markdown 为真相源，结构化索引为派生层。
3. **安全策略**：高风险任务默认需要人工确认。
4. **交付策略**：先 Word 后 PPT，先可控再自动化。

---

## 5) 风险与阻塞

### 风险

- 通用模型与法律模型输出冲突时的合并策略仍需明确定义。
- 模板体系尚未规范版本管理（模板升级可能影响历史产物一致性）。
- 审核流程目前是接口约束，尚无交互界面。
- 任务确认 UI 尚未正式化，当前以状态文件 + CLI/脚本流转为主。

### 阻塞

- 暂无硬阻塞。

---

## 6) 下一步（优先级）

1. 人工审核正式 UI（当前为 CLI + `engine.review()` + `workspace/tasks/*.json`）。
2. 模板版本管理（升级时保持历史产物一致）。
3. 任务确认正式入口（让 `task.confirmed` 不只存在于审计语义里）。
4. 案件级记忆写回机制（目前已能自动初始化与读取，尚未写回）。
5. 在 `GOALS.md` 保持与 M1 清单同步。

### 当前连续开发抓手

- 若继续做审核台：优先围绕 `ArtifactDraft`、`reviewDraftInCli()`、`engine.review()`。
- 若继续做案件工作台：优先围绕 `matterId`、`ensureCaseWorkspace()`、`CASE.md`。
- 若继续做状态面板：优先围绕 `workspace/tasks/*.json` 与 `readTaskRecord()`。

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
