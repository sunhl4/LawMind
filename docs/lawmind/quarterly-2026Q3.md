# LawMind 2026-Q3 季末决策与 Sunset 列表

> 与 `.cursor/plans/lawmind-3-month-refactor_abc3d086.plan.md` 一一对应。
> 12 周计划的全过程工程记录见 `docs/LAWMIND-PROJECT-MEMORY.md` §8 2026-05-02 节。

## 1. 本季节核心决策

| 主题                     | 决策                                                                                                                                                              |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Engine 模块划分          | `src/lawmind/index.ts` 退化为 re-export barrel；新模块全部进入 `src/lawmind/engine/`，每个模块只承担一个生命周期阶段。                                            |
| ToolPolicy 实现          | 用八段中间件 pipeline（`src/lawmind/runtime/tool-pipeline.ts`）替代 `runTurn` 内联规则；新中间件原则上"加在 pipeline 末段，不加在 runTurn 内"。                   |
| Matter 写侧真相源        | 选 `workspace/matters/<id>/{matter.json, deliverables/*.json, approvals.jsonl, queue.jsonl, deadlines.jsonl}`，不引入 SQLite；旧 Markdown 仍可读可写。            |
| Memory 写入收口          | 所有 Markdown 记忆写入只能经 `MemoryAdoptionService`；自动写入走 `auto_adopted`，律师可在 Inspector 撤回。                                                        |
| Role 一等对象            | 6 个内置 Role 与 `presetKey` 同名，`AssistantProfile.roleId` 默认从 presetKey 推导；`presetKey` 字段保留至 2026-Q4 末再下线。                                     |
| Reasoning Gate 默认范围  | 仅四类高风险内置 spec（demand letter / contract review / general contract / litigation outline）默认 `required=true`；Solo edition 永远不阻断（仅显示 warning）。 |
| Insights 双写            | `ui.matter_action` 与 `ux.matter_action` 双写过渡一个季度；2026-Q4 末根据 Inspector 的真实采纳率决定是否停写旧 kind。                                             |
| MatterWorkbench 拆分节奏 | 季末完成 seam（视图骨架 + 黄金路径 e2e）；3826 行老组件留待后续 PR 增量迁入，不为了交付时间窗硬拆。                                                               |

## 2. Sunset 计划（双轨保留窗口）

| 旧契约 / 字段 / 路径                                                                               | 替代方案                                                 | 计划停写时间                     | 备注                                                          |
| -------------------------------------------------------------------------------------------------- | -------------------------------------------------------- | -------------------------------- | ------------------------------------------------------------- |
| `AssistantProfile.presetKey`                                                                       | `AssistantProfile.roleId`                                | 2026-Q4 末                       | 仍然只读保留一段时间，避免老 `assistants.json` 被破坏。       |
| `audit kind: ui.matter_action`                                                                     | `ux.matter_action`                                       | 2026-Q4 末（按采纳率）           | Inspector 与 insights 已统一在新 kind 上消费；read 侧做去重。 |
| 仅写 `MatterIndex` 的 read-side 路径                                                               | `adapters/matter-storage/*` 优先读 JSON                  | 2026-Q4 末                       | JSON 缺失时仍回退 `MatterIndex`，确保老工作区无感升级。       |
| `appendCaseCoreIssue / appendLawyerProfileLearning / appendAssistantProfileMarkdown` 直写 Markdown | `memory/adoption-service.ts` 入队 + writer 落盘          | 已切：本季节起所有调用方走新链路 | 旧函数本身保留，为外部脚本提供兜底。                          |
| `collaboration-tools.ts` 单文件                                                                    | `tools/coordination/{delegate,handoff,meeting,utils}.ts` | 已切：旧文件改为 barrel          | barrel 仍 re-export，保持 import path 兼容。                  |

## 3. 验收 / 演示路径

- `pnpm test` 全绿（包含 `src/lawmind/integration/quarterly-acceptance.test.ts`）。
- `pnpm lawmind:acceptance` 含新 step 5/6 `pnpm lawmind:quarterly-demo`，跑完
  matter → planned deliverable → 高风险 approval → 状态推进 → reasoning gate
  阻断 → memory adoption 入队 → JSON 真相源回读，无旧 fallback。
- `pnpm lawmind:bundle:desktop-server` + `pnpm lawmind:desktop:http-smoke` 季末
  各跑一次。
- 桌面 demo：`pnpm lawmind:demo` 与 `pnpm lawmind:quarterly-demo` 提供"剧本"
  与"机制证据"，5–10 分钟现场演示按 matter cockpit + role 委派 + memory
  adoption + reasoning gate 顺序展示。

## 4. 不在本季节做的事（重申，避免范围漂移）

- 不引入 LangGraph / Mastra 等外部 agent framework。
- 不把 Markdown 真相源换成 SQLite / DuckDB。
- 不新增 Edition feature flag（除 W10 的 `productInsightsCollection`）。
- 不重写 `src/lawmind/agent/system-prompt.ts`；只在 W7/W8 注入 role mission 段。
- 不开发 Web 端或移动端；本季节产出仅供桌面 + CLI 消费。
