# LawMind 与 OpenClaw：工程上如何取长补短

OpenClaw 在 **agent 循环、多通道、扩展与分发** 上很成熟。LawMind **不复制其全部产品形态**；在工程上吸收可复用部分，在 **法律交付、可审计、可追责** 上**强于通用助手**。在**产品主张**上，LawMind 在个人律师场景要对齐并**压过** OpenClaw 式通用路线：不是多聊几句，而是**把律师日常里可交办的事做成可验收闭环**（工作面持续扩展，**不**把自己降格为「合同撰写器」）。

---

## 取 OpenClaw 之长

| 方面         | 做法（LawMind）                                                                                                                                                              |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 工具与多轮   | Agent + engine 桥接（`engine-tools`）、会话持久化、可测 runtime                                                                                                              |
| 可运维       | `/api/health` 聚合适配层状态：`modelConfigured`、`retrievalMode`、`lawmindAgentBehaviorEpoch`、`lawmindClarificationProtocol`、**edition 与 feature 快照**（与桌面设置一致） |
| 长任务可观测 | 工作流 Job 进度落盘 + **`GET /api/jobs/:id/stream`（SSE）** 推送；桌面 `EventSource` 订阅（当前任务 + 近期列表有限并发），类 gateway 事件流、减少纯轮询                      |
| 日常任务面   | 路由 + 模板 + 交付规格与验收，指向**多类律师日常工作**（不限合同），与「单点写作工具」错位                                                                                   |
| 本地优先     | 桌面与 workspace 为真相源，密钥与 policy 分轨                                                                                                                                |

## 补 OpenClaw 之短（法律场景）

| 方面           | 做法（LawMind）                                                                                         |
| -------------- | ------------------------------------------------------------------------------------------------------- |
| 信任与交付     | DFA 验收门、`validateDraftAgainstSpec`、**启发式正文密度**（`draft-sanity` + validator 警告）作第二道线 |
| 先澄清、再执行 | 协议 + UI 会话条 + `clarificationProtocol` 版本标记                                                     |
| 责任边界       | 审计事件、审核台、版本封装（Solo / Firm / Private Deploy）在 health 的 `edition.features` 可核对        |

## 维护者快查

- 行为与 prompt 大改：升 `LAWMIND_AGENT_BEHAVIOR_EPOCH`（`src/lawmind/agent/system-prompt.ts`）。
- 澄清交互协议变更：升 `lawmindClarificationProtocol`（`lawmind-server-route-health.ts`）并同步本页与 [LawMind 桌面端 UI 设计约定](/LAWMIND-DESKTOP-UI)。
- `POST /api/chat`：`runTurn` 返回的 `memoryContext` 用于构建 `memorySources`，避免在同一次对话轮次内第二次调用 `loadMemoryContext`（缺失时再 fallback）。
- 后台工作流 Job：`GET /api/jobs/:id/stream`（SSE）与 `LawmindSettingsCollaboration` 中 `MAX_RECENT_JOB_SSE`（近期列表并发上限）；详见 [架构文档](/LAWMIND-ARCHITECTURE) Phase 7.x。

相关：[LawMind 愿景](/LAWMIND-VISION)、[LawMind 2.0 strategy](/LAWMIND-2.0-STRATEGY)、[LawMind 工程记忆](/LAWMIND-PROJECT-MEMORY)。

官方文档：<https://docs.lawmind.ai>
