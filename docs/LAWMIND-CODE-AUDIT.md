# LawMind 代码审计报告（死代码 / 历史遗留 · 交付质量拖累点）

- 审计日期：2026-10-17
- 审计口径：**仅以代码为据**（`src/lawmind/`、`apps/lawmind-desktop/`、`scripts/`、`apps/lawmind-commercial-bff/`），未阅读 `docs/` 作判断。所有路径为仓库根相对路径；行号以审计时工作树快照为准。
- 姊妹篇：硬编码管线与参数全表见 [`docs/LAWMIND-HARDCODED-CATALOG.md`](./LAWMIND-HARDCODED-CATALOG.md)。
- 本报告**只出结论，不动代码**。

## 方法

1. 对 2,564 个 `.ts/.tsx/.mts/.js/.mjs/.cjs` 文件构建静态 import 图（含 `import`/`export ... from`/`import()`/`require`，相对路径解析；`scripts/` 只作导入方不计入候选）。
2. 零导入文件 → 人工排除真入口（package.json 钩子、Vite/Electron 入口、被打包的服务端、字符串引用的子进程、`?raw` 导入等），再从确认死亡的种子做**传递闭包**。渲染层已验证无 `import.meta.glob`、无变量 `import()`、仅 1 处静态字符串 `React.lazy`，闭包成立。
3. 导出符号审计：`src/lawmind` 875 个非桶非测试文件的 4,000+ 个导出符号逐一全仓 fixed-string 检索。
4. 端点审计：每个疑似端点全仓 fixed-string 检索调用方（含渲染层、Electron、word-addin 资源、e2e、scripts）。
5. git 信号：仓库历史仅 91 个提交、始于 2026-09-22，「6 个月未动」信号不适用，改用「首提交后从未被碰」作弱旁证。
6. 质量拖累审计：逐文件精读路由/意图/起草/上下文/门禁链路，区分「法律领域必要的确定性约束」与「限制模型能力的硬编码」。

## 总览

| 类别                                    | 数量                                                                                  | 规模               |
| --------------------------------------- | ------------------------------------------------------------------------------------- | ------------------ |
| [SAFE-DELETE] 渲染层退役集群            | **104 文件**                                                                          | **≈18,020 LOC**    |
| [SAFE-DELETE] 无调用方 HTTP 端点        | **35 处定义 / 38 个端点实例**（19 个路由文件）；附录 B 的 B.62 按可调用路径计为 36 条 | 粗估 800–1,200 LOC |
| [SAFE-DELETE] 引擎零导入 / 测试孤岛文件 | 10 文件                                                                               | ≈1,465 LOC         |
| [SAFE-DELETE] 完全死导出符号            | 65 符号（45 文件）                                                                    | 符号级             |
| [CONFIRM] 需 owner 拍板                 | 7 组                                                                                  | 见 1.5             |
| [KEEP-BUT-DOCUMENT] 在用但像遗留        | 10 组                                                                                 | 见 1.6             |
| 爆炸半径（删集群需连带处理的测试文件）  | 37 个测试文件                                                                         | —                  |
| 质量拖累主发现（限制模型能力的硬编码）  | 15 条（高 7 / 中高 1 / 中 6 / 低中 1）                                                | 见第二部分         |
| 已核实合理的确定性约束                  | 9 组                                                                                  | 见 2.3             |

---

# 第一部分：可删除的历史遗留代码

## 1.0 Top 15 最高置信删除候选

| #   | 目标                                                                                                                       | 一句话证据                                                                                                                                                                                  |
| --- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `apps/lawmind-desktop/src/renderer/matter/` 整目录旧 Matter 工作台（≈50 文件 7,943 LOC）                                   | import 图闭包：唯一入口 `MatterWorkbench.tsx`←仅 `app/MatterView.tsx`（无人渲染）；e2e `matter-cockpit.spec.ts:5` 自述「not the retired cockpit page」                                      |
| 2   | 在办/Fleet 树 `LawmindAgentFleetPanel.tsx` 等（13 文件 ≈3,900 LOC）                                                        | `LawmindAgentFleetPanel` 唯一导入者是死的 `app/AgentFleetView.tsx`；e2e `agent-fleet.spec.ts` 断言 `lm-tab-agents` 数量为 0                                                                 |
| 3   | 会议室树 `MatterTeamMeeting*.tsx` + `lawmind-meeting-*.ts`（9 文件 ≈1,800 LOC）                                            | `MatterTeamMeetingPanel` 唯一导入者是死的 `app/MeetingView.tsx`；e2e `meeting-flow.spec.ts` 标题「会议室已退出主路径」                                                                      |
| 4   | `apps/lawmind-desktop/src/renderer/MemoryInspector.tsx`（785 LOC）                                                         | 全仓 0 处模块导入（命中均为 `onOpenMemoryInspector` prop 名与另一组件 `MatterMemoryInspector`）                                                                                             |
| 5   | `apps/lawmind-desktop/src/renderer/HelpPanel.tsx`（81 LOC）                                                                | `setShowHelp(true)` 全仓零调用，`showHelp` 恒为 `false`（`lawmind-app-shell.ts:158`），面板永远渲染不到                                                                                     |
| 6   | 退役模板端点 5 个（`apps/lawmind-desktop/server/lawmind-server-route-templates.ts`，50 LOC 整文件）                        | `/api/templates/scan\|register\|enabled\|uploaded\|built-in` 全仓 fixed-string 0 调用方；其 `built-in` 还 shadow 了 `route-memory-templates.ts:56` 的同名端点                               |
| 7   | `matter-replica` 7 个端点（`lawmind-server-route-matter-replica.ts:194,381,625,755,765,780,800`）                          | `audit-report / scheduler tick / members revoke / ops / feed / materials / materials publish` 均 0 调用方                                                                                   |
| 8   | `apps/lawmind-desktop/src/renderer/canvas/acceptance-canvas.ts`（330 LOC）                                                 | `renderAcceptanceCanvas` 等 7 个导出全仓 0 调用（仅 2 个测试文件导入）                                                                                                                      |
| 9   | `host-access` 4 个 HTTP 端点（`lawmind-server-route-host-access.ts`，79 LOC 整文件）                                       | `/api/host-access*` 全仓 0 调用方；Electron 侧走 IPC 而非 HTTP                                                                                                                              |
| 10  | `src/lawmind/ingest/ocr/index.ts`（135 LOC）                                                                               | 唯一导入者是自身测试；全仓其它命中仅 1 行注释（`review-table-extract.ts:8`）                                                                                                                |
| 11  | `src/lawmind/json/omit-top-level-keys.ts`（173 LOC）                                                                       | 唯一导入者是自身测试；`lawmind/json` 全仓 0 生产导入                                                                                                                                        |
| 12  | 4 个死桶文件 `intent/index.ts` / `lint/index.ts` / `research/index.ts` / `host-access/index.ts`（合计 215 LOC）            | 0 导入者；消费方全部直引子模块                                                                                                                                                              |
| 13  | `ethics-wall` 2 端点（`lawmind-server-route-mail.ts:88,98`）                                                               | `/api/ethics-wall` 与 `/acknowledge` 全仓 0 调用方（引擎模块 `policy/ethics-wall.ts` 本身存活，不受影响）                                                                                   |
| 14  | `use-plan-handoff.ts` / `use-api.ts` / `useLawmindMutation.ts` / `useLawyerDeskDashboard.ts` 等 8 个渲染层散件（≈650 LOC） | 全部 0 非测试导入 + 文件名字符串全仓 0 引用；`use-api.ts:1` 自带「TODO migrate」遗弃标记                                                                                                    |
| 15  | `src/lawmind/application/services/*-worker.mjs` 5 个 worker（75 LOC）                                                      | 生产服务 `approval-service.ts` / `queue-write-service.ts` / `deadline-service.ts` 中无 `fork/spawn/Worker/execFile/child` 任何痕迹；仅测试以 `WORKER_PATH` 字符串引用——生产路径已拆除的遗留 |

## 1.1 [SAFE-DELETE] 渲染层退役集群（104 文件，≈18,020 LOC）

**证据链**：① import 图（2,564 文件）中每个文件的非测试导入者均为空或均在死亡集合内（传递闭包）；② 渲染层无动态 glob/lazy 注册；③ e2e 规格三处自述退役；④ 闭包内 104 文件与当前未提交改动零交集；⑤ 全部文件最后提交落在 2026-09-22…30（新一代工作台 10 月起在 `LawmindLawyerWorkbench` / `LawmindMiddleDraftDesk` 等文件演进）。

**子集群**：

- **旧 Matter 工作台**（`renderer/matter/` 整目录 + `app/MatterView.tsx` + `MatterWorkbench.tsx` + `useMatterWorkbench*.ts` + `stores/matter-overview-view-store.ts` 等，≈50 文件 7,943 LOC）
- **在办/Fleet**（`LawmindAgentFleet*.tsx`、`lawmind-fleet-*.ts`、`useLawmindFleetCeremonyActions.ts`、`stores/fleet-desk-view-store.ts`、`app/AgentFleetView.tsx` 等 13 文件 ≈3,900 LOC）
- **会议室**（`MatterTeamMeeting*.tsx`、`lawmind-meeting-*.ts`、`useMatterTeamMeetingDeliberation.ts`、`app/MeetingView.tsx` 等 9 文件 ≈1,800 LOC）
- **散件**：`HelpPanel.tsx`、`MemoryInspector.tsx`、`LawmindChatThoughtPanel.tsx`、`LawmindChatExecutionTrace.tsx`、`LawmindDeskDashboardSummary.tsx`、`LawmindJudgmentItemsPanel.tsx`、`LawmindApprovalDocReader.tsx`、`LawmindApprovalQueue.tsx`、`LawmindFleetPostApproveBar.tsx`、`LawmindMatterContextMenu.tsx`、`app/ReviewView.tsx`、`canvas/acceptance-canvas.ts`、`insights/`（InteractionConvergence/LawyerActionFeed/ProductExperiments）、`settings/SettingsLayout.tsx`、`lawmind-{approval-template,chat-thought-view,execution-state-label,execution-status-label,internal-flags,lawyer-vocabulary,model-service-status,post-approve-export}.ts`、`use-{api,plan-handoff,LawmindMutation,LawyerDeskDashboard}.ts`
- **引擎侧陪葬**：`src/lawmind/insights/` 6 文件（compute-behavior-summary / compute-convergence-hints / compute-product-experiments / compute-roadmap-cards / index / types，仅服务退役的 insights UI）

**连带说明**：

- `apps/lawmind-desktop/src/renderer/app/pickMainBodyBranchProps.ts` 中 `pickMatterViewProps`(L41)、`pickMeetingViewProps`(L70)、`pickReviewViewProps`(L84)、`pickAgentFleetViewProps`(L142) 四个导出仅被自身测试使用（`LawmindMainBodyContent.tsx:24` 只用 `pickLawyerWorkbenchProps`），应随集群做**部分删除**。
- 37 个测试文件导入集群内模块（完整清单见 1.7），需同批删除/改写。
- `lawmind-app-root.tsx` 中 `matterCockpitOpen` 状态名是遗留命名但**功能存活**（驱动 header/sidebar 走向新律师工作台，`LawmindAppHeader.tsx:94`），不在删除范围——见 1.6 K5。

## 1.2 [SAFE-DELETE] 无调用方 HTTP 端点（35 处定义 / 38 个端点实例）

> 计数口径：`35 处定义` 含 1 条被 shadow 的不可达分支与 2 条只被测试引用的变体；`附录 B` 的 B.62 只列**实际可调用**的路径，因此是 36 条。两处不矛盾，只是分母不同。

统一证据：每个端点路径做全仓 fixed-string 检索（排除 docs 与路由文件自身），调用方命中均为 0（含渲染层、Electron、`resources/word-addin/*.js`、e2e 规格、scripts）。处理函数确实注册于 `lawmind-server-route-registry.ts`（即「活着但无人用」），删除时需「处理块 + 注册行」一起删。

| 端点                                                                                | 定义位置                                                                                                |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| POST `/api/templates/scan`                                                          | `lawmind-server-route-templates.ts:25`                                                                  |
| POST `/api/templates/register`                                                      | 同上 :26                                                                                                |
| POST `/api/templates/enabled`                                                       | 同上 :27                                                                                                |
| GET `/api/templates/uploaded`                                                       | 同上 :44                                                                                                |
| DELETE `/api/templates/uploaded`                                                    | 同上 :34                                                                                                |
| GET `/api/templates/built-in`（route-templates 版）                                 | 同上 :39                                                                                                |
| GET `/api/templates/built-in`（route-memory-templates 版，**被 shadow、永不可达**） | `lawmind-server-route-memory-templates.ts:56`                                                           |
| GET `/api/acceptance-sheet/locate`                                                  | `lawmind-server-route-acceptance-sheet.ts:122`                                                          |
| GET `/api/acceptance-sheet/page`                                                    | 同上 :147                                                                                               |
| GET `/api/mcp/servers`                                                              | `lawmind-server-route-mcp.ts:49`                                                                        |
| PUT `/api/mcp/servers`                                                              | 同上 :63                                                                                                |
| POST `/api/mcp/servers/:id/test`                                                    | 同上                                                                                                    |
| GET `/api/tools/registry`                                                           | `lawmind-server-route-tools-registry.ts:8`                                                              |
| POST `/api/assistants/profile/learning`                                             | `lawmind-server-route-review.ts:428`                                                                    |
| POST `/api/lawyer-profile/learning`（仅测试 mock 命中）                             | 同上 :393                                                                                               |
| GET `/api/judgment/summary`                                                         | `lawmind-server-route-judgment.ts:75`                                                                   |
| POST `/api/automations/mail/seed`（还需 `LAWMIND_MAIL_SEED=1`）                     | `lawmind-server-route-automations.ts:296`                                                               |
| GET `/api/matter-replica/audit-report`                                              | `lawmind-server-route-matter-replica.ts:194`                                                            |
| POST `/api/matter-replica/scheduler/tick`                                           | 同上 :381                                                                                               |
| POST `/api/matter-replica/members/revoke`                                           | 同上 :625                                                                                               |
| GET `/api/matter-replica/ops`                                                       | 同上 :755                                                                                               |
| GET `/api/matter-replica/feed`                                                      | 同上 :765                                                                                               |
| GET `/api/matter-replica/materials`                                                 | 同上 :780                                                                                               |
| POST `/api/matter-replica/materials/publish`                                        | 同上 :800                                                                                               |
| GET `/api/queues`                                                                   | `lawmind-server-route-matters.ts:1131`                                                                  |
| GET `/api/daemon/log`                                                               | `lawmind-server-route-daemon.ts:75`                                                                     |
| GET `/api/host-access` + `/log` + POST `/index/rebuild` + `/session-command`        | `lawmind-server-route-host-access.ts:16,40,56,67`（桌面走 IPC 而非 HTTP）                               |
| POST `/api/policy/workspace/recommended-allowlist`                                  | `lawmind-server-route-platform.ts:126`                                                                  |
| GET `/api/word-addin/matters`                                                       | `lawmind-server-route-word-addin.ts:65`（taskpane.js / wps/main.js 均无调用）                           |
| GET `/api/metrics/north-star-trend`                                                 | `lawmind-server-route-metrics.ts:65`                                                                    |
| POST `/api/routing/resolve`                                                         | `lawmind-server-route-routing.ts:73`                                                                    |
| GET `/api/fs/pdf-preview`                                                           | `lawmind-server-route-fs.ts:168`（桌面 PDF 预览在渲染进程 pdf.js；该路由文件仍活跃，删块时注意 rebase） |
| POST `/api/sessions/:sessionId/resume-paused`                                       | `lawmind-server-route-sessions.ts:658`（仅测试命中字面量）                                              |
| GET `/api/ethics-wall`                                                              | `lawmind-server-route-mail.ts:88`                                                                       |
| POST `/api/ethics-wall/acknowledge`                                                 | 同上 :98                                                                                                |

**Shadowing 证据**：`lawmind-server-route-registry.ts` 注释自承「first match wins」，`handleTemplateRoutes` 注册于 L75、`handleMemoryAndTemplateRoutes` 注册于 L121；两文件均匹配 `GET /api/templates/built-in`（`route-templates.ts:39` vs `route-memory-templates.ts:56`），后者为永不可达代码。

## 1.3 [SAFE-DELETE] 引擎零导入 / 测试孤岛文件

| 文件                                                        | LOC     | 证据                                                                                                                                           |
| ----------------------------------------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lawmind/json/omit-top-level-keys.ts`                   | 173     | import 图 0 生产导入者；`lawmind/json` 全仓仅自身测试命中                                                                                      |
| `src/lawmind/ingest/ocr/index.ts`                           | 135     | 唯一导入者自身测试；另一命中为注释（`deliverables/review-table-extract.ts:8`）                                                                 |
| `src/lawmind/application/domain-state.ts`                   | 14      | 0 导入者 + `domain-state` 字符串全仓 0 引用                                                                                                    |
| `src/lawmind/intent/index.ts`（桶）                         | 82      | 0 导入者；消费方直引 `intent/compile-intent.js` 等子模块                                                                                       |
| `src/lawmind/lint/index.ts`（桶）                           | 41      | 0 导入者；消费方直引 `lint/self-revise.ts`、`lint/types.ts`                                                                                    |
| `src/lawmind/research/index.ts`（桶）                       | 41      | 0 导入者；消费方直引 `research/outline-hitl.js`                                                                                                |
| `src/lawmind/host-access/index.ts`（桶）                    | 51      | 0 导入者；`route-host-access.ts` 直引 4 个子模块                                                                                               |
| `src/lawmind/compile/legal-elements-fill.ts`                | 33      | 唯一导入者 `compile/compile-fill.test.ts`；compile/ 其余 5 文件经 `reasoning/keyword-draft.ts:8,12,13` 存活（**纠正：compile/ 目录整体不死**） |
| `src/lawmind/application/services/*-worker.mjs` 5 个 worker | 合计 75 | 生产服务无 `fork/spawn/Worker/child_process`；仅 3 个测试以路径字符串引用                                                                      |
| `src/lawmind/evaluation/replay-gate-mapping.ts`             | 170     | 唯一导入者 `evaluation/replay-fixtures.test.ts`（测试孤岛）                                                                                    |

> 下列同样「零生产导入 + 仅自身测试」、可连同测试一并删除，但因或为预留注册表/语料性质，建议 owner 过目后定：`src/lawmind/guardian/role-checklist.ts`（44）、`src/lawmind/skills/skill-match.ts`（50）、`src/lawmind/product/lawyer-pause-registry.ts`（77）、`src/lawmind/metrics/unescalated-delivery.ts`（237）、`src/lawmind/evaluation/offline-diagonal-simulator.ts`（244）。

## 1.4 [SAFE-DELETE] 完全死导出符号（65 个；定义后全仓 0 引用、文件内 0 自用）

方法：4,000+ 导出符号全仓 fixed-string 检索 0 命中（含测试与 scripts），再过滤文件内自用。另有 **511 个「导出无人用但文件内自用」** 的符号（仅 `export` 关键字多余，优先级低，不逐一列）。文件最后提交 ≥2026-10-01 的（活跃开发中）标 ⚠️，建议降为 [CONFIRM]。

| 文件                                                   | 符号                                                                                  | 备注            |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------- | --------------- |
| `src/lawmind/research/research-protocol.ts`            | `shouldEnforceStatuteTrial`                                                           | ⚠️ 2026-10-10   |
| `src/lawmind/research/research-evidence-gate.ts`       | `hasRetrievalFailureRiskFlags`                                                        |                 |
| `src/lawmind/insights/session-timeline.ts`             | `buildMatterUnifiedTimeline`                                                          |                 |
| `src/lawmind/artifacts/word-revision-delivery.ts`      | `isWordBaselineFilename`                                                              |                 |
| `src/lawmind/artifacts/matter-word-delivery.ts`        | `formatDeliveryTimeStamp`                                                             |                 |
| `src/lawmind/lint/lpr-quotes.ts`                       | `LPR_QUOTES_VERSION`、`LPR_QUOTES_SOURCE`                                             |                 |
| `src/lawmind/core/practice-personas.ts`                | `PRACTICE_AREA_LABELS`                                                                |                 |
| `src/lawmind/desk/desk-write-journal.ts`               | `listDeskWrites`                                                                      |                 |
| `src/lawmind/desk/intake-promote.ts`                   | `isKnownPartyRole`                                                                    |                 |
| `src/lawmind/memory/memory-target-path.ts`             | `memoryTargetLabel`                                                                   |                 |
| `src/lawmind/memory/session-summary.ts`                | `isAllowedSessionSummaryWrite`                                                        |                 |
| `src/lawmind/memory/kernel/contract.ts`                | `defaultConfirmation`                                                                 |                 |
| `src/lawmind/matter-cloud/desktop-bridge.ts`           | `hasLocalInviteRecord`                                                                |                 |
| `src/lawmind/mail/watch-contacts.ts`                   | `matchWatchContactLabel`                                                              |                 |
| `src/lawmind/learning/draft-edit-learning.ts`          | `draftSectionsOf`                                                                     | ⚠️ 2026-10-01   |
| `src/lawmind/drafts/minimal-edit-script.ts`            | `MINIMAL_EDIT_RULE_TEXT`                                                              |                 |
| `src/lawmind/drafts/provenance.ts`                     | `actorLabel`                                                                          |                 |
| `src/lawmind/drafts/contract-review-edits.ts`          | `formatStructuredEditsSection`                                                        |                 |
| `src/lawmind/drafts/word-surface.ts`                   | `readDocxParagraphs`                                                                  | ⚠️ 2026-10-10   |
| `src/lawmind/drafts/word-revision/document.ts`         | `materializeLayoutBlocks`                                                             | ⚠️ 2026-10-10   |
| `src/lawmind/drafts/redline-proposal.ts`               | `redlineMatchesDraft`                                                                 | ⚠️ 2026-10-01   |
| `src/lawmind/drafts/apply-surgical-edits.ts`           | `tryNarrowSurgicalEdit`、`explainNonMinimalSurgicalEdit`、`applySurgicalEditsToDraft` |                 |
| `src/lawmind/drafts/contract-edit-baseline.ts`         | `resolveFirstExistingDocxBaseline`                                                    |                 |
| `src/lawmind/platform/action-pre-review.ts`            | `actionPreReviewLogExists`                                                            | ⚠️ 2026-10-01   |
| `src/lawmind/platform/outbound-proxy.ts`               | `outboundProxy`                                                                       |                 |
| `src/lawmind/platform/requires-action.ts`              | `buildMatterApprovalAction`                                                           | ⚠️ 2026-10-01   |
| `src/lawmind/runtime/turn-admission.ts`                | `RESOURCE_LEASE_WORD`                                                                 | ⚠️ 未提交新文件 |
| `src/lawmind/cases/team-roster.ts`                     | `emptyTeamRoster`                                                                     |                 |
| `src/lawmind/host-access/host-store.ts`                | `clearSessionHostAccess`                                                              |                 |
| `src/lawmind/agent/assistant-turn-gate.ts`             | `isAssistantTurnLeaseLive`                                                            |                 |
| `src/lawmind/agent/tools/disclosed-turn-tools.ts`      | `collectRegisteredMcpToolNames`                                                       | ⚠️ 2026-10-09   |
| `src/lawmind/agent/tool-budget.ts`                     | `formatToolBudgetContinueReply`                                                       | ⚠️ 2026-10-07   |
| `src/lawmind/agent/context-tuning.ts`                  | `MID_TURN_ELIDE_KEEP_TAIL`                                                            |                 |
| `src/lawmind/agent/turn-interrupt.ts`                  | `formatInterruptedTurnNote`、`viewTurnsForLawyer`                                     |                 |
| `src/lawmind/agent/context-preset.ts`                  | `conversationLengthLabel`                                                             |                 |
| `src/lawmind/agent/context-isolation-budget.ts`        | `isolationBudgetUsed`                                                                 |                 |
| `src/lawmind/agent/turn-orchestrator-events.ts`        | `collectRecentToolNamesFromSession`                                                   |                 |
| `src/lawmind/agent/sidecar-resume.ts`                  | `clipParentWorkerDraft`                                                               |                 |
| `src/lawmind/agent/turn-abort.ts`                      | `getTurnAbortSignal`                                                                  |                 |
| `src/lawmind/mcp/readonly-tools.ts`                    | `mcpSearchWorkspaceIndex`                                                             |                 |
| `src/lawmind/models/resolve.ts`                        | `resolveContextTokensForModelId`                                                      | ⚠️ 2026-10-09   |
| `src/lawmind/reasoning/scene-draft.ts`                 | `CIVIL_STAGE_INSTRUCTION_RE`                                                          |                 |
| `src/lawmind/reasoning/draft-critic.ts`                | `critiqueDraftWithModel`                                                              |                 |
| `src/lawmind/integrations/word-addin/addin-assets.ts`  | `readWordAddinAssetFile`                                                              |                 |
| `src/lawmind/deliverables/review-table.ts`             | `reviewTableContentColumns`                                                           |                 |
| `src/lawmind/deliverables/placeholder-pattern.ts`      | `SCAFFOLD_PLACEHOLDER_SOURCE`                                                         |                 |
| `src/lawmind/retrieval/providers/lexis/placeholder.ts` | `LEXIS_PROVIDER_STATUS`                                                               |                 |
| `src/lawmind/evaluation/golden-recall.ts`              | `scoreAgainstQuery`                                                                   |                 |
| `src/lawmind/evaluation/human-baseline.ts`             | `HUMAN_BASELINE_TASK_TYPE_LABELS`、`formatHumanBaselineReport`                        |                 |
| `src/lawmind/templates/draft-template-values.ts`       | `DRAFT_FIELD_HELP`                                                                    |                 |
| `src/lawmind/litigation/litigation-fee.ts`             | `LITIGATION_FEE_VERSION`                                                              |                 |
| `src/lawmind/skills/lawyer-capabilities.ts`            | `getLawyerCapability`                                                                 | ⚠️ 2026-10-09   |
| `src/lawmind/skills/product-playbooks.ts`              | `productPlaybookDir`                                                                  |                 |
| `src/lawmind/application/matter-consistency.ts`        | `checkMatterCaseConsistency`                                                          |                 |
| `src/lawmind/application/domain-state.ts`              | `domainStateModuleMarker`                                                             |                 |
| `src/lawmind/matter-replica/membership.ts`             | `membershipExists`、`membershipRelDir`                                                |                 |
| `src/lawmind/matter-replica/materials-blobs.ts`        | `isPathLockedByOther`                                                                 |                 |
| `src/lawmind/policy/judgment-tiering.ts`               | `JUDGMENT_TIERING_MODES`                                                              | ⚠️ 2026-10-07   |
| `src/lawmind/policy/workspace-policy.ts`               | `LAWMIND_EGRESS_MODES`                                                                | ⚠️ 2026-10-07   |

## 1.5 [CONFIRM]（需 owner 拍板）

| #   | 目标                                                                                                                                                                              | 证据                                                                                                                                                  |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| C1  | `softAsk` 死管线（`src/lawmind/intent/types.ts:39,75` → `turn-orchestrator.ts:682` → `turn-orchestrator-events.ts:235` → `route-chat.ts:597` → 渲染层 `lawmind-chat.ts:125,585`） | 全仓不存在任何 `softAsk` 的生产者（唯一赋值均为 `...(x.softAsk ? {softAsk} : {})` 透传与类型声明）；数据从未流动。可能是预留特性接缝，删除涉及 5 文件 |
| C2  | `apps/lawmind-commercial-bff/`（`stub-server.ts` + `README.md`）                                                                                                                  | 占位骨架：27 行 stub 恒 501，全仓 0 引用，README 自述「骨架占位」。属有意预留                                                                         |
| C3  | `src/lawmind/agent/cuad-official-clauses.ts`、`factor-state-legal-industry-fixtures.ts`、`legal-bench-metrics.ts`                                                                 | 是被存活测试使用的夹具，删除会破坏在跑的测试。**建议保留**                                                                                            |
| C4  | `src/lawmind/intent/gold-set.ts`                                                                                                                                                  | 仅 `gold-set.test.ts` 导入，但该测试是对存活模块 `compile-intent.ts` 的金标评测。建议保留                                                             |
| C5  | `guardian/role-checklist.ts`、`skills/skill-match.ts`、`product/lawyer-pause-registry.ts`、`metrics/unescalated-delivery.ts`、`evaluation/offline-diagonal-simulator.ts`          | 纯测试孤岛（见 1.3 末注），从严可删，合计 ≈652 LOC                                                                                                    |
| C6  | 1.4 中 ⚠️ 标记的 14 个死符号（位于 2026-10 月活跃文件）                                                                                                                           | 符号级 0 引用属实，但文件在活跃演进，可能是进行中工作的下一步接线                                                                                     |
| C7  | `src/lawmind/review/cli.ts`                                                                                                                                                       | 唯一导入者 `scripts/lawmind/lawmind-smoke.ts`（`lawmind:smoke`）——工具链可达但无产品路径                                                              |

## 1.6 [KEEP-BUT-DOCUMENT]（在用但像遗留）

| #   | 目标                                                                                                                                                                                                                                                   | 说明                                                                                                          |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| K1  | `src/lawmind/integration/`（3 个测试文件）                                                                                                                                                                                                             | 「零外部导入」属实，但目录只有测试且被 vitest 正常执行——是测试套件目录而非死代码                              |
| K2  | `src/lawmind/ops/multitask-observability.ts`                                                                                                                                                                                                           | 「1 import」核实：经 `lawmind-health-payload.ts:21,500` → `route-health`/`route-bootstrap` 生产可达。**存活** |
| K3  | `src/lawmind/compile/`（除 `legal-elements-fill.ts`）                                                                                                                                                                                                  | **纠正**：经 `reasoning/keyword-draft.ts:8,12,13` 导入 3 个 adapters——**生产存活**                            |
| K4  | 脚本单点模块：`mcp/readonly-tools.ts`、`evaluation/release-artifacts.ts`、`metrics/firm-calibrator.ts`、`platform/ops-doctor.ts`、`retrieval/providers/open-law/dump-convert.ts`、`desk/seed-sample-desk.ts`、`skills/census/external-skill-census.ts` | 均经 `scripts/lawmind/*` 可达且对应脚本在 package.json 注册——脚本基础设施，非死代码                           |
| K5  | `matterCockpitOpen` 状态命名（`lawmind-app-root.tsx:151` 等 20+ 处）                                                                                                                                                                                   | 名字来自退役 cockpit，但状态驱动现行 header/sidebar/律师工作台路由。建议改名文档化，勿删                      |
| K6  | `LEGACY_FINAL_SSE_ALIAS`（`route-chat.ts:511` ↔ `lawmind-chat.ts:53`）                                                                                                                                                                                 | 名称含 LEGACY 但双端均在使用中的兼容 SSE 事件别名                                                             |
| K7  | `@deprecated` 字段：`policy/workspace-policy.ts:241`、`server/lawmind-policy.ts:27`、`lawmind-panel-layout.ts:25`                                                                                                                                      | 有意保留的配置兼容层（对旧键给出拒绝提示）                                                                    |
| K8  | IPC 通道名双份字面量表                                                                                                                                                                                                                                 | `preload.cjs` 43 个 vs `ipc-handlers.mjs` 41 个 `lawmind:*` 字符串字面量，无共享常量模块——值得收敛但非删除项  |
| K9  | `apps/lawmind-desktop/server/dist/*.cjs`                                                                                                                                                                                                               | `lawmind:bundle:desktop-server` 产物且被 .gitignore 忽略——非镜像遗留                                          |
| K10 | `scripts/pre-commit/run-node-tool.sh`                                                                                                                                                                                                                  | 实际被 `git-hooks/pre-commit` 调用——存活                                                                      |

## 1.7 爆炸半径与删除建议

1. **渲染层集群（1.1）**：37 个测试文件导入集群模块，需同批删除/改写：
   `LawmindAgentFleetDetail.test.tsx`、`LawmindAgentFleetListAside.test.tsx`、`LawmindChatThoughtPanel.test.tsx`、`LawmindDeskDashboardSummary.test.tsx`、`LawmindJudgmentPanel.test.tsx`、`MemoryInspector.batch.test.tsx`、`app/MeetingView.test.tsx`、`canvas/acceptance-canvas.test.ts`、`canvas/typecheck-canvas.test.ts`、`lawmind-chat-thought-view.test.ts`、`lawmind-execution-state-label.test.ts`、`lawmind-fleet-{actions,docket,queue,queue-merge,selection}.test.ts`、`lawmind-lawyer-vocabulary.test.ts`、`lawmind-meeting-{chat,deliberation,interrupt,scope,session-storage}.test.ts`、`lawmind-model-service-status.test.ts`、`lawmind-post-approve-export.test.ts`、`matter/LawmindMatterHealthCard.test.tsx`、`matter/MatterCognitionPanel.test.tsx`、`matter/MatterOverviewBody.test.tsx`、`matter/MatterTaskBoard.test.tsx`、`matter/MatterWorkbenchTabs.test.tsx`、`matter/matter-display-labels.test.ts`、`matter/matter-roadmap-cards.test.tsx`、`matter/matter-task-board.test.ts`、`matter/review-matrix-notes.test.ts`、`settings/SettingsLayout.test.tsx`、`stores/fleet-desk-view-store.test.ts`、`stores/matter-overview-view-store.test.ts`、`src/lawmind/insights/insights.test.ts`，外加 `app/pickMainBodyBranchProps.test.ts` 中对 4 个死 pick 函数的断言、`LawmindAppRootView.test.tsx:58` 的 `showHelp` 固定值。
   e2e 三规格（`agent-fleet` / `meeting-flow` / `matter-cockpit.spec.ts`）本就是「断言入口不存在」，集群删除后仍然通过，可作回归网。
2. **建议顺序**：先删 1.1 集群（含 37 测试）→ 再删 1.2 端点块+注册行 → 再删 1.3 文件 → 最后按文件 owner 处理 1.4 符号与 1.5 CONFIRM 项。每步跑 `pnpm test` 与 `pnpm --filter lawmind-desktop typecheck`。
3. **样式连带**：集群删除后 `apps/lawmind-desktop/src/renderer/styles.css`、`styles/file-workbench.css` 中 `.lm-fleet-*` / `.lm-meeting-*` / `.lm-matter-*`（旧工作台）选择器大概率成为死 CSS，建议删集群后单独跑一轮 CSS 选择器审计（本报告未覆盖 CSS）。

## 1.8 系统性检查记录（含阴性结果）

| 检查                                                                            | 结果                                                                                                                                                                  |
| ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 零导入文件扫描（2,564 文件）                                                    | 55 个零非测试导入文件 → 排除 16 个真入口/动态加载 → 22 个种子 + 闭包 82 = 1.1 集群                                                                                    |
| 导出符号审计（875 文件 / 4,000+ 导出）                                          | 576 个导出全仓 0 引用 → 其中 65 个文件内也 0 自用（1.4），511 个仅 `export` 多余                                                                                      |
| 注释标记（`TODO.*删除/deprecated/legacy/废弃/遗留/不再使用/do not use/unused`） | 命中均为有意兼容层（K6/K7），另发现 `use-api.ts:1` 的迁移 TODO（已入 1.1）                                                                                            |
| `package.json` scripts ↔ `scripts/` 对账                                        | 引用文件全部存在；唯一「无引用」的 `scripts/pre-commit/run-node-tool.sh` 实被 `git-hooks/pre-commit` 调用                                                             |
| TS↔JS 镜像 / 重复实现                                                           | 未发现同名 TS/JS 镜像对；发现的重复为 IPC 通道双字面量表（K8）与 `templates/built-in` 双路由（1.2 shadowing）                                                         |
| 子进程/worker 字符串引用                                                        | `analysis-sandbox-child.ts`、`tool-sandbox-child.ts`、`requireCjs` 双 `.cjs`、`?raw` sandbox 均已排除；`application/services/*-worker.mjs` 5 文件确认仅测试字符串引用 |

---

# 第二部分：拖累交付物质量、未充分发挥模型能力的实现

> 目标：找出「硬编码规则/模板/截断替代了本可由模型做得更好的判断」从而拉低交付物质量的位置。
> 每条：证据（file:line 原文）→ 机制 → 质量影响 → 建议 → 严重度。
> 区分：(b) 限制能力的硬编码（主清单 2.1）与 (a) 法律领域必要的确定性约束（2.3 已核实合理）。

## 2.0 三大质量拖累（总体判断）

1. **模板填空起草链（F4+F2+F5）**：deliverableType 由正则判定 → 选中写死的章节骨架 → 模型只能在固定标题内扩写、失败即退回占位骨架；报告类更是整轮绕开主模型。**文书结构与内容深度由正则与模板决定，而非模型对案情的理解**——这是交付质量最直接的天花板。
2. **关键词路由/意图栈（F1+F3）**：从 TaskKind、风险级、能力绑定、Skill 注入到管线选择，全部由正则优先级链决定；误路由/误绑会级联到错误的模板、验收与章节骨架，且跨轮粘住。模型路由已存在但覆盖面窄、deliverableType 不在其 schema 内、多处入口直接绕开。
3. **上下文激进取舍（F6+F7）**：CASE 1600 字符、画像 800、素材 660 token、Skill 2000 token、每份材料 3000 字符——模型起草时看到的是被裁成残篇的案件与材料。输入侧营养不良，再强的模型也只能产出泛化文本。

## 2.1 主清单（b 类：限制能力的硬编码）

### F1. 关键词路由表决定 TaskKind / 风险级 / 输出格式，且多条路径完全绕开模型路由 —— 高

**证据**：`src/lawmind/router/keyword-route.ts:29-141`——`TASK_KIND_PATTERNS` 约 25 条顺序正则，首中即定：

```ts
{ pattern: /(?!.*(?:催告函|催款函|demand letter|催告|律师函))(?:合同|协议|条款)/i, kind: "analyze.contract" },
...
{ pattern: /检索|调研|整理|背景|研究/i, kind: "research.hybrid" },
{ pattern: /文件|文书|报告|word|docx/i, kind: "draft.word" },
```

`keyword-route.ts:143-157`——kind 直接映射风险级：`HIGH_RISK_KINDS = new Set<TaskKind>(["draft.word", "draft.ppt"])`。模型路由存在但只覆盖部分入口（`model-route.ts:249-253` 的 `routeAsync` 仅被 `engine.planAsync` 使用）。以下路径**直接调用同步关键词 `route()`，模型从不参与**：`agent/tools/lawmind-deep-research.ts:13`、`agent/tools/engine/engine-pipeline-tools.ts:35,76-83`、`agent/deliverable-pipeline.ts:5,24-26`、`router/intake-gate.ts:13,103`。

**机制**：指令先被 `stripRejectedContractReviewPhrases` 做人工维护的否定短语剥除（`intent/utterance-kind.ts:12-14`），再按正则表首中归类；kind 再决定 riskLevel（→ requiresConfirmation）、models 角色、输出格式。

**质量影响**：任何含「合同/协议/条款」而未命中前序规则的指令一律落 `analyze.contract`——「把这份合同里的违约金算一下」「整理协议时间线」会被路由成合同审查，下游拿到审查骨架与审查验收 spec 而不是计算/时间线管线。否定、反讽、复合指令一旦超出人工否定短语表就误路由，误路由 → 错误确认门槛、错误模板、错误验收清单、错误章节骨架（见 F4）。

**建议**：路由判断本是模型最擅长的事。把 `routeAsync` 模型分类作为**唯一**入口（deep_research、recover、deliverable-pipeline、intake 全部改走模型），关键词表仅作模型不可用时的降级；模型路由与关键词结果分歧从 shadow 记录升级为默认 escalate（现默认只记录，`model-route.ts:236-245`）。

### F2. deliverableType 永远由关键词检测决定，且会覆盖既有路由结果 —— 高

**证据**：`src/lawmind/router/deliverable-meta.ts:64-289`——`detectDeliverableType` 约 50 条顺序正则在 27+ 类型间判别；`:576-583` enrich 时除 5 个「锁定」研究类外 `detected` 直接替换既有值。模型路由（`routeWithModel`）的 JSON schema 里**根本没有 deliverableType 字段**（`model-route.ts:49-67`）。

**质量影响**：deliverableType 是下游一切的钥匙——验收 spec（`deliverables/registry.ts:488-501`：10 个具名 + `lawyer-work-specs.ts` 16 个 + `document.general`，共 27 个；`DeliverableType` 联合只有 26 个，`review.table` 靠 `(string & {})` 兜底）、必需章节（blocker）、默认模板、追问清单、章节骨架（F4）、guardian 是否适用（`guardian/legal-guardian.ts:46-59`）。一个正则漏判（如「通知函」进了 `letter.counsel` 而非 `letter.demand`）就整套换错。

**建议**：把 deliverableType 纳入模型路由 schema（enum 即现有 27+ 类型），关键词检测仅作模型失败回退与交叉验证；模型与关键词不一致时按分歧通道升级确认，而不是静默以关键词为准。

### F3. 规则意图编译器绑定「能力 + 管线 + Skill 注入」，全程无模型 —— 高

**证据**：`src/lawmind/intent/compile-intent.ts:1-16`（优先级注释）与 `:540-765`（主体）——注释自认「Fatal misbind pair: contract.review ↔ litigation.draft」。`intent/text-intent.ts:61-66,103-166` 动词与 19 个场景全靠正则；`intent/utterance-kind.ts:47-63,119-176` 「只看/寒暄/纯确认/续作」全是 anchored 正则表。

**机制**：`compileIntent` 依正则优先级链产出 `CompiledIntent{capabilityId, deliverableType, confidence, chain}`；confidence 本身也是规则给的（有材料即 high）。绑定结果决定注入哪 2 篇 Skill 正文（F13）、管线提示、交付物类型、验收 spec、计划种子。

**质量影响**：绑错能力 = 整轮注入错误的作业标准与错误管线提示。起诉状里大量引用合同条款，靠「文件名诉状头压过正文合同词」（`document-genre.ts:5-8`）这种补丁规则维持；`previousCapabilityId` 续作规则（`compile-intent.ts:711-724`）让误绑跨轮粘住。长尾表达（口语、委婉、复合指令）永远追不上正则补丁。

**建议**：在意图编译层引入小型模型判定（输入：指令 + 文件 peek + 上轮能力；输出：capabilityId + confidence + 证据），正则链降级为模型不可用时回退与低置信仲裁。误绑成本远高于一次 classify 调用成本。

### F4. 模板填空起草：20+ 类型各一套写死章节骨架，模型只能「改写正文、沿用标题」—— 高（全仓最大质量拖累之一）

**证据**：`src/lawmind/reasoning/keyword-draft.ts:413-461`（租赁合同 9 节逐字模板，占位符填充）：

```ts
{ heading: "合同当事人",
  body: `出租人（甲方）：${buildPlaceholder("出租人姓名/名称")}\n证件号码/统一社会信用代码：${buildPlaceholder("甲方证件号码")}...` }
```

同类：`buildGeneralContractSections`(:463)、`buildDemandLetterSections`(:498)、`buildComplaintSections`(:578)、`buildContractReviewSections`(:920-1015，固定 13 栏)、`buildResearchMemoSections`(:746) 等 20+ 个。即使有模型，也只能在骨架内扩写（`reasoning/model-draft.ts:130-148`「沿用这些章节标题，可改写正文，不要整表丢掉」；`:186-211` 规则尾巴章节强制拼接在后）。喂给模型的检索摘要也截断：`bundle.claims.slice(0, 12)`、`bundle.sources.slice(0, 8)`（`model-draft.ts:27-31`）。模型成稿失败则整稿退回骨架（`model-draft.ts:221-243`，`MODEL_DRAFT_FALLBACK_NOTE` 自述「不能当作成稿外发」）。

**质量影响**：文书的**结构**不由模型对案情、交易结构、争议点的理解决定，而由正则命中的类型决定——所有 `contract.rental` 共用同一副九节骨架，不管标的是商铺还是住宅。`buildContractReviewSections` 的「宏观/中观/微观」三层固定栏目是少数审查流派的习惯，被强加给每一份合同审查。模型扩写失败时律师拿到的是 `【出租人姓名/名称】` 占位稿。

**建议**：骨架降级为「可选参考结构」而非必填框架；让模型根据指令 + 材料 + 检索自行拟定章节（验收 spec 的关键词检查保留为 warning 而非结构来源）；「模型成稿失败 → 骨架」改为「重试/升级主模型」，而不是静默交占位稿。

### F5. ESG/报告类指令整轮短路：主模型不参与，直接跑确定性工作流 —— 高

**证据**：`src/lawmind/agent/deliverable-pipeline.ts:11-21,46-71`（`DELIVERABLE_TYPES_AUTO_WORKFLOW = {report.esg, report.general, report.compliance, report.learning}` + 动词/名词正则）；`turn-orchestrator-shortcuts.ts:141-200` 注释自述「ESG / general report draft verbs → one-shot execute_workflow without the model loop」。回复也是固定模板（`formatDeliverableWorkflowReply`，`deliverable-pipeline.ts:90-151`）。

**质量影响**：恰恰是研究报告这类**最需要**模型判断力（结构、详略、分析深度）的交付物，被交给「关键词路由 + 骨架 + 侧车扩写」链路。主模型本来可以在循环里读材料、决定检索策略、组织报告结构；短路后全部让位给正则与骨架。

**建议**：默认关闭该 shortcut（现默认开，`deliverable-pipeline.ts:30-44`），让报告类指令进入正常模型循环；保留 shortcut 仅为低资源环境的显式选项。

### F6. 注入模型的上下文被多层级激进取舍：CASE 1600 字符、指纹 800、素材块 660 token —— 高

**证据（数字）**：

- `src/lawmind/memory/prompt-windows.ts:28-56`（128K 窗口、scale=1）：`matterContextChars: 8_000`、`matterIndexChars: 1_600`（CASE 进模型的索引硬帽）、`lawyerFingerprintChars: 800`、`clientFingerprintChars: 800`、`dayLogIndexChars: 600`、`memoryHitGistChars: 180`。
- `src/lawmind/agent/material-blocks.ts:70-73`：`MATERIALS_BLOCK_MAX_CHARS = 1000`、`MATERIALS_BLOCK_CAP_TOKENS = 660`（派生事实 + 改稿范例 + 黄金范例三通道合并共享，`turn-orchestrator-prompt.ts:961-969`）。
- `src/lawmind/agent/prompt-fragments.ts:44-58`：`craft` 帽 1_500 token、`preference_fingerprint` 400、`skill_index` 2_000、`memory_hit` 200；`:81` session 尾部附加合计软预算 12_000 token。

**机制**：案件档案、律师画像、客户画像、工作日志、相关记忆、改稿/黄金范例，全部先按字符窗截断（头 65% + 尾 35%），再经片段帽与打包预算二次取舍；超帽只留一句「用 read_case_file 读」的溢出指针。

**质量影响**：复杂案件的 CASE.md（当事人、期限、争点、进展）在模型眼里被压成 1600 字符的残篇；办案所依赖的本所改稿范例与派生事实合计只有 660 token——长案例直接被整条丢弃。模型起草时对案件关键事实「看不见」，只能写出泛化文本或被迫多轮 read 工具补读（而检索/读取工具又有 F14 的次数帽）。

**建议**：对当前交付物类型相关的 CASE 段落用模型做相关性选择后注入（相关性排序已有 `findRelevantMemoriesForTurn` 雏形）；指纹帽随交付模式分档，起草轮把 CASE/材料预算提高一个量级。

### F7. digest_materials：每份材料只给模型 3000 字符做摘要 —— 高

**证据**：`src/lawmind/agent/material-pile-digest.ts:29-34`：`DIGEST_MAX_FILES = 32`、`DIGEST_PER_FILE_MODEL_CHARS = 3_000`、`DIGEST_CARD_EXCERPT_CHARS = 160`；`:53-58` 摘要指令自承「正文若标明中间省略，你看到的是头尾，不是全文」。配套：`document-read-budget.ts:17-20,62-75` 单读 clamp [8_000, 40_000] 字符；`read-folder-documents-tool.ts:43-46` `DEFAULT_MAX_FILES=24`、`HARD_MAX_FILES=60`、`HARD_PER_FILE_CHARS=40_000`。

**质量影响**：一份 2 万字的合同，关键违约责任条款常在正文中段——恰好在 3000 字符头尾窗外。审查要点、citations 基于局部文本生成，可能漏掉中段要害条款，而卡片口吻又让上游以为「已读过」。对证据密集型办件，这是直接的事实性质量损耗。

**建议**：取消固定 3000 字符帽，改为按材料总预算自适应分配（两步走：先超薄卡，再由主模型点名深读哪些文件哪些段落）；或允许 digest 模型对长文分段多轮读取后合并卡片。

### F8. 交付形态机械门：缺字面节名/编号数即 nudge 重写 —— 中高

**证据**：`src/lawmind/agent/deliverable-shape.ts:97-117`——备忘录缺字面「高风险」「下一步」即判缺节；`:18,120-131` `CONSULT_QUESTION_MIN = 8`，追问清单少于 8 条即需重写；`:75-95,191-199` 诉状必须含字面「当事人/管辖/诉讼请求/事实/理由/证据」。触发点：`turn-orchestrator-model-loop.ts:693-701` 把 nudge 注入下一轮采样要求重写同一交件。

**质量影响**：模型写出结构合理但措辞不同的交件（如用「风险与应对」「行动建议」作节名）时，会被机械要求按固定节名重写——产出开始向「过检查」而非「最合适」收敛；节名同质化，违背文书体裁适配。

**建议**：形态检查从「字面关键词存在」改为「模型判定结构是否服务该交付目的」（guardian 已有 judge 通道可承载）；字面检查仅保留为 warning，不再触发强制重写。

### F9. 分诊规则：按文本长度 + 关键词定档，错档即错管线 —— 中

**证据**：`src/lawmind/triage/rules.ts:80-86`——`t.trim().length < 400 && !/诉讼|仲裁|起诉/.test(t)` 即 green「可按默认剧本执行」；`:24-36` litigation-red 命中即 red 挂 3 个必答澄清。

**质量影响**：400 字是完全任意的线——「帮我看看这个仲裁条款效力」命中仲裁 → red 档要求先答三个诉讼澄清，即使律师只想审一个条款；399 字的复杂并购指令被 green 放行通用剧本。错档 → 推荐错误 workflowId、制造多余澄清或漏掉必要对齐。

**建议**：分诊档级由模型一句话判断（成本极低），规则表降级为兜底；长度不应作为任何一档的判据。

### F10. 文档体裁按文件名正则分类，体裁错则能力绑错 —— 中

**证据**：`src/lawmind/intent/document-genre.ts:41-58`——`FILENAME_RULES` 首中即定体裁；`:93-120` peek 正文只能在文件名 unknown 时升级（诉状头除外）。

**质量影响**：律师文件命名随手（「协议 final 改2.docx」「合同扫描件.pdf」），体裁错判直接把整轮绑上错误管线。「补充协议-对方批注版.docx」实为证据批注也按 contract 绑 contract.review。peek 正文 8000 字符的语义信息被优先级规则压制。

**建议**：把 peek 文本交给模型做体裁判断（或在已有 digest 卡片上判），文件名只作弱先验。

### F11. 固定采样参数：输出比例、温度、侧车上限 —— 中

**证据**：`src/lawmind/models/capability-envelope.ts:28-33,46-58`——`MAX_OUTPUT_HARD_CAP = 65_536`、`REVIEW_OUTPUT_HARD_CAP = 131_072`（注释明确「Not the 384k provider max」）、输出比例 draft/review 0.25 / plan 0.15 / classify 0.05 / chat 0.2；`:152-162` 温度 classify/plan 0.15、draft/review 0.5、chat 0.35；`runtime-model-call.ts:361` 兜底 0.3；`models/draft-reasoning.ts:58-61` 起草侧车 `temperature: 0.2, timeoutMs: 90_000`；`llm/http-retry.ts:11` `DEFAULT_MODEL_MAX_RETRIES = 2`。

**质量影响**：超长合同/卷宗类交付物的成稿被 128K 输出帽截顶；chat 0.2 比例在 128K 窗口约 25.6k token，对「对话里直接给完整法律意见」偏紧；长文起草与逐条审查共用 0.5 温度；侧车 classify 5% 窗口的输出帽在长 JSON schema 下可能截断。

**建议**：输出帽随「本轮交付物预期长度」动态（长文书轮解除 REVIEW_OUTPUT_HARD_CAP 或用 provider 上限减安全边）；温度允许 skill/playbook 按任务覆盖；侧车 5% 比例对结构化输出调到绝对下限 8k 以上。

### F12. 收口与口吻的机械话术约束 —— 中

**证据**：`src/lawmind/agent/lawyer-close.ts:16-29`——每次收口强制「稿/意见/请您定」三段式；`agent/system-prompt.ts:847-856`——交件口吻硬禁令（栏目格式、「自：」填写、套话与工程黑话逐字黑名单）。

**质量影响**：三段式对「本轮只改了一个条款」的小轮次同样强制——模型要么硬凑「请您定」要么显得机械；口吻黑名单逐字封禁，在个别语境（引用客户原文含「闭环」）会逼模型绕弯。口吻纪律本身有价值，问题在于一刀切。

**建议**：三段式与口吻规则标注为「正式交件默认」，允许模型按本轮体量显式降档；口吻禁令保留但改为「默认避免」而非逐字封禁。

### F13. Skill 注入预算：绑定轮最多 2 篇正文、其余索引，read_skill 再截 12k —— 中

**证据**：`src/lawmind/skills/skill-prompt-budget.ts:1-2,56-58`——「dump up to 2 primary stage bodies, index the rest」，`PRIMARY_BY_CAPABILITY` 人工固定表（`:9-32`）；`prompt-fragments.ts:55` skill_index 帽 2_000 token；`read-skill-tool.ts:20,100-103` `MAX_BODY_CHARS = 12_000`。

**质量影响**：Skill 正文是「这件活的质量规格」，截断后模型看到的是腰斩的检查表/工艺要求；未入选的第三、四篇（可能恰是本案关键）整个回合缺席。人工挑哪两篇进正文的表永远落后于真实案情分布。

**建议**：skill_index 片段帽随交付轮放大（1,200→4,000+）；让模型看到全部 Skill 一句话索引后**自选**注入哪几篇；read_skill 返回全文（或分段续读）而非 12k 死帽。

### F14. 工具调用的机械次数帽与「写前合成」收走检索工具 —— 中

**证据**：`src/lawmind/runtime/tool-pipeline.ts:222-234`——`DISCOVERY_LOOP_TOOL_LIMITS`（search_workspace 3、search_matter 2、read_project_file 8、analyze_document 8…）；`:254-265,412-443` 检索/列表合计帽 8 至 32，超限直接返回错误；`agent/write-synthesis.ts:20-23,93-111`——`WRITE_SYNTHESIS_SEARCH_CAP = 4`，4 次检索后若指定交件未写出则从广告工具表**移除检索工具**直到文件落盘。

**质量影响**：复杂案件检索（多法域、多争点）合理需要十几次检索；第 3 次 search_workspace 后被强制「就地成稿」，模型只能基于不完整检索写交付物。「先写再查」把模型推向臆造的风险区。

**建议**：次数帽改为「重复无新结果才熔断」（按结果去重/新命中率判断）；写前合成保留 nudge 但不收走检索工具，由模型权衡。

### F15. 历史与压缩的硬性数字 —— 低-中

**证据**：`agent/session.ts:43` `MAX_HISTORY_DEFAULT = 40`（按条数压缩）；`turn-orchestrator.ts:110` `DEFAULT_MAX_HISTORY_MESSAGES = 100`；`context-tuning.ts:160-176` 蒸馏帽 `charRatio 0.08`、`taskLineMax: 2`、`recentLineKeep: 8`、`citationAnchorMax: 24`，事实台账 12 条 × 320 字；`:151-157` 回合内模型摘要 `maxPerTurn: 3`、`llmDigestTimeoutMs: 15_000` 且 `maxAttempts` 必须为 1（`compact-llm-digest.ts:84-92`）；`tool-result-history.ts:37-41` 单条工具回包窗口/8、min 4k、max 32k token。

**质量影响**：长办案会话中，早期关键事实在压缩后只剩 8 条要点 + 24 个法条锚点的骨架；摘要模型 15 秒超时下经常缺席，上下文连续性靠正则抽取维持。模型「记得」的事实是被裁剪过的版本。

**建议**：蒸馏保留条目按「与当前交付物的相关性」选择而非纯 recency；回合内 LLM 摘要允许后台完成并在下一轮补写。

## 2.3 已核实合理（a 类：法律领域必要的确定性约束）

1. **Guardian 机器验证器**（`guardian/machine-verifiers.ts:1-16,330-386`）：只登记有真实 lint 规则支撑的项（当事人一致性、定金 20% 上限、LPR 上限、保证形式、或裁或诉），fail-closed；判断类条目走 LLM judge、主观项升级律师。确定性核验防幻觉——合理。
2. **tracked-format-gate / tracked-xml-qa**（`drafts/tracked-format-gate.ts`、`tracked-xml-qa.ts:106-116`）：修订 run 字体格式对齐原稿、禁止「整句删+整句增」。Word 协作硬要求，约束修订**形态**而非改写幅度——合理。
3. **surgical-edit-gate 软阈值**（`drafts/surgical-edit-gate.ts:1-9,70-97`）：改写幅度只记指标与教练提示，不拒稿——姿态正确。
4. **引用完整性门禁**（`engine-pipeline-tools.ts` citationIntegrity、演示语料拒稿 `engine-tool-shared.ts:147-152`）：引用须可溯源——防幻觉核心，合理。
5. **外发审批 / 危险工具批准**（`runtime/tool-pipeline.ts` approvalMiddleware、`send_email` 只写入待发信）：安全边界，合理。
6. **content-checks**（`deliverables/content-checks.ts`）：金额须带公式、证据须写证明目的，全部 warning 不拦导出——合理提示。
7. **capability-envelope 随窗口缩放**（`models/capability-envelope.ts:91-135`）与 CJK 诚实 token 估算（`agent/context-budget.ts:58-84`）：工程必要，且留 env 出口。
8. **noTaskTurnGate**（`runtime/tool-pipeline.ts:564-582` + `utterance-kind.ts:160-177`）：仅对「单字/纯确认」收写工具，防「一句 k 重跑整条流水线」——合理防呆。
9. **assistant-turn-gate / child-gates**：并发租约与权限继承，纯基础设施，合理。

---

## 附：与现有工程的交集提示

- 本报告的删除候选与当前工作树未提交改动**零交集**（已核对 git status）。
- 若执行删除，手册第 39 章「废弃遗留物」应同步登记；相关章节（13/16/24/34/50/62/64/65 等）需随删除更新。
