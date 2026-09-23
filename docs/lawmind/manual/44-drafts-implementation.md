# 第 44 章 实现精读：`drafts/`

`src/lawmind/drafts/` 是改稿这条线的主体（32 个实现文件）。第 8 章讲了机制，这一章逐文件讲实现。

## 44.1 最短改动三件套

### `minimal-edit-script.ts`（核心算法）

导出：

| 符号                                                | 作用                                     |
| --------------------------------------------------- | ---------------------------------------- |
| `MINIMAL_ANCHOR_CHARS = 4`                          | 认为「没动」的最短公共片段               |
| `MINIMAL_EDIT_MAX_UNCHANGED_RUN = 6`                | 一处改动内允许的连续未改文字上限         |
| `computeMinimalEditSpans(before, after)`            | 算最短改动（返回 `MinimalChangeSpan[]`） |
| `longestUnchangedRunInside(span)`                   | 一处 span 里最长的未改连续文字           |
| `auditMinimalEditSpans(params)`                     | 审计（返回 `MinimalEditViolation[]`）    |
| `INSERT_ANCHOR_CHARS = 6`                           | 纯插入的锚点长度                         |
| `expressInsertAsAnchorReplace(params)`              | 把纯插入改写成「锚点整体替换」           |
| `insertPointInAfterText(span)`                      | 纯插入在改后文本里的插入点               |
| `MINIMAL_EDIT_RULE_LINE` / `MINIMAL_EDIT_RULE_TEXT` | 给模型看的两条规则文本                   |

**内部还有三个常量**（不导出）：`ANCHOR_MAX_CHARS = 120`、`ANCHOR_MAX_OCCURRENCES = 16`、`MAX_SPANS = 400`。

**读它的顺序**：先读文件头（算法说明与两条可证明性质），再读 `computeMinimalEditSpans`，最后读测试里的 200 组随机对照。

**`expressInsertAsAnchorReplace` 为什么存在**：因为 Word/officecli 的「插入」需要一个锚点，纯插入没有「被删的文字」。所以把「在某处插入 X」改写成「把锚点 N 字替换成 锚点+X」——**一个字都不删**。

### `surgical-diff.ts`

导出：`extractMinimalEditSpan`、`splitSurgicalEditSpans`、`applySpanToBody`、`formatOfficeCliFindArg`、`disambiguateLiteralFind`、`toTrackedFindReplace`、`buildContractBodySectionsFromText`、类型 `SurgicalEditSpan` / `TrackedFindReplace`。

| 函数                                | 干什么                                                       |
| ----------------------------------- | ------------------------------------------------------------ |
| `extractMinimalEditSpan`            | 单个 span 的提取（前后缀裁剪）                               |
| `splitSurgicalEditSpans`            | 多 span 拆分（**B2 边界用它**）                              |
| `applySpanToBody`                   | 把 span 应用到正文（重复子串时取**离原位置最近**的那一处）   |
| `disambiguateLiteralFind`           | 多处命中时用后顾锚点消歧（试 `[8,12,16,24,32,48]` 六个宽度） |
| `formatOfficeCliFindArg`            | 组装 officecli 的 `--find` 参数（正则要用 `r"..."` 前缀）    |
| `toTrackedFindReplace`              | 转成可落盘的 find/replace（纯插入用 16 字后顾）              |
| `buildContractBodySectionsFromText` | 把纯文本按空行切成段落节                                     |

**`applySpanToBody` 那条「取最近的一处」是踩坑修出来的**：注释写着「同段多处相同短语时第一处常常改错位置」。

### `surgical-span-gate.ts`（模型自查）

导出 `SURGICAL_MAX_FIND_CHARS = 48`、`SURGICAL_MAX_FIND_WITH_TERMINATOR = 12`、`commonAffixLength`、`explainSurgicalSpanViolation`。

**注意它现在的定位**：文件头注释写明「引擎**不再按长度拒绝**」，这些是**模型自查经验值**。真正的判定是 `minimal-edit-script.ts` 的重算。

四种违规文案（`explainSurgicalSpanViolation`）：find 含多个句末标点、find 过长（≥120）、含句读的 find >12 字、含句读的 find 保留不足 80%。

### `surgical-edit-gate.ts`（幅度门）

导出 `resolveSurgicalEditLimits`、`estimateChangedChars`、`surgicalAmplitudeEnforceEnabled`、`evaluateSurgicalEditGate`、`evaluateSurgicalEditGateHard`、`craftSignalsFromAmplitudeGate`、`attachRewriteAmplitudeMeta`、`auditSurgicalEditGateSoft`、`SURGICAL_CONTRACT_EDIT_PROMPT`、类型。

**软硬两条路**：`evaluateSurgicalEditGate` 是软（指标 + 教练），`evaluateSurgicalEditGateHard` 是硬（`LAWMIND_SURGICAL_ENFORCE=1` 时启用）。

默认阈值：绝对差 400 字符、相对比例 0.25；实际限制取 `min(max(40, 字符数×比例), 400)`。

## 44.2 落改与收窄

### `apply-surgical-edits.ts`（B1 边界）

导出：`applySurgicalTextEdits`、`parseSurgicalEditsInput`、`applySurgicalEditsToDraft`、`explainInvalidSurgicalEdit`、`tryNarrowSurgicalEdit`、`explainNonMinimalSurgicalEdit`（废弃别名）、类型 `SurgicalTextEdit` / `ApplySurgicalEditsResult`。

**内部两个常量**：`ABSURD_BATCH_CEILING = 500`（只是防空转的护栏，不是编辑条数配额）、`MAX_SPANS_PER_EDIT = 64`。

**结果里的 `minimalSplitEdits`**：告诉模型「你这一处被拆成了几段」。

**`tryNarrowSurgicalEdit`**：当一处改动落不下去时，尝试收窄锚点。要求前后缀合计 ≥2 字，收窄后长度不能超过含句读的上限。

**跳过原因是五句固定文案**：find 为空、find 与 replace 相同、过于碎片化无法收窄、正文中未找到 find 原文、下标漂移无法定位。

### `resolve-surgical-edits.ts`

只导出 `resolveSurgicalEditsForApply`。

**它的判断很重要**：如果是锁定路径（`wordRevisionTurn` 或 `mailContractTurn`），**必须**有 edits；否则（解锁路径）可以从修订计划侧车回落。

两种报错分别是「edits 必须是非空数组…」和「edits 为空，且 `drafts/<taskId>.redline-plan.json` 无可用条目。请先在意见里写『原句』→『推荐措辞』，或传入 edits。」

## 44.3 修订计划与提案

### `redline-plan.ts`

导出 `normalizeRedlinePlanItems`、`writeRedlinePlan`、`readRedlinePlan`、`redlinePlanPath`、`buildXmlQaRetryHint`、`formatRedlinePlanPromptBlock`、`shouldInjectRedlinePlanProtocol`、类型 `RedlinePlanItem` / `RedlinePlan`。

**`RedlinePlanItem` 带 `priority`（P0/P1/P2）与 `narrowed` 两个额外字段**——计划可以标优先级，也可以记「这条已经被收窄过」。

**`shouldInjectRedlinePlanProtocol`** 决定这个协议要不要注入（意见书交付不要、工具表里没有相关工具不要、绑定的是合同审查/邮件合同/修订轨才要）。

### `redline-proposal.ts`（B2 边界的出口）

导出 `generateRedlineProposal`、`readRedlineProposal`、`writeRedlineProposal`、`resolveRedlineHunk`、`resolveAllRedlineHunks`、`summarizeRedline`、`prepareRedlineBaselineBeforeWrite`、`generateRedlineAfterWrite`、`resetRedlineBaselineFromDraft`、`redlineMatchesDraft`、`withContractEditBaseline`、`redlineProposalPath`、类型。

**四个「写口」要分清**：

| 函数                                | 什么时候用                     |
| ----------------------------------- | ------------------------------ |
| `prepareRedlineBaselineBeforeWrite` | 写正文**之前**固定基线         |
| `generateRedlineAfterWrite`         | 写正文**之后**生成提案         |
| `resetRedlineBaselineFromDraft`     | 手工改过正文后重置基线         |
| `redlineMatchesDraft`               | 判断提案和当前正文是否还对得上 |

**`withContractEditBaseline`** 是「把合同编辑基线挂到草稿上」的包装。

**锁**：`<redline.json>.lock`，注释说明它包住「读提案 → 改正文/baseline → 写提案」整段。

### `opinion-redline-plan.ts`

`parseRecommendedWordingEdits`、`buildRedlinePlanFromOpinion`、`writeRedlinePlanFromOpinion`。

**用途**：把意见书里的「推荐措辞」变成修订计划（解锁的合同审查路径）。

### `contract-review-edits.ts`

`parseContractReviewEditProposals`、`proposalsToSurgicalEdits`、`extractStructuredReviewEdits`、`formatStructuredEditsSection`。

**「结构化编辑提案」是首选路径**，散文解析只是兼容回落（注释写明了这一点）。

## 44.4 合同基线（3 个）

### `contract-edit-baseline.ts`

导出很多：`resolveExistingWordBaseline`、`resolveExistingDocxRelativePath`、`collectContractBaselineCandidates`、`resolveFirstExistingWordBaseline`、`stampContractEditBaselineIfNeeded`、`seedDraftSectionsFromContractBaseline`、`enrichDraftWithContractEditBaseline`、`draftLooksLikeContractBody`、`draftLooksLikeContractOpinion`、`shouldSeedSectionsFromBaseline`、`normalizeWorkspaceRelativePath`、`extractDocxRelativePathsFromText`、类型。

**三个「像不像」判断**：像合同正文、像审查意见、要不要用基线填充章节。这些判据决定走哪条导出路。

**支持的扩展名**：`.docx` 和二进制 `.doc`（**不含 `.docm`**，注释写明）。

### `contract-redline-craft.ts`

`CONTRACT_REDLINE_CRAFT_SKILL`（代码里的技能正文，**不读文件**）、`craftSignalsForEdit`、`evaluateCraftCheck`、`parseCraftCheckInput`、类型 `SurgicalCraftSignal` / `CraftCheckInput`。

五种信号：`wide_span_sentence`、`wide_span_clause`、`large_delta`（Δ>40）、`low_retention`（保留率<0.35）、`craft_check_missing`。

**为什么技能正文在代码里**：它和引擎的具体门槛强绑定（第 20 章讲过）。

### `paired-review-body.ts` / `paired-review-deliverable.ts`

`draftHasOpinionScaffoldHeadings`、`shouldPreparePairedRedlineBody`、`preparePairedRedlineBody`、`wordFilePinRelPaths`、`pinsIncludeWordFile`、`shouldInjectPairedReviewDeliverable`、`formatPairedReviewDeliverablePromptBlock`。

**这两个文件处理「成套审查」**：意见稿 + 修订稿一起交。注意它们**在邮件短路径和文件页 Word 改稿上不生效**（注释写明）。

## 44.5 门禁（3 个）

### `tracked-render-hunk-gate.ts`

`MIN_TRACKED_RENDER_HUNKS = 1`、`evaluateTrackedRenderHunkGate`、`TrackedRenderHunkGateResult`。

判定逻辑：`!hasContractEdit || allowEmpty === true || count >= minHunks` 通过；否则返回 `redline_hunks_required` 与那句文案。

### `tracked-xml-qa.ts`（B5 边界）

`qaTrackedDocxXml(filePath, expectedHunks)`、`extractRevisionRuns`、`findNonMinimalRevisionPairs`、`TrackedXmlQa`。

**三个内部门槛**：`XML_PAIR_MIN_SIDE_CHARS = 12`、`XML_PAIR_MIN_UNCHANGED_RUN = 8`、`XML_PAIR_MIN_SHARED_RATIO = 0.6`。

**为什么用 8 而不是 6**（注释原文）：officecli 可能把一处替换切成多个 `w:del`/`w:ins` 片段，相邻片段未必属于同一对。要在**文件级**下断言，门槛必须收到「几乎不可能是巧合」的量级。

### `xml-qa-auto-retry.ts`

`shouldAutoRetryXmlQa`、`applyNarrowedPlanOnce`、`XmlQaAutoRetryResult`。

**三条路径都生效**：解锁合同审查、邮件短路径、Word 改稿锁定。

### `legacy-update-draft-warning.ts`

`isLockedContractEditTurn`、`shouldRejectLegacyUpdateDraftBody`、`noteLegacyUpdateDraftBodyWarning`、`craftPatchFromToolResult`、`promoteLegacyUpdateDraftCraftPatch`、`mergeLegacyUpdateDraftWarningIntoCraft`、三个常量。

**用途**：拦住「锁定路径上还用老的 `update_draft` 改正文」这种行为。

## 44.6 跨文书

### `cross-document-edits.ts`

导出 `planCrossDocumentEdits`（纯读预检）、`applyCrossDocumentEditsToSections`（纯函数落笔）、`parseCrossDocumentEditsInput`、`formatCrossDocumentSummary`、`manifestPath`、类型一堆。

**两个关键类型字段**：

- `CrossDocumentOccurrenceMode = "first" | "all"`（多处命中必须显式声明 `all`）。
- `CrossDocumentPlanConflict` 带 `anchor_ambiguous` 之类的码。

**`MAX_SPANS_PER_CROSS_EDIT = 64`**（和单文书那条同一口径）。

**注意它是纯函数**（不碰文件系统），持久化和 Redline 由调用方负责。

## 44.7 引用、出处与受众（5 个）

| 文件                    | 关键导出                                                                                               | 作用                           |
| ----------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------ |
| `citation-integrity.ts` | `validateDraftCitationsAgainstBundle`、`CitationIntegrityResult`、`DraftCitationIntegrityView`         | 检查章节引用能不能对上检索结果 |
| `citation-resolve.ts`   | `resolveDraftCitationIntegrity`                                                                        | 上一条的封装（拿快照再验）     |
| `citation-craft.ts`     | `CITATION_GROUNDING_SKILL`、`formatCitationGateCoach`                                                  | 引用教练                       |
| `provenance.ts`         | 八种事件类型 + 一堆读写函数                                                                            | 段落的出处链                   |
| `audience-split.ts`     | `inferDraftAudience`、`shouldInjectAudienceSplit`、`formatAudienceSplitPromptBlock`、`DRAFT_AUDIENCES` | 对内/对外之分                  |
| `source-boundary.ts`    | `formatSourceBoundaryBody`、`formatSignOffLine`                                                        | 已核验/未核验/缺口栏目         |

**`citation-integrity` 的 `UNANCHORED_BODY_MIN_LENGTH = 80`**：超过 80 字的章节没有引用会被标「未锚定」（但仍不判 `ok: false`）。

**`provenance` 的八种事件**：`upload`、`extraction`、`ai_suggest`、`lawyer_edit`、`lawyer_accept`、`self_revise`、`import`、`export`。

## 44.8 快照（3 个）

三个结构一样的小模块，各自存一份侧车：

| 文件                    | 侧车                         | 内容         |
| ----------------------- | ---------------------------- | ------------ |
| `research-snapshot.ts`  | `drafts/<id>.research.json`  | 检索结果     |
| `reasoning-snapshot.ts` | `drafts/<id>.reasoning.json` | 推理图       |
| `clause-snapshot.ts`    | `drafts/<id>.clauses.json`   | 条款解析结果 |

每个导出 `*Path` / `persist*` / `read*`。

**为什么要有快照**：因为验收与审稿要看「当时依据什么」。没有快照，事后无法复核引用是否真的对上。

## 44.9 术语与修订持久化（2 个）

### `terminology-adapt.ts`

`extractDefinedTerms`、`extractDefinedTermsFromText`、`detectTerminologyDrift`、`alignTerminology`、`introducedTerminologyDrift`、`terminologyWarningsPatch`、`CONTRACT_ROLE_WORDS`（31 个角色词）、类型。

**三种定义来源**：引号定义（`"XX"系指…`）、括号别名（`XX（以下简称YY）`）、角色词表。

### `revision-persisted.ts`

`snapshotDraftRevisionBaseline`、`turnHasSuccessfulDraftWrite`、`draftRevisionWasPersisted`、`buildRevisionRetryInstruction`。

**用途**：确认后台修订真的把文件落盘了（防「只在聊天里说改了」）。第 8 章那个 `revision_not_persisted` 错误就是它产生的。

## 44.10 持久化与索引

### `index.ts`

只导出四个：`draftPath`、`persistDraft`、`readDraft`、`deleteDraft`、`listDrafts`。

**注意 `index.ts` 还做大量 re-export**（第 8.6 节列过侧车清单与排除规则）。读代码时如果某个函数在 `index.ts` 里找不到定义，是 re-export。

## 44.11 两条最容易混的边界

| 看起来                                                        | 实际                                                   |
| ------------------------------------------------------------- | ------------------------------------------------------ |
| `apply-surgical-edits` 和 `splitSurgicalEditSpans` 都在做拆分 | 前者是**模型输入侧**（B1），后者是**提案生成侧**（B2） |
| `surgical-span-gate` 还叫「门禁」                             | 它现在只是**模型自查经验值**，不是硬拦                 |

## 44.12 已知坑（本章相关）

- **`contract-redline-craft` 的正文来自代码常量。** 改 md 文件不生效。
- **`surgical-span-gate` 不是硬门禁。** 判定靠重算。
- **纯插入会被改写成锚点替换。** 所以修订轨里会看到「锚点被替换」而不是「纯插入」。
- **多处命中要显式声明 `occurrences: "all"`。** 否则整处跳过（跨文书是整批停）。
- **XML 复核的门槛（8 字/60%）比内存里（6 字）严，这是有意的。**
- **`paired-review-*` 在邮件短路径与 Word 文件页不生效。**
- **`redline-plan.json` 的 `priority` / `narrowed` 是计划层字段**，不影响落改。
- **`provenance` 的事件类型是八种**，新增要同步 `ProvenanceEventType` 联合。
