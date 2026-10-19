# 第 46 章 实现精读：安全、工具执行与治理

这一章讲 `runtime/`、`audit/`、`policy/` 三个目录，以及 `platform/` 的**总览**。合起来是「什么东西能出网、什么能起进程、什么不许被改、谁能用哪些工具」。

> **`platform/` 的逐文件精读在第 68–69 章**（47 个非测试文件）：十二种 `GateDecisionKind` 与三种判定、出网受众与 SSRF 网段拒绝、六类待办卡片、自动办件的六个确认项、守护进程四件套、Word 改稿九类清单。十二种门禁不是工具管线；管线是 19 级中间件，见 46.1。这一章里的 46.2 只给「有哪些文件、分几块」的鸟瞰。

## 46.1 `runtime/`（执行层，17 个文件）

`runtime/` 是**工具执行的强制点**。

### `tool-pipeline.ts`（最关键的一个文件）

导出：

| 类别          | 导出                                                                                                                                                                                                                                                                              |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 中间件        | `buildDefaultToolPipeline`（19 级，见下）、`composeToolPipeline`，以及链上各级（`unknownToolMiddleware`、`budgetMiddleware`、`permissionModeMiddleware`、`approvalMiddleware` 等）                                                                                                |
| 检索/列表预算 | `DISCOVERY_LOOP_TOOL_LIMITS`、`DISCOVERY_LOOP_TOTAL_CAP`、`DISCOVERY_LOOP_TOTAL_CAP_MAX`、`resolveDiscoveryLoopTotalCap`、`wouldHitDiscoveryCap`、`dropSaturatedDiscoveryTools`、`discoveryStopHint`、`discoveryCountsShowDocumentRead`                                           |
| 本机文件预算  | `HOST_FILE_TOOL_NAMES`、`HOST_FILE_PER_TOOL_LIMIT_FALLBACK`、`HOST_FILE_PER_TOOL_LIMIT_MIN`、`HOST_FILE_PER_TOOL_LIMIT_MAX`、`resolveHostFilePerToolLimit`、`wouldHitHostFileCap`、`hostFileLedgerTotal`、`HostFileLedgerHint`、`contextUsesHostFileLedger`、`usesHostFileLedger` |
| 类型          | `ToolCallContext`、`ToolPolicyConfig`、`ToolMiddleware`                                                                                                                                                                                                                           |
| 其他          | `MATTER_SCOPED_TOOL_NAMES`                                                                                                                                                                                                                                                        |

**默认链是 19 级**（`buildDefaultToolPipeline`），顺序固定：

```text
unknownTool → budget → noTaskTurnGate → permissionMode
→ discoveryLoop → hostFileLoop → roleAllowlist → matterScope
→ clarificationGate → folderExploreGate → argNormalize → argSchema
→ legalVerify → actionPreReview → approval → audit
→ timeout → subprocessSandbox → execute
```

`legalVerifyMiddleware` 定义在 `legal-verify-middleware.ts`，由本文件接进链。`actionPreReviewMiddleware` 读 `LAWMIND_ACTION_PRE_REVIEW`（`off` / `shadow` / `on`，默认 `off`）；`on` 时只对 `run_host_command` 加问。

**审批仲裁**在 `platform/approval-arbitration.ts` 的 `resolveApprovalArbitration`：`denied` → `block` → `askFirst` → `allowAutomatically` → 都没有则 `ask`。上游权限 / 岗位 / playbook 负责 deny，`legalVerify` 负责 block，`approvalMiddleware` 只裁 Ask 与 Allow。自 2026-10-01 起没有 disposition=`pause` 的工具，`toolRequiresLawyerPause` 恒为 false，`toolRequiresExplicitApproval` 因此在读到开发旁路之前就返回 false。外发写入本案待发信，律师在待发列表点「批准发送」才真正发出。

预算函数仍然全部导出：工具表和提示组装要提前知道「这个工具还能不能调」，从而不广告已饱和的工具。`dropSaturatedDiscoveryTools` 就是干这个的。

### 其他执行层文件

| 文件                          | 关键导出                                                                                                                                                                       | 作用                         |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------- |
| `same-turn-verify.ts`         | 一大串（约 30 个）：`shouldBounceSameTurnCompletion`、`applySameTurnVerifyFail`、`precheckOutboundSameTurnVerify`、`collapseSameTurnVerifyBounces`、`formatSameTurnVerify*` 等 | 同回合验证（失败就回弹）     |
| `legal-verify-middleware.ts`  | `precheckOutboundMail`、`applyLegalVerifyToResult`、`legalVerifyMiddleware`、`extractEmailDomain`、`recipientDomainOutsideAllowlist`、`resolveOutboundAllowedDomains`          | 外发预检与引用后处理         |
| `tool-concurrency.ts`         | `getMaxToolUseConcurrency`、`isToolConcurrencySafe`、`partitionToolCalls`、`ToolCallRef`、`ToolCallBatch`                                                                      | 并发分批（默认 4）           |
| `list-dir.ts`                 | `resolveAndListDirectory`、`walkDirectoryListing`、`formatDirectoryListingBlock`、`LIST_DIR_MAX_ENTRIES`、`LIST_DIR_MAX_DEPTH`、`LIST_DIR_SKIP_NAMES` 等                       | 目录列举（含上限与跳过名单） |
| `protected-workspace-rels.ts` | `isProtectedWorkspaceRel`、`PROTECTED_WORKSPACE_WRITE_REFUSAL`、`PROTECTED_WORKSPACE_WRITE_CODE`                                                                               | 治理路径保护                 |
| `workspace-path.ts`           | `resolveWorkspaceRelativePath`、`resolveWorkspaceRelativePathAllowRoot`、`isPathInsideRoot`                                                                                    | 路径围栏                     |
| `context-plan.ts`             | `buildContextPlan`、`buildContextPlanMarkdown`、类型                                                                                                                           | 分层的上下文计划             |
| `pinned-context.ts`           | `resolvePinnedContextSummary`、`withContractPlaybookPin`、`PinnedContextSummary`                                                                                               | 钉选上下文摘要               |
| `lawyer-local-file.ts`        | `resolveLawyerLocalDir`、`resolveLawyerLocalFile`、`formatLocatedWordBaselines`                                                                                                | 律师点名的本机路径解析       |
| `analysis-script-path.ts`     | `isAllowedAnalysisScriptRel`、`isProtectedAnalysisScriptRel`、`parseSkillAnalysisScriptRel`                                                                                    | 分析脚本路径白名单           |
| `tool-timeout-env.ts`         | 工具超时环境变量解析                                                                                                                                                           | —                            |
| `tool-sandbox.ts`             | 沙箱开启时把高风险工具放进子进程；runner 缺失就拒绝，不静默退回进程内                                                                                                          | 子进程沙箱                   |
| `tool-sandbox-child.ts`       | 沙箱子进程入口                                                                                                                                                                 | —                            |
| `turn-admission.ts`           | 进程级并发准入（模型采样、写、同一文件租约）                                                                                                                                   | 多对话共享上限               |
| `workspace-io-fence.ts`       | `fenceAgentFilePath`：realpath + 拒绝名单，挡住不走 `read_host_file` 的符号链接                                                                                                | 读路径围栏                   |
| `icloud-materialize.ts`       | 律师点名的 iCloud 占位文件先落到本机再读                                                                                                                                       | 材料下载                     |

**`same-turn-verify.ts` 是最复杂的一个**（约 30 个导出），因为它要处理「验证失败 → 回弹 → 再试 → 暂停」的完整状态机，还要管历史折叠（`collapseSameTurnVerifyBounces`）。

## 46.2 `platform/`（47 个非测试文件，鸟瞰）

`platform/` 是这一层最大的一块。非测试源文件 47 个，按职责分成下面几组（文件数相加等于 47）：

| 组           | 文件数 | 代表文件                                                                                                                                                                                                                                                        |
| ------------ | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 契约与门禁   | 9      | `contracts.ts`、`gate-category.ts`、`gate-stop.ts`、`review-gates.ts`、`execution-state.ts`、`execution-surface.ts`、`audit-gate.ts`、`approval-arbitration.ts`、`action-pre-review.ts`                                                                         |
| 待办与钉选   | 6      | `requires-action.ts`（六种 kind）、`pending-tool-approvals.ts`、`tool-approval-diff.ts`、`judgment-escalation.ts`、`clarification-fields.ts`、`compose-context-pin.ts`                                                                                          |
| 两个统一出口 | 2      | `outbound-proxy.ts`、`safe-command.ts`                                                                                                                                                                                                                          |
| 出网判定     | 4      | `outbound-audience.ts`、`lawyer-outbound-decision.ts`、`content-trust.ts`、`playbook-tool-lock.ts`                                                                                                                                                              |
| 自动办件     | 11     | `lawyer-automations.ts`、`lawyer-automations-runner.ts`、`automation-paths.ts`、`automation-run-history.ts`、`automation-dispatch-ledger.ts`、`automation-from-work.ts`、`infer-automation-from-instruction.ts`、事件触发三件套、`automation-frequency-hint.ts` |
| 守护进程     | 3      | `lawmind-daemon.ts`、`lawmind-daemon-supervision.ts`、`lawmind-daemon-log.ts`                                                                                                                                                                                   |
| Word 改稿    | 5      | `word-revision-core.ts`、`word-revision-packs.ts`、`word-revision-checklist.ts`、`word-revision-instruction.ts`、`word-revision-document-excerpt.ts`                                                                                                            |
| 在办         | 2      | `agent-fleet.ts`、`build-agent-fleet.ts`                                                                                                                                                                                                                        |
| 其他         | 5      | `local-key-store.ts`、`local-api-schemas.ts`、`ingest-helpers.ts`、`ops-doctor.ts`、`mail-contract-short-path-instruction.ts`（`contract-fast-lane-instruction.ts` 已移除）                                                                                     |

**`requires-action.ts` 是「待我拍板」的数据构造处**：把「需要律师做的事」统一成 `LawMindRequiresAction`（六种 kind），并生成每条的中文标题与决定按钮。六类与四种决定的清单见第 68.10 节。

**`playbook-tool-lock.ts` 只管否决**，不冻结允许清单。它有三个锁（邮件合同 / Word 改稿 / 先读），其中「先读」对「函件核对」类要禁**七个**工具——连起草类一起禁，逼模型先读再说话。见第 68.14 节。

### 两个统一出口

**`outbound-proxy.ts`** 只导出 6 个（`createOutboundProxy`、默认单例、错误类、两个类型）——**实现细节全部内部**。它的八条网段拒绝与 `fail-closed` 的 DNS 处理见第 68.9 节。

**`safe-command.ts`** 有一套与 Electron 那份**完全不同**的规则（那份管「打开」，这份管「运行」）。三张名单（禁 11 个 shell、禁 7 个代码执行参数、14 个可继承宿主变量）见第 68.17 节。默认最小环境会剥掉 19 个厂商密钥前缀（正则交替里含 `EXA`）；调用方显式传入的 `env` 原样保留，只剥 7 个 `LAWMIND_*` 凭据名和 17 个加载器钩子。入口三个：`safeCommand`（流式句柄）、`runSafeCommand`（异步等结果）、`runSafeCommandSync`（同步路径用，比如 quit 时 spawn daemon 那种不能 await 的场合）。

**三种 child env 构建器的分工**：

| 函数                   | 允许 LAWMIND_* 密钥          |
| ---------------------- | ---------------------------- |
| `buildMinimalChildEnv` | 否（MCP 用）                 |
| `buildSandboxChildEnv` | 是（沙箱用，但密钥正则仍拦） |
| `buildSafeChildEnv`    | 按参数                       |

### 其他几处「一提就得记住」的

- **`tool-approval-diff.ts` 里那几个 `toolArgsHave*` 判断**决定审批卡片长什么样：是展示完整 diff、还是只展示可编辑的短字段。
- **`lawyer-automations.ts` 里的邮件函数**（`listMatterMailMessages`、`queueOutboundMail`、`commitOutboundMail`）说明**自动办件的邮件读写和工作台邮件是同一套**——不是两套实现。
- **`word-revision-packs.ts` 有 1145 行**，因为九个族的清单内容全在里面；`word-revision-core.ts` 是机制。两者分开是刻意的。

### 两个跨目录的运行时细节

- **FTS 增量同步**（`src/lawmind/indexing/fts-ingest.ts`）：`syncWorkspaceSearchIndex` 在检索前调用——没有索引时整库建一次，之后按 `index_source` 表里的 mtime/size 戳只补改过的审计、会话、知识和材料；`index_source` 为空而 FTS 行非空（戳丢了）时整库重建兜底。
- **事件日志撕尾修复**（`src/lawmind/agent/session-event-log.ts` 的 `repairTornJsonlTail`）：崩溃可能留下半行 JSON。修复窗口是文件尾部最多 1 MB——**单条事件超过这个窗口时放弃本次修复**（读侧 `parseEventLines` 本来就跳过坏行，损失止于撕尾那一条），而不是清空或截断整个文件。

## 46.3 `audit/`（8 个文件）

| 文件                     | 关键导出与常量                                                                                                                                                                                                                           |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `index.ts`               | `emit`、`readAuditLog`、`readAllAuditLogs`、`readRecentAuditLogs`、`filterAuditEventsForExport`、`buildAuditExportMarkdown`、`buildComplianceAuditMarkdown`、`buildAuditReplayExport`、`formatAuditExportMarkdown`、`AuditExportFilters` |
| `hash-chain.ts`          | `attachHashChain`、`verifyAuditHashChain`、`summarizeAuditIntegrity`、`AUDIT_HASH_ALG_HMAC`、`RECOVERY_TAIL_BYTES`                                                                                                                       |
| `audit-key.ts`           | `resolveAuditChainKey(s)`、`AUDIT_CHAIN_KEY_ENV`、`AUDIT_CHAIN_KEY_NAME`                                                                                                                                                                 |
| `root-anchor.ts`         | `appendAuditRootAnchor`、`readAuditRootAnchors`、`latestAuditRootAnchor`、`verifyAuditFileWithAnchor`、`verifyAuditWorkspaceTailAnchors`                                                                                                 |
| `external-anchor.ts`     | `createExternalAnchorUploader`、`syncExternalAnchor`、`startAuditExternalAnchorSync`、两个 uploader 类                                                                                                                                   |
| `verify-external.ts`     | `verifyExternalAuditAnchor`、`formatAuditExternalVerifyReport`、六种状态                                                                                                                                                                 |
| `export-summary.ts`      | `buildAuditExportSummary`、`signAuditSummary`、`verifyAuditSummarySignature`、`AUDIT_EXTERNAL_ANCHOR_URL_ENV`                                                                                                                            |
| `collaboration-audit.ts` | `COLLAB_KIND_PREFIX`（`collab.`）、`flushCollaborationAudit`：协作动作进哈希链，报表按事件自带的 `matterId` 筛，不走 taskId 反查                                                                                                         |

**`emit()` 的四个不变量**（第 15 章讲过）：按天分文件、串行写队列、链式追加在文件锁里、外锚同步在锁外异步。

## 46.4 `policy/`（15 个文件）

| 文件                                 | 关键导出                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `edition-features.ts` / `edition.ts` | `EDITION_FEATURES`（17 个功能键，含 `multiAssistantRoster`）、`resolveEdition`、`isFeatureEnabled`（只读版本表）、`isWordAddinAutoRunEnabled`                                                                                                                                                                                                                   |
| `commercial-policy.ts`               | `lawmind.policy.json` 的拒收表。`features`、`judgmentTiering`、`citationMode`、`ethicsWall` 等写进文件会被拒绝                                                                                                                                                                                                                                                  |
| `word-revision-author.ts`            | Word 修订署名；空白用 `LawMind`                                                                                                                                                                                                                                                                                                                                 |
| `workspace-policy.ts`                | `readWorkspacePolicyFile`、`workspacePolicyPath`、`resolveAgentMandatoryRulesForPrompt`、`resolveMatterMandatoryRulesForPrompt`、`resolveEgressMode`、`readEgressMode`、`isEgressOffline`、`mergeWorkspacePolicyFile`、`resolveAgentMaxToolCallsPerTurn`、`resolveAgentMaxHistoryMessages`、`resolveAgentPromptVerbosity`、`AGENT_MANDATORY_RULES_MAX_CHARS` 等 |
| `network-allowlist.ts`               | `checkNetworkAllowlist`、`mergeRecommendedLegalNetworkAllowlist`、`hostnameFromUrl`、`RECOMMENDED_LEGAL_NETWORK_ALLOWLIST`                                                                                                                                                                                                                                      |
| `citation-mode.ts`                   | `resolveCitationMode`、`citationModeBlocksRender`、`citationModeBannerKind`                                                                                                                                                                                                                                                                                     |
| `ethics-wall.ts`                     | `readEthicsWallState`、`writeEthicsWallState`、`recordEthicsWallScan`、`acknowledgeEthicsWall`、`ethicsWallBlocksOutbound`、`isEthicsWallEnabled`、`ETHICS_WALL_HOLD_LAWYER_MESSAGE`                                                                                                                                                                            |
| `privilege-sentinel.ts`              | `scanPrivilegeTip`、`assessOutboundPrivilege`、`isPrivilegeSentinelEnabled`                                                                                                                                                                                                                                                                                     |
| `judgment-tiering.ts`                | `resolveJudgmentTieringMode`、`resolveDisabledVerifiers`、`shouldRunMachineStage`、`machineVerdictsAffectOutcome`、`resolveLawyerEscalationPosture`、`resolveEscalationPosture`                                                                                                                                                                                 |
| `private-deploy-checklist.ts`        | `runPrivateDeployChecklist`（六项）                                                                                                                                                                                                                                                                                                                             |
| `governance-report.ts`               | `buildGovernanceReportMarkdown`                                                                                                                                                                                                                                                                                                                                 |
| `benchmark-gate.ts`                  | `evaluateBenchmarkGate`                                                                                                                                                                                                                                                                                                                                         |
| `analysis-scripts.ts`                | 分析脚本策略                                                                                                                                                                                                                                                                                                                                                    |
| `workspace-policy` 的 `context`      | 上下文相关策略（第 30 章）                                                                                                                                                                                                                                                                                                                                      |

**`edition.ts` 头注释里和功能键有关的口径**：版本只决定显隐、不改数据结构；解析顺序是 `policy.edition` > `LAWMIND_EDITION` > `solo`（缺省不报错）；**`policy.features` 不生效**。`commercial-policy.ts` 拒收 `features`（「版本能力由版本表决定，不能在策略里单键关掉」）。`isFeatureEnabled` 只读 `EDITION_FEATURES`。`wordAddinAutoRun` 有专用面：`policy.wordAddinAutoRun` 的布尔优先于版本表。

**引用模式**（`citation-mode.ts`）：`LAWMIND_CITATION_MODE` 优先于进程内 policy 对象，再按版本。solo 默认 `assisted`，firm 与 private_deploy 默认 `grounded`。把 `citationMode` 写进 `lawmind.policy.json` 会被拒（「引用门禁由版本决定，不能在策略里关掉」）。

**判断分级**（`judgment-tiering.ts`）：默认 `shadow`。`resolveJudgmentTieringMode` 先看进程内 policy 对象，再看 `LAWMIND_JUDGMENT_TIERING`。写进 `lawmind.policy.json` 的 `judgmentTiering` 会被拒（「判断分级是产品行为，不在策略文件里调」），环境变量仍然生效。升级通道缺省关，见第 68.15 节。

**伦理墙**：`ethics-wall.ts` 被检索和邮件工具调用（利益冲突扫描、外发拦截）。桌面路由 `apps/lawmind-desktop/server/lawmind-server-route-mail.ts` 注册了 `GET /api/ethics-wall` 与 `POST /api/ethics-wall/acknowledge`，产品界面没有调用这两条 HTTP。控制面是引擎模块，不是这条路由。策略文件里的 `ethicsWall` 同样被拒，开关跟版本键走。

## 46.5 一张「谁拦谁」的对照

| 想拦什么       | 在哪拦                      | 文件                                                                      |
| -------------- | --------------------------- | ------------------------------------------------------------------------- |
| 任意命令       | 命令网关                    | `platform/safe-command.ts`                                                |
| 任意出网       | 出口代理                    | `platform/outbound-proxy.ts`                                              |
| 非法路径       | 路径围栏                    | `runtime/workspace-path.ts`                                               |
| 改治理文件     | 路径名单                    | `runtime/protected-workspace-rels.ts`                                     |
| 越权工具       | 权限模式 + 角色白名单       | `agent/permission-mode.ts` + `runtime/tool-pipeline.ts`                   |
| 危险工具免审批 | 审批中间件                  | `runtime/tool-pipeline.ts` + `agent/dangerous-tool-policy.ts`             |
| 外发           | 唯一硬闸门                  | `platform/lawyer-outbound-decision.ts`                                    |
| 空转           | 三层预算                    | `runtime/tool-pipeline.ts`                                                |
| 假装改完       | 空修订门 + XML 复核         | `drafts/tracked-render-hunk-gate.ts` + `drafts/tracked-xml-qa.ts`         |
| 引用对不上     | 引用完整性                  | `drafts/citation-integrity.ts`                                            |
| 冲突外发       | 伦理墙模块（邮件/检索工具） | `policy/ethics-wall.ts`（HTTP `/api/ethics-wall` 已注册，产品侧无调用方） |
| 篡改审计       | 哈希链 + 锚                 | `audit/`                                                                  |

## 46.6 已知坑（本章相关）

- **工具管线是 19 级中间件**，和十二种 `GateDecisionKind` 不是同一张表。预算判定函数仍然导出，给工具表提前下架用。
- **自 2026-10-01 起没有 pause 工具。** 审批仲裁的顺序是 denied → block → askFirst → allowAutomatically → ask。
- **`same-turn-verify.ts` 是最复杂的一个文件**（约 30 个导出），因为它是一个完整状态机。
- **`outbound-proxy` 与 `safe-command` 的实现细节全部内部**，只有入口导出。
- **三种 child env 构建器对密钥的处理不同。**
- **`playbook-tool-lock` 只管否决**，不冻结允许清单。
- **`word-revision-core.ts` 与 `word-revision-packs.ts` 是两个文件**：前者是机制，后者是九个族的具体内容（1145 行）。
- **`domain-state.ts` 在 `application/` 不在 `platform/`。**
- **`lawyer-automations.ts` 的邮件函数和 `mail/` 模块不是一回事**（前者读写工作区邮件文件，后者是 IMAP/SMTP）。
- **`policy/edition-features.ts` 的 17 个功能键**是三档都要给值的。`policy.features` 不生效，写进策略文件会被拒。
- **四条开发旁路**：`LAWMIND_SKIP_API_AUTH` 在打包版被忽略（`isLoopbackApiAuthSkipped`）。`LAWMIND_ALLOW_DANGEROUS_TOOLS_WITHOUT_APPROVAL`、`LAWMIND_ALLOW_CHECKLIST_BYPASS`、`LAWMIND_ALLOW_RENDER_GATE_BYPASS` 打包版仍然读取。第一条会传进 `allowDangerousToolsWithoutApproval`，但 `toolRequiresExplicitApproval` 已因没有 pause 工具提前返回 false。后两条在 `lawmind-server-route-review.ts`：清单破窗与 `?strict=false` 的导出破窗。
- **`platform/safe-command.ts` 与 `electron/safe-shell-command.mjs` 是两套不同规则**——只共用一个 `safe_command` 审计名。别以为改一处会同步。
