# LawMind Multitask Playbook（v1）

> 目标：在不打断当前交付节奏的前提下，把 LawMind 现有能力升级为更稳定的「任务级并行协作」体系：Coordinator-Worker、异步长任务、任务契约、可验收输出、冲突治理、回退策略。

## 1. 背景与适用范围

本手册面向以下目录与角色：

- 引擎与运行时：`src/lawmind/`
- 桌面与本地 API：`apps/lawmind-desktop/`
- 文档与运行手册：`docs/LAWMIND-*.md`、`docs/lawmind/`

本手册与以下文档保持一致：

- 目标与阶段：`GOALS.md`
- 产品北极星：`docs/LAWMIND-VISION.md`
- 架构与工作区约定：`docs/LAWMIND-ARCHITECTURE.md`
- 交付与验收：`docs/LAWMIND-DELIVERABLE-FIRST.md`、`docs/LAWMIND-DELIVERY.md`
- 协作与异步工作流：`docs/LAWMIND-COLLABORATION-UI-API-MAP.md`
- 运维与回退：`docs/LAWMIND-SUPPORT-RUNBOOK.md`
- 工程续作：`GOALS.md`、`docs/LAWMIND-FUTURE-ISSUES.md`

## 2. 现状 vs Multitask 最佳实践

### 2.1 已做得好的部分（可直接复用）

1. **任务级闭环清晰**
   - 已有 `plan -> research -> draft -> review -> render` 主链路和 checkpoints（见 `docs/lawmind/task-checkpoints.md`）。
   - `GOALS.md` 已沉淀阶段性可验收里程碑，且不少条目有代码/测试对应。

2. **异步长任务基础较好**
   - 协作工作流支持 `async: true`、`jobId`、状态查询、SSE 推送、取消、幂等键（见 `GOALS.md` 第七期、`docs/LAWMIND-COLLABORATION-UI-API-MAP.md`）。

3. **验收门禁与可交付导向明确**
   - `validateDraftAgainstSpec`、strict render、Acceptance Pack 已落地（见 `docs/LAWMIND-DELIVERABLE-FIRST.md`）。
   - 形成了「可交付优先」而非「聊天轮次优先」的工程共识（见 `docs/LAWMIND-VISION.md`）。

4. **治理和可运维能力有骨架**
   - `lawmind.policy.json`、benchmark gate、治理报告、quality dashboard、support runbook 已具备（见 `docs/lawmind/phase-c-governance.md`、`docs/lawmind/phase-d-operability.md`、`docs/LAWMIND-SUPPORT-RUNBOOK.md`）。

5. **风险控制有默认护栏**
   - Clarify-Execute、危险工具审批、审计链、人工审核点、版本特性开关（Solo/Firm/Private）已形成组合拳。

### 2.2 关键差距（Multitask 视角）

1. **任务契约缺少统一模板**
   - 现在有类型和流程，但跨角色（coordinator/worker/test owner）通用的「任务契约文档」尚未成为默认入口。

2. **并行边界定义不够显式**
   - 多助手协作和工作流已有，但「哪些任务可并行、哪些必须串行、共享写路径如何锁定」缺少统一治理模板。

3. **异步策略和失败重试策略分散**
   - 已有 job cancel/idempotency/SSE，但缺少统一 SLO 与 retry policy 分层（瞬时失败/可重试失败/人工介入失败）。

4. **可验收输出标准未覆盖“协作任务”**
   - 目前验收门禁主要聚焦 draft/render；对 delegation/workflow 子任务的“Definition of Done”不够统一。

5. **冲突治理与回退机制偏运维化、少工程化协议**
   - 已有 backup/rollback runbook，但在并行开发/并行任务执行时，冲突检测、仲裁、回退触发条件缺少统一阈值。

6. **可观测性指标未形成单一看板口径**
   - 存在多类数据（audit、jobs、quality、benchmarks），但还缺一个「Multitask 运营指标板」把 lead time、冲突率、重试率串起来。

## 3. LawMind Multitask 作业模型（建议默认）

### 3.1 角色分工

- **Coordinator（协调者）**
  - 负责任务分解、依赖图、并行边界、冲突仲裁、回退决策。
- **Worker（执行者）**
  - 按任务契约产出代码/文档/验证结果，不越权改动契约外范围。
- **Test Owner（验收者）**
  - 维护 DoD、回归清单、质量阈值，给出 release/no-release 结论。

### 3.2 任务契约（Task Contract v1）

每个任务（尤其是协作工作流模板）建议至少包含：

- `task_id`：稳定 ID（可映射到 jobId / taskId）
- `owner_role`：coordinator / worker / test_owner
- `goal`：一句话业务目标
- `in_scope` / `out_of_scope`：明确边界
- `inputs`：依赖资料、上游任务、前置状态
- `outputs`：必须产出的文件/API/审计事件
- `acceptance`：量化验收条件（见第 4 节指标）
- `parallel_group`：可并行组编号（同组并发、跨组串行）
- `conflict_policy`：冲突优先级 + 仲裁人
- `rollback_policy`：失败触发条件 + 回退步骤 + 数据保护要求

### 3.3 并行与串行边界

- **可并行**：只读分析、独立草稿生成、不同 matter 的检索/摘要、文档编写。
- **必须串行**：同一 deliverable 的最终审核签批、同一文件同一区块写入、render/export 终态动作。
- **建议规则**：若两个 worker 的 `outputs` 落在同一路径且同一对象（同 taskId/deliverableId），默认串行。

## 4. 分阶段执行路线图（0-1 周 / 1-2 周 / 2-4 周）

## 阶段 A（0-1 周）：先统一契约与指标口径

1. **落地 Task Contract v1 模板（文档 + 示例）**
   - Owner：Coordinator
   - 验收指标：
     - 新建协作任务中，>= 80% 使用统一契约模板
     - 每个契约均含 `acceptance` 与 `rollback_policy`

2. **建立 Multitask 指标基线脚本（只读聚合）**
   - Owner：Test Owner
   - 输入：`workspace/audit/*.jsonl`、`workspace/lawmind/jobs/*.json`、`workspace/quality/dashboard.json`
   - 验收指标：
     - 输出 lead time、失败重试率、取消率、冲突率（先用代理指标）
     - 每日可生成一次基线报告（Markdown 或 JSON）

3. **定义并行边界清单（哪些可并行/串行）**
   - Owner：Coordinator + Worker
   - 验收指标：
     - 至少覆盖前 5 个高频工作流模板
     - 每个模板明确 parallel group 与串行节点

## 阶段 B（1-2 周）：把异步协作与验收标准接起来

1. **工作流模板接入任务契约字段**
   - Owner：Worker
   - 位置：`workspace/lawmind/workflows/*.json`（及解析逻辑）
   - 验收指标：
     - 新模板支持 `owner_role`、`parallel_group`、`acceptance`
     - 模板校验失败可给出明确错误原因

2. **Job 状态增加“可验收输出”快照**
   - Owner：Worker + Test Owner
   - 目标：在 job 终态写入 `acceptance_summary`（通过项/阻塞项）
   - 验收指标：
     - > = 90% 终态 job 含验收摘要
     - 失败 job 可区分「可重试」与「需人工介入」

3. **重试与取消策略标准化**
   - Owner：Coordinator
   - 验收指标：
     - 形成统一 retry policy（最多次数、退避策略、何时 stop retry）
     - 失败重试率可观测，且 2 周内较基线下降 20%（目标值，可按真实数据微调）

## 阶段 C（2-4 周）：冲突治理、回退自动化、运营看板

1. **冲突治理机制（Contract-aware）**
   - Owner：Coordinator
   - 内容：同对象写冲突检测、仲裁记录、冲突后强制复核
   - 验收指标：
     - 并行冲突率（冲突任务数/并行任务数）可度量
     - 冲突任务 100% 有仲裁记录

2. **回退策略脚本化（轻量）**
   - Owner：Worker + Test Owner
   - 内容：结合 `scripts/lawmind/lawmind-backup.sh` 与 runbook 形成标准回退剧本
   - 验收指标：
     - 典型故障 30 分钟内完成一次演练回退
     - 回退后 `lawmind:ops doctor --deep` 通过率 >= 95%

3. **Multitask 运营指标看板（文档先行）**
   - Owner：Test Owner
   - 指标建议：
     - Lead time（P50/P90）
     - 失败重试率
     - 并行冲突率
     - 一次验收通过率（first-pass）
     - 文档契约完整度
   - 验收指标：
     - 每周发布一次固定格式周报
     - 指标口径在文档中冻结（避免统计漂移）

## 5. 量化验收指标（建议口径）

- **Lead time**：`task created -> acceptance passed` 的时长（P50/P90）
- **失败重试率**：`retry_count > 0` 的任务占比
- **并行冲突率**：并行组内触发冲突仲裁的任务占比
- **一次通过率**：无需返工即通过验收门禁的任务占比
- **测试覆盖**：高风险链路对应测试文件覆盖率（按模块统计）
- **文档完整度**：任务契约字段完整率（必填字段完整任务数/总任务数）

## 6. 冲突治理与回退策略（执行约定）

### 6.1 冲突治理

- 同一对象（matter/deliverable/task）进入并行前，Coordinator 必须指定唯一仲裁 owner。
- 发生冲突时，优先保持「审计可追溯」而非「自动覆盖成功」。
- 冲突后必须补一条治理记录：冲突原因、决策、是否触发回退、后续防再发动作。

### 6.2 回退触发条件

建议满足任一条件即触发回退评估：

- 高风险任务验收 blocker 持续失败超过阈值
- 同一工作流重试超过阈值仍不收敛
- 关键链路（review/render/jobs）出现系统性错误
- 审计链或质量导出失真，无法满足合规要求

### 6.3 回退执行骨架

1. 冻结新增写入（避免污染扩大）
2. 执行 workspace 备份
3. 回退到上一个稳定版本（应用与配置）
4. 运行 `pnpm lawmind:ops doctor --deep` + 核心验收命令
5. 记录回退事件到 runbook（含恢复时间与影响面）

## 7. LawMind 定制「提需求模板」

以下模板用于让 Coordinator/Worker/Test Owner 快速对齐。

### 7.1 开发需求（功能新增）

```md
## 背景

- 业务目标：
- 影响角色（律师/助理/运维）：

## 范围

- In scope:
- Out of scope:

## 目标目录

- 代码：`src/lawmind/...` / `apps/lawmind-desktop/...`
- 文档：`docs/LAWMIND-*.md` 或 `docs/lawmind/...`

## 任务契约

- owner_role:
- inputs:
- outputs:
- acceptance:
- rollback_policy:

## 验证

- `pnpm test -- <related tests>`
- `pnpm --filter lawmind-desktop typecheck`（若改桌面）
```

### 7.2 线上故障（Incident）

```md
## 现象

- 发生时间：
- 影响范围（matter/task/job）：
- 严重级别：

## 证据

- `workspace/audit/*.jsonl` 关键事件：
- `workspace/lawmind/jobs/*.json` 状态：
- `/api/health` 快照：

## 临时处置

- 是否暂停协作工作流：
- 是否启用回退：

## 目标

- 恢复SLO：
- 根因定位输出（含复现步骤）：
```

### 7.3 重构需求（结构调整）

```md
## 重构目标

- 当前痛点：
- 期望收益（可量化）：

## 兼容策略

- 保留契约：
- 新旧映射：
- 渐进迁移步骤：

## 风险与回退

- 风险点：
- 回退触发条件：
- 回退脚本/命令：
```

### 7.4 性能优化需求

```md
## 问题定义

- 慢在哪个链路（plan/research/draft/review/render/job stream）：
- 基线数据（P50/P90）：

## 优化目标

- 目标指标：
- 观测口径：

## 实施范围

- 目标模块：
- 非目标：

## 验证

- 压测/回放方式：
- 回归测试：
```

### 7.5 文档闭环需求

```md
## 变更来源

- 关联代码/PR：
- 受影响命令/API：

## 需更新文档

- `GOALS.md`（是否勾选）
- `docs/LAWMIND-*.md`
- `docs/lawmind/*.md`

## 验收

- 路径引用可点击且正确
- 命令可执行（至少 dry-run 或 smoke 验证）
- 与现网行为一致
```

## 8. 立即执行清单（建议本周）

- [ ] 用本手册模板创建首批 3 个 Task Contract（一个开发、一个故障、一个重构）
- [ ] 从现有 jobs/audit 生成首版 Multitask 指标基线
- [ ] 在一个真实协作 workflow 上试运行「并行边界 + 验收摘要 + 回退剧本」
- [ ] 将复盘结论回写到 `GOALS.md` 与 `docs/LAWMIND-FUTURE-ISSUES.md`

## 9. v1 implementation pass（已落地入口）

- Task Contract 模板：`docs/lawmind/templates/task-contract-v1.md`
- Baseline 验证 runbook：`docs/lawmind/LAWMIND-MULTITASK-BASELINE-VALIDATION.md`
- 一键验证命令：`pnpm lawmind:multitask:validate`
- 严格 UI 模式：`pnpm lawmind:multitask:validate:strict`
- 验收输出目录：`dist/lawmind/multitask-validation/`

---

如需最小化落地成本，优先做「契约统一 + 指标口径统一 + 回退剧本统一」三件事，再推进自动化。
