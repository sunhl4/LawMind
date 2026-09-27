# 第 48 章 实现精读：检索、记忆与集成

这一章讲 `retrieval/`、`research/`、`indexing/`、`memory/`、`learning/`、`stance/`、`mail/`、`matter-replica/`、`integrations/`、`mcp/`。

## 48.1 `retrieval/`（33 个文件）

### 入口与合并

| 文件                                         | 关键导出                                                                                                                                                                      |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `index.ts`                                   | `retrieve`、`claimArticleGrounded`、`createWorkspaceAdapter`；合并时 20 秒超时、同 id 保留非演示来源、条号对不上来源则降级                                                    |
| `authority-adapter.ts`                       | `createAuthorityAdapterFromEnv`                                                                                                                                               |
| `providers.ts`                               | `createDomesticGeneralAdaptersFromEnv`、`createOpenSourceLegalAdaptersFromEnv`、`createLexEdgeAdapterFromEnv`、`createPartnerLegalAdapterFromEnv`、`GENERAL_PROVIDER_PRESETS` |
| `model-adapters.ts` / `openai-compatible.ts` | 模型型检索适配器                                                                                                                                                              |
| `schema.ts`                                  | `validateModelRetrievalOutput`（zod 校验模型输出）                                                                                                                            |

**`createWorkspaceAdapter` 是唯一「永远支持」的适配器**（`supports: () => true`）。

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

有独立的 README。核心是 `client.ts` 的 `openLawRetrieve`：hybrid 并列已启用直播车道再合并，本地 sample 只在直播全空时兜底。`local-corpus.ts` 管 sample 与外部 CORPUS 的 demo 判定，`npc-flk.ts` 管 NPC 直播的节流与缓存。

### `providers/pkulaw/`（子目录）

`client.ts`（`pkulawRetrieve`、`resolvePkulawMode`）、`map.ts`（`mapPkulawResponseBody`、`inferPkulawSearchKind`）、`citation-validate.ts`（`validateCitationsWithAuthority`）。

## 48.2 `research/`（15 个文件）

| 文件                            | 关键导出                                                                                                                                                                                                            |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `research-protocol.ts`          | `shouldInjectResearchProtocol`、`shouldEnforceStatuteTrial`、`statuteTrialHappenedThisTurn`、`looksLikeStatuteCitation`、`formatResearchProtocolPromptBlock`、`formatUnretrievedStatuteBody`、`STATUTE_TRIAL_TOOLS` |
| `execute-deep-research.ts`      | `executeDeepResearchPlan`、`ExecuteDeepResearchResult`                                                                                                                                                              |
| `deep-research-plan.ts`         | `buildDeepResearchPlan`、`formatDeepResearchPlanMarkdown`、类型                                                                                                                                                     |
| `query-matrix.ts`               | `buildQueryMatrix`、`formatQueryMatrixBody`、`QueryMatrix`                                                                                                                                                          |
| `url-dossier.ts`                | `fetchUrlDossier`、`parseUrlList`、`extractUrlsFromText`、`mergeDossierIntoBundleParts`、`MAX_BYTES = 400000`、`MAX_EXCERPT = 12000`                                                                                |
| `research-outline.ts`           | `buildResearchOutline`、`formatOutlineMarkdown`、`outlineClarificationQuestion`                                                                                                                                     |
| `outline-hitl.ts`               | `outlineAnswerDecision`、`applyOutlineClarificationAnswer`、`outlineLooksApproved`、`extractOutlineAnswerFromResume`                                                                                                |
| `outline-store.ts`              | `persistResearchOutline`、`readResearchOutline`、`approveResearchOutline`、`researchOutlinePath`                                                                                                                    |
| `outline-expand.ts`             | `expandApprovedOutlineToSections`                                                                                                                                                                                   |
| `auto-statute-trial.ts`         | `shouldAutoTrialStatute`、`runAutoTrialStatute`                                                                                                                                                                     |
| `claim-relevance.ts`            | `filterBundleByTopicRelevance`、`claimMatchesTopic`、`extractTopicTokens`                                                                                                                                           |
| `desensitize-matter.ts`         | `scanTextForTrainingLeak`、`assertTrainingDesensitizeGate`、`redactTrainingText`                                                                                                                                    |
| `research-evidence-gate.ts`     | `evaluateResearchEvidenceGate`、`RESEARCH_EVIDENCE_GATE_REFUSAL`                                                                                                                                                    |
| `research-write-bypass-gate.ts` | `shouldRefuseResearchWriteBypass`、`RESEARCH_WRITE_BYPASS_REFUSAL`                                                                                                                                                  |

**注意 `index.ts`（barrel）不导出全部**——`research-protocol`、`auto-statute-trial`、`outline-hitl`、`claim-relevance`、`outline-expand` 都不在 barrel 里，要按路径直接 import。

**`desensitize-matter.ts` 的七类识别**：手机号、身份证、银行账号、邮箱、金额、姓名线索、案号。手机号与身份证是 blocker。

## 48.3 `indexing/`（10 个文件）

| 文件                      | 关键导出                                                                                                                   |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `workspace-index-path.ts` | `SEARCH_INDEX_SCHEMA_VERSION = 3`、`searchIndexPath`、`lawmindDir`                                                         |
| `fts-schema.ts`           | `initSearchIndexSchema`、`recreateMaterialsFts`、`recreateKnowledgeFts`、`clearFtsTables`、`setMeta`、`getMeta`            |
| `fts-ingest.ts`           | `rebuildWorkspaceSearchIndex`、`syncWorkspaceSearchIndex`、`workspaceSourcesChanged`、`openSearchIndexDb`、`indexExists`   |
| `fts-search.ts`           | `searchWorkspaceIndex`、`escapeFtsQuery`、`escapeKnowledgeFtsQuery`、`getSearchIndexStatus`、`computeSearchIndexFreshness` |
| `fts-ingest-materials.ts` | `ingestMaterialsRows`、`ingestMaterialsIncremental`、`MAX_FILE_BYTES`、`CHUNK_CHARS`                                       |
| `fts-search-materials.ts` | `searchMaterials`、`MaterialSearchHit`（**带 `page`**）                                                                    |
| `knowledge-search.ts`     | `searchPersonalKnowledge`、`KnowledgeDocKindFilter`、`PersonalKnowledgeHit`                                                |
| `embeddings/index.ts`     | `getEmbeddingIndexConfig`、`embedTextsLocalStub`、`cosineSimilarity`、`rankHybrid`                                         |

**四张表**：`audit_fts`、`session_fts`（都用 `unicode61`）、`knowledge_fts`、`materials_fts`（都用 `trigram`）。

**`getSearchIndexStatus` 与 `computeSearchIndexFreshness` 是两个不同的东西**：前者给状态快照（含 `sourcesChanged`），后者给「陈旧原因」（`index_missing` / `last_rebuild_unknown` / `sources_changed`）。检索前 `syncWorkspaceSearchIndex` 只重写改过的文件。

## 48.4 `memory/`（25 个文件）

第 37 章逐个讲过，这里只补导出面的一些观察：

**导出最多的三个**：`index.ts`（加载与路径）、`prompt-windows.ts`（一堆上限常量）、`adoption-service.ts`（状态机）。

**只导出一个文件的特例**：`write-gateway.ts`（`writeCaseMemorySection` + re-export）、`unified-pending-adoptions.ts`（`listPendingAdoptionsUnified`）。

**`case-workspace.ts` 不 import `index.ts`**（避免循环）——这是结构上的一个刻意决定。

## 48.5 `learning/`（15 个文件）

第 37 章逐个讲过。这里补三个观察：

1. **没有 barrel**（`learning/index.ts` 不存在），要按路径 import。
2. **多数文件是「写一个队列/文件」**，只有 `assistant-growth.ts` 和 `agent-specialization.ts` 是读聚合。
3. **`contract-revision-pack.ts` 的存储最复杂**（一个目录 + 一份按关键点的索引）。

## 48.6 `stance/`（7 个文件）

| 文件               | 关键导出                                                                                                                                                                                           |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `types.ts`         | `STANCE_SCHEMA_VERSION`、`STANCE_CLAUSE_TYPE_IDS`（七种条款）、`StanceItem`、`StanceEvidenceEntry`、`StanceFamily`、`StanceSource`                                                                 |
| `store.ts`         | `readStanceItems`、`writeStanceItems`、`mutateStanceItems`、`stanceItemsPath`、`MAX_EVIDENCE_ENTRIES = 50`                                                                                         |
| `inject.ts`        | `selectInjectableStances`、`formatStanceHint`、`MIN_HINT_CONFIDENCE = 0.4`、`MIN_DISTINCT_EVIDENCE_MATTERS = 2`                                                                                    |
| `capture.ts`       | `captureStanceFromRedline`、`upsertStanceFromRedline`、`upsertStanceFromKeyModification`、`writeStanceFromHabit`、`stanceConfidenceFromEvidence`、`detectStanceClauseType`、`STANCE_SOURCE_WEIGHT` |
| `firm-defaults.ts` | `ensureFirmStanceDefaults`（两条预置立场）                                                                                                                                                         |
| `self-check.ts`    | `stanceSelfCheck`、`stance.unapplied` finding                                                                                                                                                      |

**`STANCE_SOURCE_WEIGHT` 是四档权重**（habit_adopt 0.5 > manual 0.45 > revision_pack 0.4 > redline 0.25）。

## 48.7 `mail/`（15 个文件）

| 文件                       | 关键导出                                                                                                                                                |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `imap-client.ts`           | `testImapConnection`、`fetchImapMessages`、`shouldPersistMailAttachment`、`writeFetchedAttachments`、两个大小上限                                       |
| `smtp-client.ts`           | `sendSmtpMail`                                                                                                                                          |
| `graph-mail.ts`            | `testGraphMailConnection`、`fetchGraphMessages`、`sendGraphMail`                                                                                        |
| `sync-inbox.ts`            | `testMailAccountConnection`、`syncMailAccountToMatter`、`syncMatterMailbox`、`sendMailViaAccount`、`countEnabledMailAccounts`、`persistFetchedMessages` |
| `provider-presets.ts`      | `MAIL_PROVIDER_PRESETS`（六种）、`resolveImapEndpoints`、`resolveSmtpEndpoints`                                                                         |
| `mail-accounts.ts`         | `listMailAccounts`、`upsertMailAccount`、`resolveMailAccountForMatter`、`toPublicMailAccount` 等                                                        |
| `mail-secrets.ts`          | `getMailAccountSecret`、`upsertMailAccountSecret`、`hasMailAccountSecret`、v2 格式                                                                      |
| `mail-attachments.ts`      | `resolveOutboundAttachmentPaths`（围栏 + workspace 相对路径）                                                                                           |
| `mail-contract-formats.ts` | `classifyContractAttachment`、`isTrackedWordAttachment`、`isReviewableContractAttachment`、`isMailImageAttachment`                                      |
| `mail-transport-guard.ts`  | `checkImapPortAllowed`、`checkSmtpPortAllowed`、`SECURE_IMAP_PORTS`、`SECURE_SMTP_PORTS`                                                                |
| `mail-send-format.ts`      | `applyMailSendFormat`、`resolveMailClosingText`、`sanitizeMailSendFormat`、`previewMailSendFormat`、五种落款风格                                        |
| `convert-to-docx.ts`       | `ensureDocxForAttachment`、`tryReadHighFidelityDocxCache`、三种转换器                                                                                   |
| `read-word-binary.ts`      | `readBinaryWordDocText`、`isBinaryWordDocPath`                                                                                                          |
| `watch-contacts.ts`        | `sanitizeWatchContacts`、`messageMatchesWatchContacts`、`matchWatchContactLabel`                                                                        |

**`mail-contract-formats.ts` 的四种分类**：`tracked_word`（.doc/.docx，可走修订轨）、`convertible_word`（.wps/.rtf/.odt）、`analyzable`（pdf/图片/文本）、`other`。

**`convert-to-docx.ts` 的转换器偏好顺序**：MS Word → soffice → textutil（最后一个有损）。

## 48.8 `matter-replica/`（26 个文件）

第 16 章讲了机制。这里按「一层一层」列文件：

| 层         | 文件                                                                          |
| ---------- | ----------------------------------------------------------------------------- |
| 类型与角色 | `types.ts`（六种角色 + 十种能力表）、`feature-gate.ts`                        |
| 加密       | `crypto-envelope.ts`、`matter-key.ts`、`member-keys.ts`、`invite-key-wrap.ts` |
| 身份与成员 | `identity.ts`、`membership.ts`、`invites.ts`                                  |
| 操作       | `record-ops.ts`、`apply-ops.ts`                                               |
| 冲突       | `last-write.ts`、`case-md-live.ts`、`checkout-locks.ts`                       |
| 同步       | `relay.ts`、`http-relay.ts`、`sync-scheduler.ts`                              |
| 材料       | `materials-blobs.ts`、`materials-relay.ts`、`materials-cdc.ts`                |
| 云         | `matter-cloud-store.ts`、`matter-cloud-http.ts`                               |
| 展示       | `feed.ts`、`desk-feed.ts`、`paths.ts`                                         |

**`MATTER_REPLICA_ROLES` 六种**：`owner`、`lead`、`associate`、`paralegal`、`readonly`、`external`。

**十种能力**：`manage_members`、`invite`、`edit_matter_records`、`edit_case_md`、`upload_materials`、`delete_materials`、`checkout_docx`、`view_strategy`、`run_assistant_write`、`seal_matter`。

**十四种操作类型**（`MatterRecordOpKind`）：成员增删改钥、字段设置、锁、邀请、CASE 快照、材料增删、密钥分享与轮换。

**`APPLIABLE_MATTER_FIELDS` 十一个字段白名单**（第 16.8 节列过）。

## 48.9 `integrations/`（17 个文件）

| 文件                                              | 关键导出                                        |
| ------------------------------------------------- | ----------------------------------------------- |
| `integration-registry.ts`                         | 连接器目录与状态（`INTEGRATION_CONNECTOR_IDS`） |
| `sharepoint-connector.ts` / `sharepoint-graph.ts` | SharePoint 只读                                 |
| `imanage-connector.ts`                            | iManage                                         |
| `feishu-connector.ts`                             | 飞书                                            |
| `filesystem-connector.ts`                         | 文件系统                                        |
| `stub-connectors.ts`                              | 占位连接器                                      |
| `dms-matter-map.ts`                               | DMS 与案件的映射                                |
| `word-addin/`（子目录）                           | 插件桥（第 8 章）                               |

**只读是关键约束**：这一层是「读外部 DMS」，不写。

## 48.10 `mcp/`（4 个文件）

| 文件                    | 关键导出                                                               |
| ----------------------- | ---------------------------------------------------------------------- |
| `mcp-jsonrpc-client.ts` | stdio 与 HTTP 的 JSON-RPC 客户端                                       |
| `mcp-client-bridge.ts`  | `attachEnabledMcpServers`、`isMcpWriteLikeTool`、`shouldExposeMcpTool` |
| `mcp-servers-config.ts` | `readMcpServersConfig`（`workspace/lawmind/mcp-servers.json`）         |
| `readonly-tools.ts`     | 只读工具集（与 CLI 的只读 MCP server 共享）                            |

**三个约束**：保留名不许占、写类默认剥离、挂载失败不影响核心工具表。

## 48.11 这一组模块的共同模式

把这一章的十个目录放在一起看，有三条共同模式：

### 模式一：入口薄、实现厚

多数目录的 `index.ts` 只导出几个函数（`retrieve`、`searchMaterials`、`classifyContractAttachment`），实现在同目录的其他文件里。所以**看 `index.ts` 只能知道「能做什么」，不能知道「怎么做的」**。

### 模式二：诚实相关的代码单独成文件

`authority-gap.ts`、`case-law-readiness.ts`、`metrics/north-star.ts` 这类「专门管诚实话术与判定」的文件到处都是。这是这个仓库很特别的一点：**把「如实说明」当成一个独立职责**。

### 模式三：上限常量集中且导出

`MATTER_PARTIES_CAP`、`MATTER_MATERIALS_LIST_CAP`、`MAX_BYTES`、`MAX_FILES`、`MIN_*_SAMPLES`……这些常量大多**导出**，因为测试和界面会用到。

工作区适配器只在 `isValidMatterId` 通过后读 `cases/<id>/CASE.md`。模型适配器的来源带 `provider: model-legal` 或 `model-general`。`claimArticleGrounded` 不拿它们给条号背书。开放样本库仍用 `demo: true`，样本里写了的条号可以核对。活的法源适配器仍按原文条号核对。

## 48.12 已知坑（本章相关）

- **`research/index.ts` 不是全量 barrel。** 有几个模块要按路径 import。
- **`learning/` 没有 barrel。**
- **索引版本现在是 3。** 改结构要抬版本。
- **`getSearchIndexStatus` 和 `computeSearchIndexFreshness` 是两件事。**
- **邮件端口有安全白名单**（993 / 465 / 587）。
- **`convert-to-docx` 的 textutil 路径有损。**
- **案件副本的 op 没有签名。** 中继可重放。
- **`integrations/` 只读。**
- **MCP 写类工具默认剥离。**
- **`matter-replica` 的十一种可应用字段有白名单**，不在表里的字段不会被操作同步改。
