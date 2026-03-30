# OpenClaw 目标文件（文档即记忆）

本文档是**目标与记忆**的单一入口：把项目方向与「我们想做的事」写在这里，便于对齐和回溯。  
与 [`VISION.md`](VISION.md) 的关系：VISION 描述项目愿景与原则；本文件在此基础上整理为**可执行的目标清单**并保留**我们的待办**。

---

## 一、项目总体目标

- **产品定位**：真正能替你干活的个人 AI 助手（the AI that actually does things）。
- **运行方式**：跑在你自己的设备与频道里，遵守你的规则。
- **核心诉求**：易用、多平台、隐私与安全优先。

---

## 二、当前优先目标（来自 VISION）

1. **安全与默认策略**：强默认、风险路径显式且由操作者控制。
2. **修 bug 与稳定性**：减少崩溃与异常，提升日常可用性。
3. **安装与首跑体验**：提升 setup 可靠性、首次运行与 onboarding 体验。

---

## 三、下一阶段目标

- 支持主流模型提供商，并保持能力与 fallback 清晰。
- 加强主要消息渠道支持，并酌情增加高需求渠道。
- 性能与测试基础设施（CI、覆盖率、回归）。
- 更好的「电脑使用」与 agent harness 能力。
- CLI 与 Web 前端的易用性（ergonomics）。
- 各平台伴侣应用：macOS、iOS、Android、Windows、Linux。

---

## 四、我们的目标 / 我想做的事（LawMind 法律智能助手）

> 方向：在 OpenClaw 经验基础上打造律师行业专用智能体 **LawMind**，用**反脆弱设计**把 OpenClaw 的痛点转化为产品护城河。核心文档见 **[LawMind 愿景](docs/LAWMIND-VISION.md)**、**[LawMind 决策文档](docs/LAWMIND-DECISION.md)**、**[LawMind 架构文档](docs/LAWMIND-ARCHITECTURE.md)**。

**产品定位**：律师的「数字孪生助理团队」——可审计、可追溯、责任边界清晰，越用越懂律师。

### 第一期（当前阶段）— 最小闭环

- [x] 建立双记忆模板：`workspace/MEMORY.md` / `workspace/LAWYER_PROFILE.md`
- [x] 核心数据结构：`TaskIntent` / `ResearchBundle` / `ArtifactDraft` / `AuditEvent`
- [x] 代码骨架：`src/lawmind/` 五大模块（Router / Memory / Retrieval / Artifacts / Audit）
- [x] 接入通用大模型（Retrieval adapter，OpenAI-compatible + 环境变量预设）
- [x] 接入法律专用模型（Retrieval adapter，同上）
- [x] Word 模板文件（`workspace/templates/word/`）
- [x] 人工审核 UI / CLI 交互（CLI + LawMind 桌面「审核」页：草稿列表、签批、渲染交付物）
- [x] 完整端到端测试（smoke 脚本 + Router/Reasoning/Engine 正式测试用例）

### LawMind Phase A（可审计交付底座，与顶尖产品路线对齐）

- [x] 引擎黄金路径单测：`matter` → 草稿 → `review` → `render(docx)` → 审计含 `draft.reviewed` / `artifact.rendered`（`src/lawmind/integration/phase-a-golden-engine.test.ts`）
- [x] 审计 Markdown 导出：`buildAuditExportMarkdown` + 按 `matterId` / `taskId` / 时间筛选（`src/lawmind/audit/index.ts`，桌面 `GET /api/audit/export`）
- [x] PROFILE 分段解析：`listAssistantProfileSections` + `GET /api/assistants/<id>/profile-sections`
- [x] 体检字段扩展：`GET /api/health` 含 `lawMindRoot`、`doctor.*`（`apps/lawmind-desktop/server/lawmind-health-payload.ts`）

### 第二期 — 扩展与深化

- [x] PPT 渲染（`render-pptx.ts`，引擎按 `draft.output === "pptx"` 分发）
- [x] 案件级记忆：`workspace/cases/<matter-id>/CASE.md`（`loadMemoryContext` / `ensureCaseWorkspace` / 引擎与 Agent 工具；见 `src/lawmind/memory/index.test.ts`）
- [x] 律师偏好显式学习：`appendLawyerProfileLearning`、`buildLawyerProfileReviewLearningLine`、审核台勾选写入「八、个人积累」、`POST /api/lawyer-profile/learning`
- [x] 文书模板分类：`BuiltInTemplateCategory` + `GET /api/templates/built-in`（contracts / litigation / client / internal）

### 第三期 — 商业化与合规

- [x] 多律师协作支持（委派注册表 + `collaboration-audit.jsonl` + `GET /api/collaboration/summary`）
- [x] 私有化部署方案（检查清单：[LawMind 私有化部署](/LAWMIND-PRIVATE-DEPLOY)）
- [x] 合规报表与审计链增强（`buildComplianceAuditMarkdown`、`GET /api/audit/export?compliance=true`）
- [x] 法律模板/技能包本地签名校验（`verifyLawMindBundleManifest`，[LawMind 包清单](/LAWMIND-BUNDLES)；非远程市场）

---

## 五、非目标与边界（简要）

以下为当前阶段**暂不纳入**的方向，作为路线图护栏（详见 [VISION.md](VISION.md)）：

- 新 skill 能上 ClawHub 的就不进 core。
- 全量文档多语言翻译延后（计划后续用 AI 生成）。
- 与模型提供商定位不清的商业服务集成。
- 对已有 channel 的纯包装、且无明确能力/安全差异的，不合并。
- 在 core 内做一等 MCP 运行时（优先用 mcporter 集成）。
- 默认采用 agent 层级/经理套经理/嵌套规划树架构。
- 重复现有 agent/tool 能力的重型编排层。

有强烈用户需求或技术理由时，可再讨论调整。

---

## 六、参考

- 愿景与原则：[VISION.md](VISION.md)
- **LawMind 愿景（文档即记忆）**：[docs/LAWMIND-VISION.md](docs/LAWMIND-VISION.md)
- **LawMind 决策文档**：[docs/LAWMIND-DECISION.md](docs/LAWMIND-DECISION.md)
- **LawMind 架构文档**：[docs/LAWMIND-ARCHITECTURE.md](docs/LAWMIND-ARCHITECTURE.md)
- **LawMind 工程记忆（规划与进度）**：[docs/LAWMIND-PROJECT-MEMORY.md](docs/LAWMIND-PROJECT-MEMORY.md)
- **LawMind 商业化支撑包（索引）**：[docs/LAWMIND-DELIVERY.md](docs/LAWMIND-DELIVERY.md)（§10 备份/升级）、[docs/LAWMIND-SECURITY-CHECKLIST.md](docs/LAWMIND-SECURITY-CHECKLIST.md)、[docs/LAWMIND-CUSTOMER-OVERVIEW.md](docs/LAWMIND-CUSTOMER-OVERVIEW.md)
- **LawMind 模型适配说明**：[docs/LAWMIND-MODEL-ADAPTERS.md](docs/LAWMIND-MODEL-ADAPTERS.md)
- 项目概览与开发：[README.md](README.md)
- 贡献指南：[CONTRIBUTING.md](CONTRIBUTING.md)
- 安全策略：[SECURITY.md](SECURITY.md)
- 官方文档：<https://docs.openclaw.ai>

---

_最后更新：可在此记录日期或由维护者按需更新。_
