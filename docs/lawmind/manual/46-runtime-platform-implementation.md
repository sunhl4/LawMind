# 第 46 章 实现精读：安全、工具执行与治理

这一章讲 `runtime/`、`audit/`、`policy/` 三个目录，以及 `platform/` 的**总览**。合起来是「什么东西能出网、什么能起进程、什么不许被改、谁能用哪些工具」。

> **`platform/` 的逐文件精读在第 68–69 章**（41 个文件，比这里的清单厚得多）：十二种门禁与三种判定、出网受众与 SSRF 八条网段拒绝、六类待办卡片、自动办件的六个确认项、守护进程四件套、Word 改稿九类清单。这一章里的 46.2 只给「有哪些文件、分几块」的鸟瞰，具体机制看那两章。

## 46.1 `runtime/`（执行层，16 个文件）

`runtime/` 是**工具执行的强制点**。

### `tool-pipeline.ts`（最关键的一个文件）

导出：

| 类别          | 导出                                                                                                                                                                                                                                                                              |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 中间件        | `unknownToolMiddleware`、`budgetMiddleware`、`permissionModeMiddleware`、`composeToolPipeline`                                                                                                                                                                                    |
| 检索/列表预算 | `DISCOVERY_LOOP_TOOL_LIMITS`、`DISCOVERY_LOOP_TOTAL_CAP`、`DISCOVERY_LOOP_TOTAL_CAP_MAX`、`resolveDiscoveryLoopTotalCap`、`wouldHitDiscoveryCap`、`dropSaturatedDiscoveryTools`、`discoveryStopHint`、`discoveryCountsShowDocumentRead`                                           |
| 本机文件预算  | `HOST_FILE_TOOL_NAMES`、`HOST_FILE_PER_TOOL_LIMIT_FALLBACK`、`HOST_FILE_PER_TOOL_LIMIT_MIN`、`HOST_FILE_PER_TOOL_LIMIT_MAX`、`resolveHostFilePerToolLimit`、`wouldHitHostFileCap`、`hostFileLedgerTotal`、`HostFileLedgerHint`、`contextUsesHostFileLedger`、`usesHostFileLedger` |
| 类型          | `ToolCallContext`、`ToolPolicyConfig`、`ToolMiddleware`                                                                                                                                                                                                                           |
| 其他          | `MATTER_SCOPED_TOOL_NAMES`、`FOLDER_EXPLORE_GATE_ERROR`                                                                                                                                                                                                                           |

**注意导出面**：它只导出了**少数几个中间件**（其他的在内部数组里），但导出了**预算相关的全部常量与判定函数**。

**为什么要把预算函数导出来**：因为别的地方（工具表构建、提示组装）要**提前知道**「这个工具还能不能调」，从而不广告已饱和的工具。`dropSaturatedDiscoveryTools` 就是干这个的。

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

**`same-turn-verify.ts` 是最复杂的一个**（约 30 个导出），因为它要处理「验证失败 → 回弹 → 再试 → 暂停」的完整状态机，还要管历史折叠（`collapseSameTurnVerifyBounces`）。

## 46.2 `platform/`（41 个文件，鸟瞰）

`platform/` 是这一层最大的一块，分九组：

| 组           | 文件数 | 代表文件                                                                                                                                                                                                                           |
| ------------ | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 契约与门禁   | 8      | `contracts.ts`、`gate-category.ts`、`gate-stop.ts`、`review-gates.ts`、`execution-state.ts`、`audit-gate.ts`                                                                                                                       |
| 待办与审批   | 4      | `requires-action.ts`（六种 kind 的构造处）、`pending-tool-approvals.ts`、`tool-approval-diff.ts`、`judgment-escalation.ts`                                                                                                         |
| 两个统一出口 | 2      | `outbound-proxy.ts`、`safe-command.ts`                                                                                                                                                                                             |
| 出网判定     | 4      | `outbound-audience.ts`、`lawyer-outbound-decision.ts`、`content-trust.ts`、`playbook-tool-lock.ts`                                                                                                                                 |
| 自动办件     | 7      | `lawyer-automations.ts`（导出最多，56 个）、`lawyer-automations-runner.ts`、`automation-paths.ts`、`automation-run-history.ts`、`automation-dispatch-ledger.ts`、`automation-from-work.ts`、`infer-automation-from-instruction.ts` |
| 守护进程     | 3      | `lawmind-daemon.ts`、`lawmind-daemon-supervision.ts`、`lawmind-daemon-log.ts`                                                                                                                                                      |
| Word 改稿    | 6      | `word-revision-core.ts`（机制）、`word-revision-packs.ts`（九个族的内容）、`word-revision-checklist.ts`、`word-revision-instruction.ts`、`word-revision-document-excerpt.ts`、`word-revision-packs.ts`                             |
| 指令生成器   | 4      | `mail-contract-short-path-instruction.ts`、`contract-fast-lane-instruction.ts`、`mail-chat-intent.ts`、`infer-automation-from-instruction.ts`                                                                                      |
| 其他         | 3      | `local-key-store.ts`、`local-api-schemas.ts`（40+ 个 zod 请求体）、`client-profile` 相关                                                                                                                                           |

**`requires-action.ts` 是「待我拍板」的数据构造处**：把「需要律师做的事」统一成 `LawMindRequiresAction`（六种 kind），并生成每条的中文标题与决定按钮。六类与四种决定的清单见第 68.10 节。

**`playbook-tool-lock.ts` 只管否决**，不冻结允许清单。它有三个锁（邮件合同 / Word 改稿 / 先读），其中「先读」对「函件核对」类要禁**七个**工具——连起草类一起禁，逼模型先读再说话。见第 68.14 节。

### 两个统一出口

**`outbound-proxy.ts`** 只导出 6 个（`createOutboundProxy`、默认单例、错误类、两个类型）——**实现细节全部内部**。它的八条网段拒绝与 `fail-closed` 的 DNS 处理见第 68.9 节。

**`safe-command.ts`** 有一套与 Electron 那份**完全不同**的规则（那份管「打开」，这份管「运行」）。三张名单（禁 11 个 shell、禁 7 个代码执行参数、15 个可继承变量）见第 68.17 节。

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

## 46.3 `audit/`（8 个文件）

| 文件                 | 关键导出与常量                                                                                                                                                                                                                           |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `index.ts`           | `emit`、`readAuditLog`、`readAllAuditLogs`、`readRecentAuditLogs`、`filterAuditEventsForExport`、`buildAuditExportMarkdown`、`buildComplianceAuditMarkdown`、`buildAuditReplayExport`、`formatAuditExportMarkdown`、`AuditExportFilters` |
| `hash-chain.ts`      | `attachHashChain`、`verifyAuditHashChain`、`summarizeAuditIntegrity`、`AUDIT_HASH_ALG_HMAC`、`RECOVERY_TAIL_BYTES`                                                                                                                       |
| `audit-key.ts`       | `resolveAuditChainKey(s)`、`AUDIT_CHAIN_KEY_ENV`、`AUDIT_CHAIN_KEY_NAME`                                                                                                                                                                 |
| `root-anchor.ts`     | `appendAuditRootAnchor`、`readAuditRootAnchors`、`latestAuditRootAnchor`、`verifyAuditFileWithAnchor`、`verifyAuditWorkspaceTailAnchors`                                                                                                 |
| `external-anchor.ts` | `createExternalAnchorUploader`、`syncExternalAnchor`、`startAuditExternalAnchorSync`、两个 uploader 类                                                                                                                                   |
| `verify-external.ts` | `verifyExternalAuditAnchor`、`formatAuditExternalVerifyReport`、六种状态                                                                                                                                                                 |
| `export-summary.ts`  | `buildAuditExportSummary`、`signAuditSummary`、`verifyAuditSummarySignature`、`AUDIT_EXTERNAL_ANCHOR_URL_ENV`                                                                                                                            |

**`emit()` 的四个不变量**（第 15 章讲过）：按天分文件、串行写队列、链式追加在文件锁里、外锚同步在锁外异步。

## 46.4 `policy/`（14 个文件）

| 文件                            | 关键导出                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `edition.ts`                    | `EDITION_VALUES`、`EDITION_LABELS`、`EDITION_FEATURES`（18 个功能键）、`resolveEdition`、`isFeatureEnabled`、`listEditions`、`resolveProductInsightsCollection`、`isWordAddinAutoRunEnabled`                                                                                                                                                                    |
| `workspace-policy.ts`           | `readWorkspacePolicyFile`、`workspacePolicyPath`、`resolveAgentMandatoryRulesForPrompt`、`resolveMatterMandatoryRulesForPrompt`、`resolveEgressMode`、`readEgressMode`、`isEgressOffline`、`mergeWorkspacePolicyFile`、`resolveAgentMaxToolCallsPerTurn`、`resolveAgentMaxHistoryMessages`、`resolveAgentPromptVerbosity`、`AGENT_MANDATORY_RULES_MAX_CHARS` 等 |
| `network-allowlist.ts`          | `checkNetworkAllowlist`、`mergeRecommendedLegalNetworkAllowlist`、`hostnameFromUrl`、`RECOMMENDED_LEGAL_NETWORK_ALLOWLIST`                                                                                                                                                                                                                                      |
| `citation-mode.ts`              | `resolveCitationMode`、`citationModeBlocksRender`、`citationModeBannerKind`                                                                                                                                                                                                                                                                                     |
| `ethics-wall.ts`                | `readEthicsWallState`、`writeEthicsWallState`、`recordEthicsWallScan`、`acknowledgeEthicsWall`、`ethicsWallBlocksOutbound`、`isEthicsWallEnabled`、`ETHICS_WALL_HOLD_LAWYER_MESSAGE`                                                                                                                                                                            |
| `privilege-sentinel.ts`         | `scanPrivilegeTip`、`assessOutboundPrivilege`、`isPrivilegeSentinelEnabled`                                                                                                                                                                                                                                                                                     |
| `judgment-tiering.ts`           | `resolveJudgmentTieringMode`、`resolveDisabledVerifiers`、`shouldRunMachineStage`、`machineVerdictsAffectOutcome`、`resolveLawyerEscalationPosture`、`resolveEscalationPosture`                                                                                                                                                                                 |
| `private-deploy-checklist.ts`   | `runPrivateDeployChecklist`（六项）                                                                                                                                                                                                                                                                                                                             |
| `governance-report.ts`          | `buildGovernanceReportMarkdown`                                                                                                                                                                                                                                                                                                                                 |
| `benchmark-gate.ts`             | `evaluateBenchmarkGate`                                                                                                                                                                                                                                                                                                                                         |
| `analysis-scripts.ts`           | 分析脚本策略                                                                                                                                                                                                                                                                                                                                                    |
| `workspace-policy` 的 `context` | 上下文相关策略（第 30 章）                                                                                                                                                                                                                                                                                                                                      |

**`policy/` 的三条设计原则**（`edition.ts` 头部）：Edition 只决定显隐不决定数据结构、默认值永远不报错、policy 优先于环境变量。

## 46.5 一张「谁拦谁」的对照

| 想拦什么       | 在哪拦                | 文件                                                              |
| -------------- | --------------------- | ----------------------------------------------------------------- |
| 任意命令       | 命令网关              | `platform/safe-command.ts`                                        |
| 任意出网       | 出口代理              | `platform/outbound-proxy.ts`                                      |
| 非法路径       | 路径围栏              | `runtime/workspace-path.ts`                                       |
| 改治理文件     | 路径名单              | `runtime/protected-workspace-rels.ts`                             |
| 越权工具       | 权限模式 + 角色白名单 | `agent/permission-mode.ts` + `runtime/tool-pipeline.ts`           |
| 危险工具免审批 | 审批中间件            | `runtime/tool-pipeline.ts` + `agent/dangerous-tool-policy.ts`     |
| 外发           | 唯一硬闸门            | `platform/lawyer-outbound-decision.ts`                            |
| 空转           | 三层预算              | `runtime/tool-pipeline.ts`                                        |
| 假装改完       | 空修订门 + XML 复核   | `drafts/tracked-render-hunk-gate.ts` + `drafts/tracked-xml-qa.ts` |
| 引用对不上     | 引用完整性            | `drafts/citation-integrity.ts`                                    |
| 冲突外发       | 伦理墙                | `policy/ethics-wall.ts`                                           |
| 篡改审计       | 哈希链 + 锚           | `audit/`                                                          |

## 46.6 已知坑（本章相关）

- **`tool-pipeline.ts` 只导出少数中间件**，但导出全部预算判定函数（为了让别处能提前判断）。
- **`same-turn-verify.ts` 是最复杂的一个文件**（约 30 个导出），因为它是一个完整状态机。
- **`outbound-proxy` 与 `safe-command` 的实现细节全部内部**，只有入口导出。
- **三种 child env 构建器对密钥的处理不同。**
- **`playbook-tool-lock` 只管否决**，不冻结允许清单。
- **`word-revision-core.ts` 与 `word-revision-packs.ts` 是两个文件**：前者是机制，后者是九个族的具体内容（1145 行）。
- **`domain-state.ts` 在 `application/` 不在 `platform/`。**
- **`lawyer-automations.ts` 的邮件函数和 `mail/` 模块不是一回事**（前者读写工作区邮件文件，后者是 IMAP/SMTP）。
- **`policy/edition.ts` 的 18 个功能键**是三档都要给值的。
- **`platform/safe-command.ts` 与 `electron/safe-shell-command.mjs` 是两套不同规则**——只共用一个 `safe_command` 审计名。别以为改一处会同步。
