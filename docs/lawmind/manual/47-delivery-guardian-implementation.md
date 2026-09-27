# 第 47 章 实现精读：交付、审稿与质量

这一章讲 `deliverables/`、`guardian/`、`delivery/`、`evaluation/`、`metrics/`。合起来是「一份稿子凭什么能交出去」以及「怎么知道自己做得怎么样」。

## 47.1 `deliverables/`（17 个文件）

### 规格与验收

| 文件                        | 导出                                                                                                                                                                                                        |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `types.ts`                  | 纯类型：`DeliverableSpec`、`RequiredSection`、`PlaceholderRule`、`ReasoningGateSpec`、`AcceptanceCheck`、`AcceptanceReport`、`ReasoningCheck`、`ReasoningReport`、`ValidateDraftOptions`、`ValidateDraftFn` |
| `registry.ts`               | `BUILT_IN_DELIVERABLE_SPECS`、`getDeliverableSpec`、`listDeliverableSpecs`、`registerExtraDeliverableSpecs`、`clearExtraDeliverableSpecs`、`listExtraDeliverableSpecs`                                      |
| `lawyer-work-specs.ts`      | 只导出 `LAWYER_WORK_SPECS`（16 个律师文书规格的数组）                                                                                                                                                       |
| `validator.ts`              | 只导出 `validateDraftAgainstSpec`、`isDraftReadyForRender`                                                                                                                                                  |
| `acceptance-lawyer-copy.ts` | `humanizeAcceptanceLabel`、`buildAcceptanceChatPrompt`、`formatRenderGateRefusal`（导出失败与审核台共用的律师句子）                                                                                         |
| `workspace-loader.ts`       | `loadWorkspaceDeliverableSpecs`、`applyWorkspaceDeliverableSpecs`（引擎与 CLI 同一门）、`parseDeliverableSpec`、类型                                                                                        |

**`registry.ts` 是「注册表」**：内置 27 个 + 工作区额外注册的（`customDeliverableSpec`，Solo 默认开；引擎工厂在 feature 关闭时跳过加载）。

**内置 27 个是两批合起来的**：`registry.ts` 里 10 个（租赁、通用合同、催告函、合同审查、诉讼提纲、四类报告、培训课件）+ `LAWYER_WORK_SPECS` 16 个 + 末尾的 `document.general`。

**`validator.ts` 只导出两个函数**——验收主流程在 `validateDraftAgainstSpec`（第 12.4 节）。可核对的内容提醒在同目录 `content-checks.ts`，缺了才追加，不挡导出。

### 辅助判断

| 文件                         | 导出                                                                                                                                                                                                                                | 作用                          |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| `placeholder-pattern.ts`     | `EXPLICIT_TODO_PLACEHOLDER`、`SCAFFOLD_PLACEHOLDER_PATTERN`、`DEFAULT_PLACEHOLDER_PATTERN`、`SCAFFOLD_FIELD_HINTS`、`isScaffoldFieldLabel`、`findScaffoldPlaceholders`、`countScaffoldPlaceholdersInDraft`、`isHighScaffoldDensity` | 占位符识别与骨架密度          |
| `draft-sanity.ts`            | `countPlaceholderLikeMarkers`、`heuristicPlaceholderRatio`                                                                                                                                                                          | 启发式占位符比例（阈值 0.38） |
| `scaffold-status.ts`         | `describeDraftScaffold`、`draftPlainTextLength`、`DraftScaffoldView`                                                                                                                                                                | 交给界面的骨架视图            |
| `draft-deliverable-infer.ts` | `inferDeliverableTypeForAcceptance`                                                                                                                                                                                                 | 元数据陈旧时猜类型            |
| `deliverable-readiness.ts`   | `assessDeliverableReadiness`、类型（六种 blocker 码）                                                                                                                                                                               | 一眼看「能不能交」            |
| `verification-checklist.ts`  | `listVerificationChecklistSpecs`、`resolveVerificationChecklistSpec`、`buildChecklistView`、`checkAllRequiredChecklistItems`、`assertChecklistCompleteForApprove`、`emptyChecklistState`、类型                                      | 必核清单                      |

**`isHighScaffoldDensity` 的两条判据**（第 12.3 节）：样本 ≥3 个，或样本 ≥2 个且正文 <200 字。

**`assessDeliverableReadiness` 的六个 blocker 码**：`not_approved`、`acceptance`、`checklist`、`citation`、`review_pending`、`reasoning`。

### 推理门（2 个文件）

| 文件                               | 导出                                                                                                                                                    |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `reasoning-validator.ts`           | `validateReasoningAgainstSpec`、`validateReasoningForDraft`、`reasoningStructureChecks`、`specRequiresReasoningGraphAtDraft`、`factsGroundedHint`、类型 |
| `reasoning-validator-workspace.ts` | `validateReasoningGraphAtDraft`（**Node-only**）                                                                                                        |

**两个文件是刻意分开的**：因为渲染层不能 import Node-only 的东西。`deliverables/index.ts` **不 re-export** `workspace-loader.ts` 与 `reasoning-validator-workspace.ts`，注释说明了原因——会让 Vite 渲染层白屏。

### 审查表（3 个文件）

| 文件                       | 导出（节选）                                                                                                                                                                                                                              |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `review-table.ts`          | `REVIEW_TABLE_TEMPLATES`、`newReviewTable`、`readReviewTable`、`writeReviewTable`、`reviewTableToMarkdown`、`reviewTableToXlsxRows`、`REVIEW_TABLE_ABSTAIN_TEXT`、`cellProvenance`、`reviewTableAcceptanceProblems`、`reviewTablePath` 等 |
| `review-table-extract.ts`  | `extractReviewTable`、`summarizeReviewExtract`、`guessDocKind`、`buildCellSource`、类型一堆                                                                                                                                               |
| `review-table-patterns.ts` | `REVIEW_PATTERNS`、`patternsForColumn`、`matchPattern`、`createPatternExtractor`、类型                                                                                                                                                    |

第 9 章讲了机制。这里补两点：

**`review-table.ts` 导出 `detectNameColumnKeys` / `reviewTableValueColumns` / `reviewTableContentColumns` 三个「列分类」函数**：它们决定验收时看哪些列（值列 vs 来源列 vs 内容列）。

**`review-table-extract.ts` 的默认值**（第 9 章列过）：并发 4（上限 16）、单文档 20 万字符、最多 120 份（上限 500）。

## 47.2 `guardian/`（10 个文件）

### `legal-guardian.ts`（最核心）

导出约 27 个。分组看：

**判定要不要跑**

`shouldRunLegalGuardianForDocument`（精确类型集合 + `letter.*` / `litigation.*` 前缀）、`isLegalGuardianEnabled`。

**证据包**

`buildGuardianEvidencePack`、`slimGuardianView`、`clipGuardianText`、`extractAnchorContext`、`deterministicGuardianGaps`、`guardianSystemPrompt`、`formatGuardianEvidenceUserMessage`。

**判定解析与聚合**

`extractFirstJsonObject`、`parseGuardianReviewerJson`、`parseGuardianItemVerdicts`、`parseGuardianVerdict`、`aggregateGuardianItems`、`aggregateMachineOnly`、`guardianExpectedItemIds`。

**失败与轮次**

`formatGuardianFailMessage`、`guardianFailToolResult`、`nextGuardianRound`、`exhaustedGuardianRecord`。

**档位与阻断**

`resolveGuardianTrackedRedlinePosture`、`guardianBlocksExport`。

**基础设施失败**

`isInfraGuardianFail`、`isInfraGuardianGapCode`、`isInfraGuardianView`。

**六个截断上限**（内部）：hunk 32、章节 12、争点 8、检查单 16、引用 16、答案 12。

### 其余八个

| 文件                   | 导出                                                                                                                                               | 作用                              |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| `types.ts`             | `LEGAL_GUARDIAN_MAX_ROUNDS = 2`、六种证据类型、`GuardianRecord`、`GuardianEvidencePack`、`GuardianGateFacts`                                       | 类型与常量                        |
| `run.ts`               | `runLegalGuardian`、`runLegalGuardianForDocument`、`runLegalGuardianForTrackedDraft`、`defaultGuardianCaller`、类型                                | 执行入口（三个）                  |
| `machine-verifiers.ts` | `MACHINE_VERIFIERS`、`machineVerifierIndex`、`hasMachineVerifier`、`runMachineVerifiers`、`buildMachineVerifyContext`、类型                        | 12 个机器验证器                   |
| `judgment-tier.ts`     | `resolveJudgmentTier`、`buildTierIndex`、`lawyerOnlyKeys`、`machineItemsByVerifier`、`wordRevisionKey`、`verificationKey`、类型                    | 分级解析（三条 fail-closed 纪律） |
| `item-judgments.ts`    | `ITEM_JUDGMENTS`、`EXPECTED_TOTAL_ITEMS = 150`、`EXPECTED_WORD_REVISION_ITEMS = 125`、`EXPECTED_VERIFICATION_ITEMS = 25`                           | 判定表                            |
| `item-outcome.ts`      | `appendGuardianItemOutcomes`、`readGuardianItemOutcomes`、`deriveFiredByTask`、`countTasksAwaitingExternalSignal`、`summarizeGuardianItemOutcomes` | 逐项结果落盘                      |
| `evidence-hash.ts`     | `hashGuardianEvidencePack`、`shouldReuseGuardianRecord`                                                                                            | 证据哈希与复用判定                |
| `store.ts`             | `guardianSidecarPath`、`readGuardianSidecar`、`readLatestGuardian`、`persistGuardianRecord`、`lawyerGuardianViewFromSidecar`                       | 侧车存储（最多 6 轮）             |

**`EXPECTED_TOTAL_ITEMS = 150` 有三条测试守着**：一处不漏、machine 项必须有可执行验证器、主观项永不编译。所以改判定表时这三个数要同步。

**`shouldReuseGuardianRecord` 的三种不复用**（第 8.14 节）：哈希不同、结论是 `skipped`、基础设施失败。

## 47.3 `delivery/`（10 个文件）

| 文件                       | 关键导出                                                                                                                                                                                            |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `types.ts`                 | `DeliveryTier`、`DeliveryRiskLevel`、`DeliveryEdition`、`DeliveryReady`、`DecisionHeader`、`JudgmentCoverageSummary`、`DeliveryPolicy`、`ProgressiveAutonomyPolicy`、`DEFAULT_PROGRESSIVE_AUTONOMY` |
| `resolve-delivery-tier.ts` | `resolveDeliveryTier`、`resolveFirmForceFullReview`                                                                                                                                                 |
| `auto-deliver.ts`          | `evaluateAutoDeliver`、`isOutboundDraft`、`recordDeliveryAutonomy`                                                                                                                                  |
| `progressive-autonomy.ts`  | `isAutonomyUnlocked`、`resolveProgressiveAutonomyThresholds`                                                                                                                                        |
| `judgement-ratchet.ts`     | `isJudgementItemPromotable`、`resolvePromotableJudgementItems`、`deriveJudgementItemSeries`、`describeJudgementPromotion`、`DEFAULT_JUDGEMENT_PROMOTION`、五种 reason 码                            |
| `decision-header.ts`       | `buildDecisionHeader`、`resolveDecisionHeader`、`formatJudgmentCoverage`                                                                                                                            |
| `judgment-labels.ts`       | `ITEM_JUDGMENT_LABELS`、`judgmentLabel`                                                                                                                                                             |
| `acceptance-pack.ts`       | `buildAcceptancePackMarkdown`                                                                                                                                                                       |
| `draft-acceptance-pack.ts` | `buildDraftAcceptancePackMarkdown`                                                                                                                                                                  |

**`DEFAULT_PROGRESSIVE_AUTONOMY = { minFirstPassRate: 0.8, minSamples: 20, maxLintEscapeRate: 0.15 }`**。

**`DEFAULT_JUDGEMENT_PROMOTION = { minSamples: 20, maxFalsePositiveRate: 0.1 }`**。

**注意 `judgement` 的拼写**：`delivery/judgement-ratchet.ts` 用英式拼写，而 `guardian/item-judgments.ts` 用美式。两个不是同一个东西（前者是棘轮，后者是判定表），但拼写差异容易看混。

**`judgment-labels.ts` 的标签是派生出来的**（从 Word 改稿清单的 `look` 字段 + 验收清单的 `label`），不是手写的表——这样加清单项时标签自动有。

## 47.4 `evaluation/`（22 个文件）

第 12.14 节讲了三层证据模型。这里按文件列。

### 基准与回放

| 文件                      | 关键导出                                                                                                                                    |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `benchmark.ts`            | `runBenchmarks`、`benchmarkPassesThreshold`、`selectReleaseGateBenchmarkResults`、`BUILTIN_BENCHMARK_TASKS`、`buildBenchmarkReportMarkdown` |
| `shadow-replay.ts`        | `runShadowReplay`、`BUILTIN_SHADOW_FIXTURES`、`loadShadowFixtures`、`defaultShadowModelScript`、`ShadowReplayFixture`                       |
| `shadow-engine-replay.ts` | `runEngineShadowReplay`、`runEngineShadowReplayCase`、`isShadowRealModelEnabled`                                                            |
| `replay-fixtures.ts`      | `BUILTIN_LEGAL_REPLAY_FIXTURES`、`listReplayFixtureCategories`                                                                              |
| `replay-gate-mapping.ts`  | `evaluateReplayGateOutcome`、`evaluateReplayFixtureStructure`、`resolveReplayDeliverableType`                                               |
| `closed-matter-shadow.ts` | 工作区影子回放的两个入口                                                                                                                    |

**六个回放类别**（`replay-fixtures.ts`）：`contract_review`、`demand_letter`、`client_update`、`evidence_index`、`matter_chronology`、`legal_memo`。

### 质量与发布

| 文件                   | 关键导出                                                                                                                         |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `quality.ts`           | `persistQualityRecord`、`readQualityRecord`、`listQualityRecords`、`buildQualityReportMarkdown`、`buildQualityDashboardMarkdown` |
| `quality-seed.ts`      | `seedQualitySnapshot`、`seedQualityAfterTask`、`flushQualityDashboard`                                                           |
| `export-json.ts`       | `writeQualityDashboardJson`                                                                                                      |
| `lawyer-scorecard.ts`  | `buildLawyerScorecard`、`scorecardDisplayRows`                                                                                   |
| `release-report.ts`    | `buildReleaseReadinessReportMarkdown`                                                                                            |
| `release-artifacts.ts` | `inspectReleaseArtifacts`、`formatReleaseArtifactsReport`、四种签名状态                                                          |
| `llm-review.ts`        | `scoreLlmReviewAgreement`（离线，不调网络）                                                                                      |
| `golden.ts`            | `promoteGoldenExample`、`listGoldenTaskIds`                                                                                      |
| `golden-recall.ts`     | `loadGoldenExamplesForDrafting`、`formatGoldenExamplesPromptBlock`、`scoreGoldenAgainstQuery`                                    |
| `metrics.ts`           | `computeCitationValidityRate`、`computeRiskRecallRate`、`computeIssueCoverageRate`（无数据返回 `null`）                          |
| `diagnostic-bundle.ts` | `buildDiagnosticBundleFiles`、`redactSecrets`、`isSafeBundleFileName`                                                            |

### 两道诚实门的实现

| 文件                      | 关键导出                                                                                                                                                                                   |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `true-manuscript-gate.ts` | `inspectTrueManuscriptGate`、`writeTrueManuscriptBaselineDrafts`、`compareTrueManuscriptAgainstBaseline`、`runTrueManuscriptGateCli`、`TRUE_MANUSCRIPT_DIR_REL`                            |
| `human-baseline.ts`       | `inspectHumanBaselineGate`、`classifyBaselinePair`、`scoreSide`、`compareSides`、`buildBlindPacket`、`runHumanBaseline`、`writeHumanBaselineBlindPackets`、`HUMAN_BASELINE_MIN_CASES = 10` |

**人类基准的三种判定结果**：`lawmind_above` / `tie` / `lawmind_below`。

**`diagnostic-bundle.ts` 的脱敏正则**是关键词黑名单（api key / secret / token / password / credential / authorization / bearer / activation code / private key / envfile）。所以诊断包不含这些。

## 47.5 `metrics/`（11 个文件）

| 文件                        | 关键导出                                                                                                                                                                                         |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `runtime-events.ts`         | `appendRuntimeEvent`、`listRuntimeEvents`、`recordToolCallEvent`、`recordLintRunEvent`、`recordLawyerEditEvent`、`resolveDeliverSignals`、`recordDeliverEvent`、`DeliverHumanAcceptance`（三态） |
| `product-metrics.ts`        | `appendProductMetric`、`readProductMetricEvents`、`summarizeProductMetrics`、九种 `ProductMetricKind`                                                                                            |
| `lint-escape-candidates.ts` | `readEscapeCandidates`、`readEscapeCorpus`、`readEscapeStance`、`readLintEscapeFiles`、`distributeLintEscape`                                                                                    |
| `decision-samples.ts`       | `collectDecisionSamples`、`writeDecisionSamples`、`readDrillMarker`                                                                                                                              |
| `unescalated-delivery.ts`   | `listUnescalatedDeliveries`、`deriveCleanDeliveryByTask`、`summarizeExternalSignalCoverage`、`collectJudgementSeriesInput`、`collectPromotableJudgementItems`                                    |
| `firm-calibrator.ts`        | `fitFirmCalibrator`、`predictEditProbability`、`buildCalibrationDataset`、`describeCalibrationFit`、`COLD_START_MIN_SAMPLES = 40`、`COLD_START_MIN_PER_CLASS = 5`                                |
| `north-star.ts`             | `buildNorthStarSnapshot`、`persistNorthStarSnapshot`、`readNorthStarSnapshot`、`northStarPath`                                                                                                   |
| `north-star-trend.ts`       | `buildNorthStarTrend`、`persistNorthStarTrend`、`MIN_DELIVERIES_PER_BUCKET = 5`、`MIN_BUCKETS_FOR_TREND = 3`                                                                                     |
| `team-growth-dashboard.ts`  | `buildTeamGrowthDashboard`、`captureTeamGrowthBaseline`、`loadTeamGrowthBaseline`、五种指标 id                                                                                                   |
| `lawyer-dashboard.ts`       | `buildMatterHealthMetrics`、`readMatterHealthMetrics`、`buildLawyerDeskDashboard`、`formatMatterHealthRate`、`formatMatterHealthCount`                                                           |

**九种产品指标类型**：`first_pass`、`rewrite`、`rewrite_amplitude`、`gate_failure`、`triage`、`lint_escape`、`delivery_autonomy`、`review_duration`、`material_block`。

**五种团队成长指标**：`first_pass_rate`、`rewrite_rate`、`learning_process_rate`、`routing_hit_rate`、`peer_review_coverage`。

**`lawyer-dashboard.ts` 的两个格式化函数**（`formatMatterHealthRate`、`formatMatterHealthCount`）很重要：它们负责把 `null` 显示成「暂无数据」而不是 0——「诚实 null」在界面这一层的落地点。

## 47.6 三个「谁判什么」的层级

把这一章串起来看，判断分三层：

| 层           | 谁判         | 实现                                                |
| ------------ | ------------ | --------------------------------------------------- |
| 机械项       | 代码         | `guardian/machine-verifiers.ts` 的 11 个验证器      |
| 需要看内容的 | 独立审稿模型 | `guardian/legal-guardian.ts`                        |
| 主观/责任项  | 律师         | `deliverables/verification-checklist.ts` 的必核清单 |

**分级表在 `guardian/item-judgments.ts`**（150 项），三条 fail-closed 纪律在 `judgment-tier.ts`。

**再加上一层「交付档位」**（`delivery/resolve-delivery-tier.ts`）决定「要不要人再看一眼」，以及「棘轮」（`judgement-ratchet.ts`）决定「哪一项可以从律师手里交出去」。

四层合起来就是第 12 章那张「交付判定体系」的全貌。

## 47.7 已知坑（本章相关）

- **`deliverables/index.ts` 刻意不 re-export 两个 Node-only 文件**（会导致渲染层白屏）。
- **`EXPECTED_TOTAL_ITEMS = 150` 有三个数要同步**（150/125/25）。
- **`judgement`（英式）与 `judgment`（美式）分属两个模块。**
- **`delivery/judgment-labels.ts` 的标签是派生的**，不是手写表。
- **`metrics` 的比率无样本返回 `null`**，界面靠 `formatMatterHealth*` 显示成「暂无数据」。
- **`evaluation/llm-review.ts` 不调网络**（离线评分）。
- **`true-manuscript-gate` 与 `human-baseline` 没夹具就 SKIP**，别拿示例文件凑。
- **`metrics/firm-calibrator` 样本不足返回 `undefined`**，不给默认概率。
- **`delivery/auto-deliver` 要求零 blocker 且零 warning。**
