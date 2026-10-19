# 第 48 章 实现精读：检索、记忆与集成

这一章讲 `retrieval/`、`research/`、`indexing/`、`memory/`、`learning/`、`stance/`、`mail/`、`matter-replica/`、`integrations/`、`mcp/`。

## 48.1 `retrieval/`（34 个 .ts 文件：根 18 个 + `providers/` 16 个）

### 入口与合并

| 文件                                         | 关键导出                                                                                                                                                                               |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `index.ts`                                   | `retrieve`、`claimArticleGrounded`、`createWorkspaceAdapter`、`articleOrdinal`、`RETRIEVAL_ADAPTER_DEADLINE_MS = 20_000`；合并时 20 秒超时、同 id 保留非演示来源、条号对不上来源则降级 |
| `authority-adapter.ts`                       | `createAuthorityAdapterFromEnv`                                                                                                                                                        |
| `authority-provider.ts`                      | `resolveAuthorityProvider`（`LAWMIND_AUTHORITY_PROVIDER`：`open` / `generic` / `pkulaw` / `lexis`，默认 `open`）                                                                       |
| `providers.ts`                               | `createDomesticGeneralAdaptersFromEnv`、`createOpenSourceLegalAdaptersFromEnv`、`createLexEdgeAdapterFromEnv`、`createPartnerLegalAdapterFromEnv`                                      |
| `model-adapters.ts` / `openai-compatible.ts` | 模型型检索适配器                                                                                                                                                                       |
| `schema.ts`                                  | `validateModelRetrievalOutput`（zod 校验模型输出）                                                                                                                                     |
| `retrieval-amplify.ts`                       | `RETRIEVAL_POOL_CAP = 200`、`RETRIEVAL_KEEP = 20`、`RETRIEVAL_ROUNDS = 3`；对角分数上的乘法加权放大，注释明写「不是量子搜索」                                                          |

**`createWorkspaceAdapter` 是唯一「永远支持」的适配器**（`supports: () => true`）。`providers.ts` 里还有一张模块内的 `GENERAL_PROVIDER_PRESETS` 预设表（不导出），四个工厂函数都按它建适配器。

### 诚实与安全

| 文件                          | 关键导出                                                                                                                                                                                    |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `authority-hits.ts`           | `mapHitsToRetrievalResult`、`mapAuthorityKind`、`authorityHttpErrorResult`、`unsetAuthorityResult`、`invalidAuthorityEndpointResult`、`AuthorityHit`                                        |
| `authority-gap.ts`            | `isAuthorityGap`、`formatAuthorityGapLawyerNotice`、`authorityGapFromToolResult`、`isDemoCorpusResult`、`demoCorpusFromToolResult`、`formatDemoCorpusLawyerNotice`、`DEMO_CORPUS_RISK_FLAG` |
| `authority-health.ts`         | `buildAuthorityCorpusSummary`、`validateAuthorityEndpointUrl`、`probeAuthorityEndpoint`                                                                                                     |
| `authority-source-tier.ts`    | `resolveAuthoritySourceTier`、`isAuthorityLive`、`isAuthorityOfficialPublic`                                                                                                                |
| `authority-usage.ts`          | `recordAuthorityUsage`、`buildAuthorityUsageSummary`、`authorityUsagePath`                                                                                                                  |
| `authority-url-guard.ts`      | `denyReasonForAuthorityHostname`、`denyReasonForAuthorityIpAddress`、`denyReasonForAuthorityHostnameResolved`                                                                               |
| `authority-pinned-fetch.ts`   | `createPinnedAuthorityFetch`、`createPinnedAgentLookup`                                                                                                                                     |
| `case-law-readiness.ts`       | `resolveCaseLawReadiness`、`probeCaseLawSources`、`caseLawDegradedNote`、`isCaseopenAutoReady`                                                                                              |
| `brave-web-search-adapter.ts` | `createBraveWebSearchAdapter`                                                                                                                                                               |
| `url-dossier-adapter.ts`      | `createUrlDossierAdapter`                                                                                                                                                                   |

**这一组是「诚实」这条线的密集区**：`authority-gap`（缺口话术）、`authority-source-tier`（来源层级）、`case-law-readiness`（类案就绪）各管一段。

### `providers/open-law/`（子目录）

有独立的 README。核心是 `client.ts` 的 `openLawRetrieve`，模式由 `LAWMIND_OPEN_LAW_MODE` 决定：`local`（默认）、`npc_flk`、`caseopen`、`courtlistener`、`eurlex`、`egov_jp`、`hybrid`。`hybrid` 并列已启用的直播车道再合并（中国源优先，然后美/欧/日），本地 sample 只在直播全空时兜底。

**NPC 直播（国家法律法规数据库）默认开**——`npc-flk.ts` 里 `LAWMIND_OPEN_LAW_NPC` 不设就是开，显式 `0` / `false` / `no` / `off` 才关；同一个文件管节流（`NPC_FLK_MIN_INTERVAL_MS = 1_500`）与缓存（`NPC_FLK_CACHE_TTL_MS = 5 分钟`）。其余直播源各一个文件：`caseopen.ts`（自建 cncases，允许回环）、`courtlistener.ts`、`egov-jp.ts`、`eurlex.ts`，默认都关。

其余文件：`local-corpus.ts` 管 sample 与外部 `LAWMIND_OPEN_LAW_CORPUS` 的 demo 判定；`live-endpoint.ts` 管直播端点的 URL 安全检查；`sources.ts` 是来源清单与就绪度（不声称覆盖商业库）；`dump-convert.ts` 把常见开放法转储转成记录 JSONL；`sample-statutes.embedded.ts` 是打进桌面包的样本文本；`types.ts` 是记录、模式与来源 id。`corpus/`（含 `LICENSE-ATTRIBUTION.md`）与 `fixtures/` 是语料和夹具。

### `providers/pkulaw/`（子目录）

`client.ts`（`pkulawRetrieve`、`resolvePkulawMode`：`rest_compat` / `search_post` / `mcp_tools_call` 三种接入，外加 MCP 工具名与案例端点解析）、`map.ts`（`mapPkulawResponseBody`、`inferPkulawSearchKind`）、`citation-validate.ts`（`validateCitationsWithAuthority`、`isAuthorityCitationValidateEnabled`——可选的厂商引用校验钩子，`LAWMIND_AUTHORITY_CITATION_VALIDATE` 默认关，校验路径默认 `${endpoint}/validate`）。`providers/lexis/placeholder.ts` 是 Lexis 的闭源占位，未配置时只说「未接通」。

## 48.2 `research/`（15 个文件）

| 文件                            | 关键导出                                                                                                                                                                                                            |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `index.ts`                      | barrel：再导出 `url-dossier`、`research-outline`、`outline-store`、`desensitize-matter`、`deep-research-plan`、`execute-deep-research`。**但全仓库 0 个导入者**（死桶，审计 1.3），消费方全部按路径直引子模块       |
| `research-protocol.ts`          | `shouldInjectResearchProtocol`、`shouldEnforceStatuteTrial`、`statuteTrialHappenedThisTurn`、`looksLikeStatuteCitation`、`formatResearchProtocolPromptBlock`、`formatUnretrievedStatuteBody`、`STATUTE_TRIAL_TOOLS` |
| `execute-deep-research.ts`      | `executeDeepResearchPlan`、`ExecuteDeepResearchResult`                                                                                                                                                              |
| `deep-research-plan.ts`         | `buildDeepResearchPlan`、`formatDeepResearchPlanMarkdown`、类型                                                                                                                                                     |
| `query-matrix.ts`               | `buildQueryMatrix`、`formatQueryMatrixBody`、`instructionQueryTerms`、`QueryMatrix`                                                                                                                                 |
| `url-dossier.ts`                | `fetchUrlDossier`、`parseUrlList`、`extractUrlsFromText`、`mergeDossierIntoBundleParts`；模块内常量 `MAX_BYTES = 400_000`、`MAX_EXCERPT = 12_000`（不导出）                                                         |
| `research-outline.ts`           | `buildResearchOutline`、`formatOutlineMarkdown`、`outlineClarificationQuestion`、`lawyerWantsOutlineHold`；并把 `outlineLooksApproved` 从 `outline-hitl.ts` 转手再导出                                              |
| `outline-hitl.ts`               | `outlineAnswerDecision`、`applyOutlineClarificationAnswer`、`outlineLooksApproved`、`extractOutlineAnswerFromResume`、`parseOutlineMarkdownSections`                                                                |
| `outline-store.ts`              | `persistResearchOutline`、`readResearchOutline`、`approveResearchOutline`、`researchOutlinePath`                                                                                                                    |
| `outline-expand.ts`             | `expandApprovedOutlineToSections`                                                                                                                                                                                   |
| `auto-statute-trial.ts`         | `shouldAutoTrialStatute`、`runAutoTrialStatute`                                                                                                                                                                     |
| `claim-relevance.ts`            | `filterBundleByTopicRelevance`、`claimMatchesTopic`、`extractTopicTokens`                                                                                                                                           |
| `desensitize-matter.ts`         | `scanTextForTrainingLeak`、`assertTrainingDesensitizeGate`、`redactTrainingText`、`desensitizeConfirmedInText`                                                                                                      |
| `research-evidence-gate.ts`     | `evaluateResearchEvidenceGate`、`RESEARCH_EVIDENCE_GATE_REFUSAL`（另有 `hasSoftSetupHintFlags` 等判定助手）                                                                                                         |
| `research-write-bypass-gate.ts` | `shouldRefuseResearchWriteBypass`、`isResearchDeliverableWritePath`、`RESEARCH_WRITE_BYPASS_REFUSAL`                                                                                                                |

**`index.ts` 这个 barrel 是死的**：`research-protocol`、`auto-statute-trial`、`claim-relevance`、`outline-expand`、`query-matrix`、两个 gate 从头到尾不在 barrel 里，`outline-hitl` 也只有 `outlineLooksApproved` 经 `research-outline` 转了一手——而实际上连转了一手的这份 barrel 也没有任何文件 import，新增代码请继续按路径直引。

**检索协议何时注入。** `shouldInjectResearchProtocol` 在两处返回 false：没有绑定的工作流，或本轮工具表上 `RESEARCH_PROTOCOL_TOOLS` 一个都不在。文件头写的是 “Skip only when search tools are not on the table.” `STATUTE_TRIAL_TOOLS` 就是这同一张表。`shouldEnforceStatuteTrial` 转调同一函数，但不传工具表。`toolsAllowAny` 在名单缺省时返回 true，所以强制检查只看有没有绑定。

**`desensitize-matter.ts` 的六类识别**：手机号、身份证号、银行卡号、邮箱、金额、案号。手机号与身份证是 blocker，其余是 warning；`ready` = blocker 数为 0。

## 48.3 `indexing/`（10 个文件）

| 文件                      | 关键导出                                                                                                                                                                                                                           |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `index.ts`                | barrel：再导出库路径（`workspace-index-path`）、重建与同步（`fts-ingest`）、搜索（`fts-search`）、个人知识搜索（`knowledge-search`）                                                                                               |
| `workspace-index-path.ts` | `SEARCH_INDEX_SCHEMA_VERSION = 3`、`searchIndexPath`、`lawmindDir`                                                                                                                                                                 |
| `fts-schema.ts`           | `initSearchIndexSchema`、`recreateMaterialsFts`、`recreateKnowledgeFts`、`clearFtsTables`、`setMeta`、`getMeta`                                                                                                                    |
| `fts-ingest.ts`           | `rebuildWorkspaceSearchIndex`、`syncWorkspaceSearchIndex`、`workspaceSourcesChanged`、`openSearchIndexDb`、`indexExists`                                                                                                           |
| `fts-search.ts`           | `searchWorkspaceIndex`、`escapeFtsQuery`、`escapeKnowledgeFtsQuery`、`getSearchIndexStatus`、`computeSearchIndexFreshness`                                                                                                         |
| `fts-ingest-materials.ts` | `ingestMaterialsRows`、`ingestMaterialsIncremental`；`MAX_FILE_BYTES`、`CHUNK_CHARS` 是模块内常量（不导出）                                                                                                                        |
| `fts-ingest-knowledge.ts` | 把 CASE.md / 策略 / 会话摘要、`memory/**`、画像与剧本收进 `knowledge_fts`。文件头写明这一路的来源是 Markdown。排除待确认建议与受限案件。跨案先例默认不收，`LAWMIND_ALLOW_CROSS_MATTER_SEARCH=1` 才开（`isPrecedentIngestEnabled`） |
| `fts-search-materials.ts` | `searchMaterials`、`MaterialSearchHit`（**带 `page`**）                                                                                                                                                                            |
| `knowledge-search.ts`     | `searchPersonalKnowledge`、`KnowledgeDocKindFilter`、`PersonalKnowledgeHit`                                                                                                                                                        |
| `embeddings/index.ts`     | `getEmbeddingIndexConfig`、`embedTextsLocalStub`、`cosineSimilarity`、`rankHybrid`（`LAWMIND_EMBEDDING_ENABLED` 默认关）                                                                                                           |

**四张表**：`audit_fts`、`session_fts`（都用 `unicode61`）、`knowledge_fts`、`materials_fts`（都用 `trigram`）。

**`getSearchIndexStatus` 与 `computeSearchIndexFreshness` 是两个不同的东西**：前者给状态快照（含 `sourcesChanged`），后者给「陈旧原因」（`index_missing` / `last_rebuild_unknown` / `sources_changed`）。检索前 `syncWorkspaceSearchIndex` 只重写改过的文件。

## 48.4 `memory/`（33 个文件：根 25 个 + `kernel/` 8 个）

第 37 章逐个讲过（含内核），这里只补最容易搞错的几件。

**记忆有两层，都在用。** `memory/index.ts` 的文件头仍按固定顺序加载 Markdown：`MEMORY.md`、`LAWYER_PROFILE.md`、`FIRM_PROFILE.md`、playbook、`cases/<id>/CASE.md` 与策略、客户画像、按日日志。这是进回合的文档层。内核契约 `kernel/contract.ts` 另写一句：「真相源是工作区里的 SQLite（`lawmind/memory-kernel.sqlite`）。Markdown / 立场 JSON 是给人看的投影，以及旧数据的导入来源。」那句话管的是内核记录，不取消上面那层 Markdown。

**128k 时提示窗（`prompt-windows.ts`，`scale = 1`）**：`matterIndexChars` 1600，律师 / 客户 / 助手三份指纹各 800，`memoryHitGistChars` 180。`clampPromptWindowScale` 把系数夹在 0.5–8，能力包络直接调用它（第 55.4 节）。

**界面。** 设置里的记忆库是 `apps/lawmind-desktop/src/renderer/LawmindMemoryLibrary.tsx`（`LawmindSettingsMemory.tsx` 挂三种视图）。案件认知面板的 `MatterMemoryInspector` 只是包一层，视图固定 `matter`。`MemoryInspector.tsx` 不再挂进产品界面，只留 `MemoryInspector.batch.test.tsx`。

**`project.note` 没有写面。** `adoption-apply.ts` 这个分支返回 `noopReason`（「project 暂无落盘存储面」）。`adoption-service.ts` 据此把状态写成 `recorded_noop`，并记 `memory.adoption_recorded_noop`，不写成 `adopted`。

内核八个文件：

| 文件                           | 干什么                                                                                                                                                               |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `kernel/contract.ts`           | 契约：`MEMORY_KERNEL_SCHEMA_VERSION = 1`、五种 kind、四个 scope、`pending` / `confirmed` / `dismissed` × `current` / `superseded` / `revoked`、六个 `habit.*` 写法槽 |
| `kernel/store.ts`              | SQLite 的插入、替换、检索和记录间边（supersedes）                                                                                                                    |
| `kernel/gateway.ts`            | 提交、确认、撤回、恢复、驳回与记忆库列表（`commitMemory` / `confirmMemory` / `revokeMemory` 等）                                                                     |
| `kernel/query.ts`              | 按本轮范围挑「已确认且当前有效、无当事人冲突」的记录，格式化进提示块                                                                                                 |
| `kernel/migrate.ts`            | 旧 Markdown 记忆首次使用时导入内核                                                                                                                                   |
| `kernel/consolidate.ts`        | 多案重复出现的同一写法收成一条内核记录（确认后才通用）                                                                                                               |
| `kernel/retract-projection.ts` | 撤回或恢复一条记忆在 Markdown 上的投影                                                                                                                               |
| `kernel/sync-stance.ts`        | 把立场库条目同步进内核（kind 为 `stance`）                                                                                                                           |

**目录外的内核消费方已有四处**：`stance/store.ts`、`learning/apply-review-labels.ts`、`agent/turn-orchestrator-prompt.ts`、`agent/tools/legal/precedent-search-tool.ts`。也就是说「内核只服务记忆库界面」已经不对了。

根目录 25 个文件的两个旧观察要改口径：

**导出计数（按 `export` 符号，含再导出）**：`index.ts` 38 条（加载、路径、案件段落、来源报告、迁移、画像与剧本学习）。`kernel/contract.ts` 18 条。`adoption-service.ts` 17 条（含 `recorded_noop`）。`prompt-windows.ts` 10 条。

**写入入口**：`write-gateway.ts` 导出 `writeCaseMemorySection`，并再导出 `suggestMemoryAdoption`（另有两个类型）。`unified-pending-adoptions.ts` 导出 `listPendingAdoptionsUnified`（外加类型 `UnifiedPendingAdoption`），合并记忆服务与学习队列里尚未镜像的待确认项。

**`case-workspace.ts` 不 import `index.ts`**（避免循环）——这是结构上的一个刻意决定。

## 48.5 `learning/`（15 个文件）

第 37 章逐个讲过。这里补三个观察：

1. **没有 barrel**（`learning/index.ts` 不存在），要按路径 import。
2. **多数文件是「写一个队列/文件」**；`assistant-growth.ts` 与 `agent-specialization.ts` 是读聚合（后者再把汇总好的专精指标写回 `quality/agent-specialization.json`）。
3. **`contract-revision-pack.ts` 的存储最复杂**（一个目录 + 一份按关键点的索引）。

## 48.6 `stance/`（7 个文件）

| 文件               | 关键导出                                                                                                                                                                                           |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `index.ts`         | barrel：类型、库读写、capture、inject、firm-defaults、self-check 全部再导出                                                                                                                        |
| `types.ts`         | `STANCE_SCHEMA_VERSION`、`STANCE_CLAUSE_TYPE_IDS`、`StanceItem`、`StanceEvidenceEntry`、`StanceFamily`、`StanceSource`                                                                             |
| `store.ts`         | `readStanceItems`、`writeStanceItems`、`mutateStanceItems`、`stanceItemsPath`、`MAX_EVIDENCE_ENTRIES = 50`；**同步记忆内核**（见 48.4）                                                            |
| `inject.ts`        | `selectInjectableStances`、`formatStanceHint`、`MIN_HINT_CONFIDENCE = 0.4`、`MIN_DISTINCT_EVIDENCE_MATTERS = 2`                                                                                    |
| `capture.ts`       | `captureStanceFromRedline`、`upsertStanceFromRedline`、`upsertStanceFromKeyModification`、`writeStanceFromHabit`、`stanceConfidenceFromEvidence`、`detectStanceClauseType`、`STANCE_SOURCE_WEIGHT` |
| `firm-defaults.ts` | `ensureFirmStanceDefaults`（两条预置立场）                                                                                                                                                         |
| `self-check.ts`    | `stanceSelfCheck`、`stance.unapplied` finding                                                                                                                                                      |

**`STANCE_CLAUSE_TYPE_IDS` 七种**：管辖、违约金、保密、赔偿、定金、知识产权、其他。注释写明这只是供筛选的常见条款名，写入时不靠这张表拒绝别的说法。

**`STANCE_SOURCE_WEIGHT` 是四档权重**（habit_adopt 0.5 > manual 0.45 > revision_pack 0.4 > redline 0.25），置信度按 1 − Π(1 − w) 累积，天然有界。

## 48.7 `mail/`（16 个文件）

| 文件                       | 关键导出                                                                                                                                                                                       |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `index.ts`                 | barrel：预设、账号、机密、收发与发件格式的再导出                                                                                                                                               |
| `imap-client.ts`           | `testImapConnection`、`fetchImapMessages`、`shouldPersistMailAttachment`、`writeFetchedAttachments`；上限 `MAX_MAIL_ATTACHMENT_BYTES = 20 MB`、合计 `MAX_MAIL_ATTACHMENTS_TOTAL_BYTES = 60 MB` |
| `smtp-client.ts`           | `sendSmtpMail`                                                                                                                                                                                 |
| `graph-mail.ts`            | `testGraphMailConnection`、`fetchGraphMessages`、`sendGraphMail`                                                                                                                               |
| `sync-inbox.ts`            | `testMailAccountConnection`、`syncMailAccountToMatter`、`syncMatterMailbox`、`sendMailViaAccount`、`countEnabledMailAccounts`、`persistFetchedMessages`                                        |
| `provider-presets.ts`      | `MAIL_PROVIDER_PRESETS`（gmail / outlook / microsoft365 / qq / 163 / imap 六种）、`resolveImapEndpoints`、`resolveSmtpEndpoints`                                                               |
| `mail-accounts.ts`         | `listMailAccounts`、`upsertMailAccount`、`resolveMailAccountForMatter`、`toPublicMailAccount` 等                                                                                               |
| `mail-secrets.ts`          | `getMailAccountSecret`、`upsertMailAccountSecret`、`hasMailAccountSecret`；v2 是加密信封格式（v1 为明文 JSON）                                                                                 |
| `mail-attachments.ts`      | `resolveOutboundAttachmentPaths`（围栏 + workspace 相对路径）                                                                                                                                  |
| `mail-contract-formats.ts` | `classifyContractAttachment`、`isTrackedWordAttachment`、`isReviewableContractAttachment`、`isMailImageAttachment`                                                                             |
| `mail-transport-guard.ts`  | `checkImapPortAllowed`、`checkSmtpPortAllowed`、`SECURE_IMAP_PORTS`、`SECURE_SMTP_PORTS`                                                                                                       |
| `mail-send-format.ts`      | `applyMailSendFormat`、`resolveMailClosingText`、`sanitizeMailSendFormat`、`previewMailSendFormat`、五种落款风格                                                                               |
| `convert-to-docx.ts`       | `ensureDocxForAttachment`、`convertLegacyDocToDocx`（Word 优先，LibreOffice 兜底）、`convertLegacyDocForPreview`                                                                               |
| `convert-with-word.ts`     | 让本机 Word 在**自己的容器里**另存为 `.docx`，避开沙盒授权框                                                                                                                                   |
| `read-word-binary.ts`      | `readBinaryWordDocText`、`isBinaryWordDocPath`                                                                                                                                                 |
| `doc-revision-gate.ts`     | `DOC_NEEDS_DOCX_MESSAGE`、`DOC_NEEDS_DOCX_CODE`、`isBinaryWordDocBaseline`：修订与审阅只读 `.docx`；读不出文本的 `.doc` 必须先另存                                                             |
| `watch-contacts.ts`        | `sanitizeWatchContacts`、`messageMatchesWatchContacts`、`matchWatchContactLabel`                                                                                                               |

**`mail-contract-formats.ts` 的五种分类**：`tracked_word`（仅 `.docx`，可走修订轨）、`legacy_doc`（`.doc`，可读文本但不是修订基线）、`convertible_word`（.wps/.rtf/.odt）、`analyzable`（pdf/图片/文本/.docm）、`other`。

**`.doc` 的读取不再走外部程序，出稿仍要排版引擎**。`read-word-binary.ts` 在进程内解析 OLE 复合文档（FIB + piece table，UTF-16LE 或 code-page-1252 按 piece 决定），读出正文与修订，供预览、分析和索引使用，不依赖 Word、WPS 或任何系统授权。要产出保真的 `.docx`（页眉页脚、表格、图片、编号几何），`convert-to-docx.ts` 调 LibreOffice headless；`render-docx-tracked.ts` 再把 LawMind 的修订叠在转换稿上。`.wps` / `.rtf` / `.odt` 目前不支持，返回 `not_convertible`。

**`mail-send-format.ts` 的五种落款风格**：`none` / `formal` / `business` / `reply` / `custom`。

## 48.8 `matter-replica/`（27 个文件）

第 16 章讲了机制。这里按「一层一层」列文件：

| 层         | 文件                                                                          |
| ---------- | ----------------------------------------------------------------------------- |
| 入口       | `index.ts`（barrel：角色、成员、邀请、锁、材料与操作的再导出）                |
| 类型与角色 | `types.ts`（六种角色 + 十种能力表）、`feature-gate.ts`                        |
| 加密       | `crypto-envelope.ts`、`matter-key.ts`、`member-keys.ts`、`invite-key-wrap.ts` |
| 身份与成员 | `identity.ts`、`membership.ts`、`invites.ts`                                  |
| 操作       | `record-ops.ts`、`apply-ops.ts`                                               |
| 冲突       | `last-write.ts`、`case-md-live.ts`、`checkout-locks.ts`                       |
| 同步       | `relay.ts`、`http-relay.ts`、`shared-relay.ts`、`sync-scheduler.ts`           |
| 材料       | `materials-blobs.ts`、`materials-relay.ts`、`materials-cdc.ts`                |
| 云         | `matter-cloud-store.ts`、`matter-cloud-http.ts`                               |
| 展示       | `feed.ts`、`desk-feed.ts`、`paths.ts`                                         |

**`MATTER_REPLICA_ROLES` 六种**：`owner`、`lead`、`associate`、`paralegal`、`readonly`、`external`。

**十种能力**：`manage_members`、`invite`、`edit_matter_records`、`edit_case_md`、`upload_materials`、`delete_materials`、`checkout_docx`、`view_strategy`、`run_assistant_write`、`seal_matter`。

**十四种操作类型**（`MatterRecordOpKind`）：成员增删改钥、字段设置、锁、邀请、CASE 快照、材料增删、密钥分享与轮换。

**`APPLIABLE_MATTER_FIELDS` 十一个字段白名单**（`apply-ops.ts`，第 16.8 节列过）。

**`shared-relay.ts` 是跨机器邀请的前提**：两边的共享中继要指向同一个共享文件夹（或案件云），本机默认的 `replica-cloud` 目录不算——邀请码写在那里对方永远找不到。

**桌面侧有 7 个 HTTP 端点当前无调用方**（审计 1.2）：`GET audit-report`、`POST scheduler/tick`、`POST members/revoke`、`GET ops`、`GET feed`、`GET materials`、`POST materials/publish`。数据面（op 日志、材料块、中继）本身是活的，这几个端点是候选清理对象，别当成主流程入口去读。

## 48.9 `integrations/`（18 个文件）

| 文件                                              | 关键导出                                                                                                                      |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `index.ts`                                        | barrel：连接器目录、状态、配置与各连接器的再导出                                                                              |
| `integration-types.ts`                            | `INTEGRATION_CONNECTOR_IDS`（filesystem / imanage / netdocuments / sharepoint / feishu 五个）、阶段（M1/M2/M3）与文档条目类型 |
| `integration-registry.ts`                         | 连接器目录与状态（`INTEGRATION_CONNECTOR_CATALOG`、`listIntegrationConnectorStatuses`）                                       |
| `integration-config.ts`                           | 读写 `lawmind/integrations.json`，决定连接器是否启用                                                                          |
| `sharepoint-connector.ts` / `sharepoint-graph.ts` | SharePoint 只读（夹具或客户端凭据列 Graph 驱动器子项）                                                                        |
| `imanage-connector.ts`                            | iManage 只读（夹具或 REST）                                                                                                   |
| `feishu-connector.ts`                             | 飞书云文档只读索引（夹具或凭据占位）                                                                                          |
| `filesystem-connector.ts`                         | 只读列出案件目录里的文件，作为本地文管索引                                                                                    |
| `stub-connectors.ts`                              | 未配置时的占位连接器错误（netdocuments 目前只有这个 stub）                                                                    |
| `dms-matter-map.ts`                               | 每个案件一份外部文管系统键，存在 `.lawmind-dms.json`                                                                          |
| `esign-placeholder.ts`                            | 电子签深链缝（法大大 / e签宝 / DocuSign，需律师自备凭据）                                                                     |
| `graph-oauth-placeholder.ts`                      | Microsoft Graph OAuth 向导缝，未接真实 Entra 应用（`LAWMIND_GRAPH_CLIENT_ID`）                                                |
| `word-addin/`（4 个文件）                         | 插件桥（第 8 章）：`addin-assets.ts`、`review-requests.ts`、`attach-result.ts`、`auto-run.ts`                                 |

**只读是关键约束**：这一层是「读外部 DMS」，不写。**fixture 模式**：飞书、iManage、SharePoint 各有 `LAWMIND_<厂>_FIXTURE` 环境开关走夹具数据，配 `<厂>_CLIENT_SECRET` / `APP_SECRET` 才走真实连接（见 `docs/LAWMIND-HARDCODED-CATALOG.md` A.7）。

## 48.10 `mcp/`（4 个文件）

| 文件                    | 关键导出                                                                                                                                                                         |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mcp-jsonrpc-client.ts` | stdio 与 HTTP 的 JSON-RPC 客户端（initialize / tools/list / tools/call），与 `scripts/lawmind/mcp-readonly-server.ts` 讲同一种协议                                               |
| `mcp-client-bridge.ts`  | `attachEnabledMcpServers`、`isMcpWriteLikeTool`、`shouldExposeMcpTool`（另有 `mcpToolName`、`testMcpServer`）；`LAWMIND_MCP_SECRET` 是 safe-command 环境白名单的唯一例外         |
| `mcp-servers-config.ts` | `readMcpServersConfig`（`workspace/lawmind/mcp-servers.json`；机密只引用，值在钥匙串或环境变量）                                                                                 |
| `readonly-tools.ts`     | 七个只读函数：`mcpListMatters`、`mcpListDrafts`、`mcpGetSourcePreview`、`mcpListSourceAnnotations`、`mcpGetReviewMatrix`、`mcpSearchWorkspaceIndex`、`mcpGetDraftAcceptancePack` |

**`readonly-tools.ts` 的到达路径**是 `scripts/lawmind/mcp-readonly-server.ts`：一个 stdio JSON-RPC 的只读 MCP server（`LAWMIND_WORKSPACE_DIR` 必填），把上面七个函数以 `list_matters`、`list_drafts`、`get_source_preview` 等工具名暴露给外部 MCP 客户端。

**三个约束**：保留名不许占、写类默认剥离、挂载失败不影响核心工具表。

## 48.11 这一组模块的共同模式

把这一章的十个目录放在一起看，有三条共同模式：

### 模式一：入口薄、实现厚

多数目录的 `index.ts` 只导出几个函数（`retrieve`、`searchMaterials`、`classifyContractAttachment`），实现在同目录的其他文件里。所以**看 `index.ts` 只能知道「能做什么」，不能知道「怎么做的」**——`research/index.ts` 更是极端情况：barrel 存在但无人 import（见 48.2）。

### 模式二：诚实相关的代码单独成文件

`authority-gap.ts`、`case-law-readiness.ts`、`metrics/north-star.ts` 这类「专门管诚实话术与判定」的文件到处都是。这是这个仓库很特别的一点：**把「如实说明」当成一个独立职责**。

### 模式三：上限常量集中且导出

`MATTER_PARTIES_CAP`、`MATTER_MATERIALS_LIST_CAP`、`RETRIEVAL_POOL_CAP`、`MAX_EVIDENCE_ENTRIES`、`MAX_MAIL_ATTACHMENT_BYTES`……这些常量大多**导出**，因为测试和界面会用到。少数是模块内常量（如 `url-dossier.ts` 的 `MAX_BYTES` / `MAX_EXCERPT`、`fts-ingest-materials.ts` 的 `MAX_FILE_BYTES` / `CHUNK_CHARS`），不要按「能 import」去写新代码。

工作区适配器在 `isValidMatterId` 通过后读 `cases/<id>/CASE.md`，并按记忆上下文带客户画像（`clients/<id>/CLIENT_PROFILE.md` 或根目录 `CLIENT_PROFILE.md`）。模型适配器的来源带 `provider: model-legal` 或 `model-general`，`claimArticleGrounded` 不拿它们给条号背书。开放样本库仍用 `demo: true`，样本里写了的条号可以核对。活的法源适配器仍按原文条号核对。

## 48.12 已知坑（本章相关）

- **记忆是 Markdown 文档层加上 SQLite 内核。** 内核契约把 SQLite 写成内核记录的真相源；`loadMemoryContext` 仍读 Markdown。
- **`project.note` 采纳记 `recorded_noop`。** 没有 project 落盘路径。
- **活的记忆界面是 `LawmindMemoryLibrary`。** `MemoryInspector` 只留测试。
- **128k 提示窗**：案件索引 1600 字，指纹 800 字，记忆 gist 180 字。
- **`research/index.ts` 是死 barrel。** 全仓库 0 导入者；所有模块都按路径直引子模块，新代码照此办理。
- **检索协议在工具表上没有检索工具时不注入**，也在没有绑定工作流时不注入。强制检查 `shouldEnforceStatuteTrial` 不传工具表，只看绑定。
- **`learning/` 没有 barrel。**
- **索引版本现在是 3。** 改结构要抬版本。
- **`getSearchIndexStatus` 和 `computeSearchIndexFreshness` 是两件事。**
- **邮件端口有安全白名单**（IMAP 993；SMTP 465 / 587），非 TLS 标准端口默认拒绝，显式 `allowInsecure` 才放行。
- **`.doc` 没有外部转换器链。** 进程内读文本与修订（`read-word-binary.ts`）；导出走 `renderLegacyDocWithRevisions`。别再找 soffice / textutil / 加载项另存队列。
- **案件副本的 op 没有签名。** 中继可重放。
- **案件副本的 7 个桌面端点无调用方**（audit-report / scheduler tick / members revoke / ops / feed / materials / materials publish），排查同步问题别从这几个端点入手。
- **`integrations/` 只读。**
- **MCP 写类工具默认剥离。**
- **`matter-replica` 的十一种可应用字段有白名单**，不在表里的字段不会被操作同步改。
