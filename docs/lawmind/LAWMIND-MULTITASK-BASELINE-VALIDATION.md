# LawMind Multitask Baseline Validation（商业化第一轮落地）

> 目标：把 `docs/lawmind/LAWMIND-MULTITASK-PLAYBOOK.md` 中“可以在当前仓库直接执行”的项，收敛为可运行、可重复、可验收的第一轮 implementation pass。

## 1. 本轮已落地范围（Now）

1. **Task Contract v1 模板**
   - 文件：`docs/lawmind/templates/task-contract-v1.md`
   - 提供统一字段：目标、输入、输出格式、验收标准、风险、回退、owner、并行边界。
   - 附 2 个 LawMind 场景实例（协作 workflow 验收增强、desktop UI smoke 验收）。

2. **功能验证基线（可执行）**
   - 入口：`pnpm lawmind:multitask:validate`
   - 覆盖：
     - guardrail（范围/验收/回退/并行边界）检查
     - 九部分 audit matrix 产物输出
     - workflow template + collaboration route 关键测试
     - desktop typecheck 质量门禁
     - observability 指标基线报告输出
   - 输出：`dist/lawmind/multitask-validation/report-*.json|md`

3. **UI 验证基线（可执行 + 可审计）**
   - 默认自动化：
     - renderer smoke（shell/chat/explorer）
   - 可选自动化：
     - Playwright smoke（`--with-playwright`）
     - desktop local API HTTP smoke（默认自动拉起本地 server；可通过 `LAWMIND_DESKTOP_PORT` 固定端口）
   - 所有检查项都会写入结构化报告，包含 `passed/failed/skipped` 与原因。

4. **完成定义（DoD）**
   - DoD 已固化在验证脚本输出中（report 的 `definitionOfDone` 字段）。
   - 发布判定：所有 required 项通过 (`releaseReady=true`) 才可视为本轮通过。

## 2. 本轮不做（Later）

以下项属于 Playbook 阶段 B/C，需要后续轮次推进：

1. workflow 模板 schema 在运行时强制校验 `owner_role/parallel_group/acceptance` 字段。
2. jobs 终态落盘 `acceptance_summary`（通过项/阻塞项）并形成可查询 API。
3. contract-aware 冲突检测与仲裁记录自动化。
4. 回退策略自动编排（含演练追踪与恢复时长统计）。
5. 统一运营看板（lead time、冲突率、retry 率等）持续周报。

## 3. 可执行命令（最小闭环）

### 3.1 默认校验（推荐）

```bash
pnpm lawmind:multitask:validate
```

- **通过标准：**
  - required checks 全部 `passed`
  - 报告中 `releaseReady=true`

### 3.2 含 Playwright 的 UI 严格校验

```bash
pnpm lawmind:multitask:validate:strict
```

- 等价于在仓库根目录执行 `node --import tsx scripts/lawmind/lawmind-multitask-validate.ts --with-playwright --strict`（与 `package.json` 中 `lawmind:multitask:validate:strict` 脚本一致）
- 在 strict 模式下，以下项均为 required gate：
  - `lawmind:multitask:guardrail`
  - `lawmind:multitask:audit -- --strict`
  - `lawmind:multitask:observability -- --window-days 14`
  - Playwright smoke
  - desktop local API HTTP smoke

## 4. UI 手工复核清单（与自动化互补）

> 用于自动化可用但仍需产品/QA 最终确认时，建议和脚本同批执行并附截图。

1. 启动 desktop（`pnpm lawmind:desktop`）后，确认主界面显示 `LawMind` 品牌与 `Legal Workbench`。
2. 进入聊天主区域，确认默认助手标题可见（“默认助手”）。
3. 进入案件列表/侧边栏，确认 explorer 区域可见且无空白崩溃。
4. 执行 local API smoke（默认自动起服 + 自动端口）：
   - `pnpm lawmind:desktop:http-smoke`
   - 如需固定端口：`LAWMIND_DESKTOP_PORT=<port> pnpm lawmind:desktop:http-smoke`
5. 记录：
   - 手工截图路径
   - 本次验证报告路径（`dist/lawmind/multitask-validation/report-*.md`）
   - 是否满足发布条件（Yes/No）

## 5. 验收记录规范

每次验证至少保存以下内容：

1. 命令行与执行时间
2. `guardrail-*.json|md`、`audit-matrix-*.json|md`、`observability-*.json|md`、`decision-*.json|md`
3. `report-*.json` 原始结果
4. `report-*.md` 人类可读摘要
5. 若存在 skipped/failed：
   - 阻塞原因
   - 可复现步骤
   - 下一步处理 owner 与 ETA
