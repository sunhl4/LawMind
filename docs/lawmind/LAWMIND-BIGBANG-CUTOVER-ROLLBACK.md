# LawMind Big-Bang 切换与回退手册

## 1. 适用范围

适用于平台级重构后的首轮发布（ingest 契约、运行态契约、API 响应字段扩展）。

## 2. 切换前检查

1. `pnpm exec vitest run` 关键套件通过（agent/tools/server）。
2. `pnpm --filter lawmind-desktop typecheck` 通过。
3. `pnpm lawmind:multitask:validate:strict` 输出 `releaseReady=true`。
4. `pnpm lawmind:docs:build` 通过。

## 3. 切换开关

- 环境变量：`LAWMIND_PLATFORM_CONTRACTS_V1`
  - `1`（默认）：启用平台契约字段（如 chat 响应中的 `executionState`/`gateDecisions`）。
  - `0`：回退到旧响应语义（保留原有 `status`/`clarificationQuestions`）。

## 4. 切换步骤

1. 保持 `LAWMIND_PLATFORM_CONTRACTS_V1=1`。
2. 重启 desktop local server。
3. 在桌面执行 5 条典型任务抽查（PDF、图片、DOCX、XLSX、纯文本）。
4. 检查审计与 UI 是否出现异常字段解析。

## 5. 回退触发条件

- 任一发布门禁命令失败。
- chat 路由出现批量 5xx。
- UI 无法渲染新响应字段导致主流程中断。

## 6. 回退动作

1. 立即设置 `LAWMIND_PLATFORM_CONTRACTS_V1=0`。
2. 重启 desktop local server。
3. 复跑：
   - `pnpm --filter lawmind-desktop typecheck`
   - `pnpm run lawmind:desktop:http-smoke`
4. 在事故记录中附上：
   - 失败任务 ID / sessionId
   - 最近报告文件（`dist/lawmind/multitask-validation/report-*.json`）
   - 对应提交范围

## 7. 回退后恢复策略

1. 在隔离分支修复问题。
2. 补充回归用例后再次执行 strict 验证。
3. 小窗口灰度重新启用 `LAWMIND_PLATFORM_CONTRACTS_V1=1`。
