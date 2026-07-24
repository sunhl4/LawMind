# 模型能力后置项 — 执行计划（R4）

> 基准：[`LAWMIND-MODEL-CAPABILITY-REMAINING-PLAN.md`](LAWMIND-MODEL-CAPABILITY-REMAINING-PLAN.md) §0「仍后置」  
> 制定：2026-07-23  
> 原则：最大发挥模型能力；律师审批 / 正式导出 / 记忆采纳不拆；新能力默认可关。

---

## 0. 范围与状态（2026-07-23 收口）

| ID      | 主题                                  | 体量 | Sprint 序              | 状态       |
| ------- | ------------------------------------- | ---- | ---------------------- | ---------- |
| E8      | directive-parser 吃 envelope `plan`   | S    | R4a                    | **已落地** |
| F5      | 会议室 `allowWebSearch` 开关          | S    | R4a                    | **已落地** |
| F6      | `agentMaxHistoryMessages` policy      | S    | R4a                    | **已落地** |
| C11     | LexEdge 进桌面 `buildAdaptersFromEnv` | S    | R4a                    | **已落地** |
| E3      | 自定义模型 `stop` 序列                | S    | R4a                    | **已落地** |
| C12     | Role 空 allowlist 设置页告警          | S    | R4a                    | **已落地** |
| D8      | 未决澄清 key 跨轮保留                 | S–M  | R4b                    | **已落地** |
| F2 / F3 | 编辑丢工具警告 + 显示工具轨迹         | M    | R4b                    | **已落地** |
| C3      | Solo 沙箱 workflow 步自动批           | M    | R4b                    | **已落地** |
| A6↑     | 滚动 `meeting-summary.md`             | M    | R4b                    | **已落地** |
| E7      | Advisor / Worker 双槽位               | L    | R4c（opt-in 最小可用） | **已落地** |

**推荐顺序：R4a → R4b → R4c（已完成）。**

---

## 1. R4a — 小项并行（约 1 人日）

### 1.1 E8 — Directive envelope

| 项       | 内容                                                                                                                                      |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| **要做** | `parseDirectiveWithModel` 用 `resolveCapabilityEnvelope({ taskKind: "plan" })` 定 `maxTokens`；温度用 `resolveTemperatureForTask("plan")` |
| **代码** | `src/lawmind/agent/orchestrator/directive-parser.ts`                                                                                      |
| **验收** | 单测：clamp 与 envelope.plan 一致                                                                                                         |

### 1.2 F5 — 会议室开网

| 项       | 内容                                                                    |
| -------- | ----------------------------------------------------------------------- |
| **要做** | Meeting 面板主席开关，默认关；传入 `allowWebSearch`；服务端策略仍可夹死 |
| **代码** | `MatterTeamMeetingPanel.tsx`                                            |
| **验收** | 组件/逻辑：默认 false；开后 turnArgs 含 true                            |

### 1.3 F6 — 历史条数 policy

| 项       | 内容                                                                 |
| -------- | -------------------------------------------------------------------- |
| **要做** | `agentMaxHistoryMessages?`；`buildAgentConfig`：`policy ?? envelope` |
| **代码** | `workspace-policy.ts`；`lawmind-server-helpers.ts`                   |
| **验收** | policy=40 → config.maxHistoryMessages=40                             |

### 1.4 C11 — LexEdge

| 项       | 内容                                                                       |
| -------- | -------------------------------------------------------------------------- |
| **要做** | `buildAdaptersFromEnv` push `createLexEdgeAdapterFromEnv()`（无 env 则空） |
| **代码** | `engine-tool-shared.ts`                                                    |
| **验收** | 有 LEXEDGE env 时 adapter id 出现                                          |

### 1.5 E3 — stop sequences

| 项       | 内容                                                                            |
| -------- | ------------------------------------------------------------------------------- |
| **要做** | CustomModel / AgentModelConfig 可选 `stop: string[]`；`callModelOnce` 写入 body |
| **代码** | types / custom-store / resolve / runtime-model-call；设置页可选                 |
| **验收** | 有 stop 时请求体含 stop                                                         |

### 1.6 C12 — Role allowlist UI

| 项       | 内容                                                |
| -------- | --------------------------------------------------- |
| **要做** | RoleDetail 展示「工具不限制」或名单；显式空数组告警 |
| **代码** | `LawmindSettingsRoles.tsx`                          |
| **验收** | 文案可见                                            |

---

## 2. R4b — 中项（约 2–3 人日）

### 2.1 D8 — 澄清 key 保留

| 项       | 内容                                                         |
| -------- | ------------------------------------------------------------ |
| **要做** | 回合开始勿整表清空；仅清除本轮已答 key；system note 列出未决 |
| **代码** | `turn-orchestrator.ts` / finalize / prompt                   |
| **验收** | 未答全时下一轮 note 仍含 key                                 |

### 2.2 F2 / F3 — 编辑与工具轨迹

| 项       | 内容                                                                      |
| -------- | ------------------------------------------------------------------------- |
| **要做** | 编辑/重发前确认「将丢失工具证据」；pref 显示折叠工具行                    |
| **代码** | `useLawmindChatSend.ts`；`LawmindChatMessageRow` / messages column；prefs |
| **验收** | 有工具轮时 confirm；pref 开时可见 tool 摘要                               |

### 2.3 C3 — 沙箱步自动批

| 项       | 内容                                                                                                                                                           |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **要做** | policy `autoApproveSandboxWorkflowSteps`；Solo 或显式开时，sandbox 内 `execute_workflow` 可预填 `__approved` + 审计；Firm 默认关；永不自动批 `render_document` |
| **代码** | workspace-policy；tool-round / approval middleware                                                                                                             |
| **验收** | Solo+flag：workflow 不 pending；Firm：仍要批                                                                                                                   |

### 2.4 A6↑ — meeting-summary.md

| 项       | 内容                                                                  |
| -------- | --------------------------------------------------------------------- |
| **要做** | append 时滚动写 `meeting-summary.md`；会议室指令注入摘要摘录 + 近期尾 |
| **代码** | `team-meeting.ts`；chat meetingMode                                   |
| **验收** | 文件存在；prefix 含摘要                                               |

---

## 3. R4c — E7 最小可用（约 1–1.5 人日）

| 项       | 内容                                                                                                              |
| -------- | ----------------------------------------------------------------------------------------------------------------- |
| **要做** | models store 可选 `workerModelId`；tool loop 用 worker，缺省回退主模型；设置页双槽（主=顾问/终稿，worker=工具轮） |
| **不做** | 完整 advisor 路由矩阵、按 taskKind 自动切换终稿                                                                   |
| **验收** | 配置 worker 后 tool round 走 worker model id（可测 resolve）                                                      |

---

## 4. 明确仍不做

- 拆律师审批终点 / 正式 render 门禁
- 静默 auto-adopt 记忆
- Firm 默认全网开放
- 完整 embedding RAG

---

## 5. 收口检查

1. ~~改完更新本文件 + REMAINING-PLAN §0~~
2. ~~colocated 测试~~（custom-store / C3 gate / F6 / A6↑ / plan envelope）
3. ~~CHANGELOG Unreleased~~
4. 可关：`workerModelId` 空=同主模型；`autoApproveSandboxWorkflowSteps` 默认关；会议室开网默认关；`LAWMIND_LEXEDGE_ENDPOINT` 未设则空

_R4a→R4b→R4c 已落地（2026-07-23）。_
