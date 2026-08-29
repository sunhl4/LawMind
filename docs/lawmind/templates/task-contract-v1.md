# LawMind Task Contract v1

> 用途：统一 Coordinator / Worker / Test Owner 在多任务协作中的输入输出边界、验收标准与回退动作。  
> 适用：`src/lawmind/`、`apps/lawmind-desktop/`、`docs/lawmind/` 相关任务。

## 1) 可复用模板

```md
## Meta

- task_id:
- owner_role: coordinator | worker | test_owner
- owner:
- reviewer:
- created_at:
- target_release:

## Goal

- business_goal:
- success_signal:

## Scope

- in_scope:
- out_of_scope:

## Inputs

- upstream_dependencies:
- required_context:
- required_files:

## Outputs

- code_artifacts:
- doc_artifacts:
- runtime_artifacts:

## Output Format

- format_contract:
- acceptance_payload:
- output_location:

## Acceptance Criteria

- functional_validation:
- ui_validation:
- quality_gate:
- pass_threshold:

## Risks

- technical_risks:
- compliance_risks:
- delivery_risks:

## Rollback

- rollback_trigger:
- rollback_steps:
- data_protection:

## Parallel Boundary

- parallel_group:
- parallelizable_items:
- serialization_points:
- shared_write_lock:

## Handoff

- handoff_to:
- handoff_conditions:
```

## 2) 示例 A：协作工作流模板验收增强

```md
## Meta

- task_id: LM-MT-B1-WF-CONTRACT-001
- owner_role: worker
- owner: agent-worker
- reviewer: test-owner
- created_at: 2026-05-14
- target_release: multitask-commercial-pass-r1

## Goal

- business_goal: 让 workspace workflow 模板具备明确的契约化输入输出与验收字段，减少协作返工。
- success_signal: 新模板可以稳定被读取、实例化，且验收信息在文档与执行脚本中可追踪。

## Scope

- in_scope:
  - `docs/lawmind/templates/task-contract-v1.md`
  - `docs/lawmind/LAWMIND-MULTITASK-BASELINE-VALIDATION.md`
  - `scripts/lawmind/lawmind-multitask-validate.ts`
- out_of_scope:
  - 大规模重构 `src/lawmind/agent/orchestrator/*`
  - 引入新的数据库或远程依赖

## Inputs

- upstream_dependencies:
  - `docs/lawmind/LAWMIND-MULTITASK-PLAYBOOK.md`
  - `src/lawmind/agent/collaboration/workspace-workflow-templates.ts`
- required_context:
  - 当前已有 `workspace/lawmind/workflows/*.json` 读取与实例化能力
- required_files:
  - `apps/lawmind-desktop/server/lawmind-server-route-collaboration.test.ts`

## Outputs

- code_artifacts:
  - 可执行验证脚本 + package script 入口
- doc_artifacts:
  - Task Contract 模板 + DoD runbook
- runtime_artifacts:
  - `dist/lawmind/multitask-validation/*.json`
  - `dist/lawmind/multitask-validation/*.md`

## Output Format

- format_contract: JSON + Markdown 双报告
- acceptance_payload:
  - 每个检查项包含 `id/area/required/pass|fail|skipped/duration/reason`
- output_location:
  - `dist/lawmind/multitask-validation/`

## Acceptance Criteria

- functional_validation:
  - 关键 workflow/collaboration 测试通过
- ui_validation:
  - renderer smoke 测试通过；可选 e2e/desktop-http-smoke 有明确跳过原因
- quality_gate:
  - typecheck + 文档化 DoD
- pass_threshold:
  - 所有 required 项通过；允许 optional 项跳过但必须记录原因

## Risks

- technical_risks:
  - 本地环境可能缺 Playwright 浏览器或未启动 desktop server
- compliance_risks:
  - 报告中不写敏感凭据
- delivery_risks:
  - CI 与本地 Node 版本差异导致个别脚本行为不同

## Rollback

- rollback_trigger:
  - required 检查失败且无法短时间修复
- rollback_steps:
  - 移除新增命令入口，保留文档模板
- data_protection:
  - 验收输出仅写入 `dist/`，不覆盖用户 workspace 业务数据

## Parallel Boundary

- parallel_group: PG-WORKFLOW-CONTRACT
- parallelizable_items:
  - 文档模板撰写
  - 验证脚本实现
- serialization_points:
  - package.json script 接入
  - 最终验收报告生成
- shared_write_lock:
  - `package.json` 与 `docs/lawmind/LAWMIND-MULTITASK-BASELINE-VALIDATION.md`

## Handoff

- handoff_to: test-owner
- handoff_conditions:
  - 输出报告生成成功
  - runbook 的 DoD 与命令可复现
```

## 3) 示例 B：Desktop UI 多任务看板 smoke 验收

```md
## Meta

- task_id: LM-MT-B3-UI-SMOKE-002
- owner_role: test_owner
- owner: qa-agent
- reviewer: coordinator
- created_at: 2026-05-14
- target_release: multitask-commercial-pass-r1

## Goal

- business_goal: 建立 LawMind desktop 关键页面/关键交互的可重复 smoke 验证路径。
- success_signal: 每次执行都能产出一致格式报告，能快速判断是否可发布。

## Scope

- in_scope:
  - renderer shell / chat shell / explorer 关键测试
  - 可选 Playwright smoke 与 desktop HTTP smoke
  - 手工检查清单与通过标准
- out_of_scope:
  - 全量视觉回归平台
  - 复杂性能压测

## Inputs

- upstream_dependencies:
  - `apps/lawmind-desktop/src/renderer/*.test.ts`
  - `apps/lawmind-desktop/e2e/smoke.spec.ts`
  - `scripts/lawmind/lawmind-desktop-http-smoke.mjs`
- required_context:
  - desktop API 默认 loopback；E2E 使用 mock API
- required_files:
  - `apps/lawmind-desktop/README.md`

## Outputs

- code_artifacts:
  - `lawmind:multitask:validate` 执行结果
- doc_artifacts:
  - UI 手工检查 checklist
- runtime_artifacts:
  - 校验报告中的 ui-check 项

## Output Format

- format_contract: checklist + report artifacts
- acceptance_payload:
  - UI checks: `ui-renderer-smoke`, `ui-playwright-smoke`, `ui-http-smoke`
- output_location:
  - `dist/lawmind/multitask-validation/*.json|*.md`

## Acceptance Criteria

- functional_validation:
  - 协作路由与 workflow 模板测试通过
- ui_validation:
  - required UI tests 通过；optional tests 的 skip/失败有可执行复现命令
- quality_gate:
  - typecheck 通过；DoD 列表完整
- pass_threshold:
  - required 全绿 + optional 全部有状态说明

## Risks

- technical_risks:
  - 无法启动 Electron 或浏览器依赖缺失
- compliance_risks:
  - 手工截图/日志可能包含客户信息，需脱敏
- delivery_risks:
  - UI 文案调整导致断言需要同步维护

## Rollback

- rollback_trigger:
  - UI 验证路径不稳定导致持续误报
- rollback_steps:
  - 将 optional UI checks 暂降级并补充 blocker 文档
- data_protection:
  - smoke 仅使用 mock/test 数据，不写入真实案件目录

## Parallel Boundary

- parallel_group: PG-UI-VERIFICATION
- parallelizable_items:
  - 自动化 smoke 执行
  - 手工 checklist 走查
- serialization_points:
  - 发布前 Test Owner 最终签字
- shared_write_lock:
  - `apps/lawmind-desktop/src/renderer/` 断言更新必须串行

## Handoff

- handoff_to: coordinator
- handoff_conditions:
  - 验收报告存在且 required 为通过
  - 手工 checklist 已执行并签名
```
