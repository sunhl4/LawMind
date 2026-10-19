# 第 30 章 策略文件字段参考

`lawmind.policy.json` 放在**工作区根**。它只给所务信息管理员下硬边界：出网、外发收件域、律所规则文件、交付是否一律全审、案件副本共享目录。不是调模型的地方，也不是存密钥的地方。

缺 `schemaVersion`（须 ≥ 1）或 JSON 坏了，整份不生效。写错的键**不会悄悄生效**：`GET /api/health` 的 `policy` 段列出 `applied`（启动时应用过的键）、`effective`（请求时重读盘的生效行）、`migrated`（旧键迁移提示）、`rejected`（未采纳的键，各附原因）。过滤逻辑在 `src/lawmind/policy/commercial-policy.ts`：未知键、密钥、引擎调参都拒绝并说明原因，不把整份扔掉。`pnpm lawmind:doctor` **不**打这份清单，它只巡检策略文件在不在。

## 30.1 可以写的键

```json
{
  "schemaVersion": 2,
  "description": "XX 律所",
  "edition": "firm",
  "network": {
    "mode": "allowlist",
    "hosts": ["api.deepseek.com", "flk.npc.gov.cn"]
  },
  "outbound": { "recipientDomains": ["client.com"] },
  "firmRulesPath": "lawmind/FIRM_RULES.md",
  "delivery": "standard",
  "replica": { "sharedDir": "/Volumes/firm-share/lawmind-relay" },
  "wordAddinAutoRun": false,
  "allowWebSearch": false
}
```

| 键                          | 含义                                                                                                                                                                                                                                                                   |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `description`               | 一句话说明（如律所名），只用于展示                                                                                                                                                                                                                                     |
| `edition`                   | `solo` / `firm` / `private_deploy`。决定版本功能表 17 键的默认（伦理墙、强制互审、合规导出等，见第 15 章 §15.8）。优先级高于 `LAWMIND_EDITION`                                                                                                                         |
| `network.mode`              | 出网上限：`open` / `allowlist` / `offline`（`allowlisted` 写法也收）。`offline` 强制断网，不改律师自己的联网偏好；`allowlist` 时自动按强制白名单处理                                                                                                                   |
| `network.hosts`             | `allowlist` 时允许的域名。裸后缀 `gov.cn` 含子域。只写 hosts 没写 mode 时自动按 `allowlist` 生效                                                                                                                                                                       |
| `outbound.recipientDomains` | 外发邮件允许的收件域                                                                                                                                                                                                                                                   |
| `firmRulesPath`             | 工作区内相对路径，UTF-8，最多 8192 字，每轮注入系统提示。不要把长文内联进 JSON（内联键 `agentMandatoryRules` 会被拒收）                                                                                                                                                |
| `delivery`                  | `"standard"` 或 `"always_full_review"`（一律全审）                                                                                                                                                                                                                     |
| `replica.sharedDir`         | 案件副本共享目录。只写它时 `enabled` / `autoSync` 默认开。令牌和云地址不要写在这里（写了会被拒收）                                                                                                                                                                     |
| `replica.enabled`           | 覆盖协作开关默认（各版本默认开；`false` 可关掉）                                                                                                                                                                                                                       |
| `replica.autoSync`          | 后台自动同步（轮询 + 共享中继监听）开关                                                                                                                                                                                                                                |
| `wordAddinAutoRun`          | 只在要推翻版本默认时写。独立律师默认开，律所默认关                                                                                                                                                                                                                     |
| `allowAnalysisScripts`      | `run_analysis` 能否跑预置 / 律师确认的脚本。缺省允许；显式 `false` 或离线模式才关                                                                                                                                                                                      |
| `wordRevisionAuthor`        | Word 修订署名。空白或不写时，审阅稿上的修订作者是 LawMind                                                                                                                                                                                                              |
| `allowWebSearch`            | 只能写 `false`，表示不许联网检索。要封顶用 `network.mode`                                                                                                                                                                                                              |
| `enableCollaboration`       | 只能写 `false`，关掉协作                                                                                                                                                                                                                                               |
| `conversationLength`        | 对话长度档：`"200k"` / `"500k"` / `"1m"`。这是本轮硬天花板 = min(模型窗口, 所选档)。历史整理仍按 200K 质量带，不随档位推迟。旧值 `daily` / `dossier` 读出时自动迁移成 200k / 1m（`src/lawmind/agent/context-preset.ts`）。律师日常在对话输入栏工具条里切，不必手写文件 |
| `context`                   | 上下文 / 压缩 / 摘要 / 钉子的高级调参段（对象整体透传给引擎，逐项类型校验与夹取——非法值回落默认、越界夹到边界，绝不因写错一个数就炸。字段与默认值见 `src/lawmind/policy/workspace-policy.ts` 的 `LawMindContextPolicy`）                                               |

独立律师不必建这个文件。联网或离线在设置里切。

## 30.2 版本已经定死、策略改不了的

这些键写进文件会被逐条拒收（`policy.rejected` 里各附原因）：

- 引用门禁（`citationMode`）：律所和私有化默认 `grounded`，独立律师默认 `assisted`，策略里写会被拒（「引用门禁由版本决定，不能在策略里关掉」）。
- 版本功能表：跟版本走（第 15 章 §15.8）。`features` 单键覆盖、`ethicsWall`、`toolSandbox` 都被拒——功能表是版本合同，策略改不了。修订稿的独立审稿硬墙已取消（把关在「外发」那一步），旧键 `guardianTrackedRedline` 写了只收一条「已忽略」。
- 判断分级与升级（`judgmentTiering`、`judgmentDisabledVerifiers`、`judgmentEscalation`、`judgmentEscalationPosture`、`judgementPromotion`）：引擎产品行为，用 `LAWMIND_JUDGMENT_*` 环境变量调。
- 决策模型（`decisionModelMode` / `decisionModelBaseUrl` / `decisionModelApiKey` / `decisionModelId`）、路由分歧（`routeDivergenceShadow` / `routeDivergencePosture`）：不写在策略文件里。
- 渐进自主（`progressiveAutonomy`）：不按本地通过率自动跳过律师签批。
- 引擎配额与行为：`agentMaxToolCallsPerTurn`（每轮工具上限，会掐模型）、`agentMaxHistoryMessages`（历史条数）、`agentPromptVerbosity`（提示词详略）、`intakeHeuristicsEnabled`（交办启发式）、`searchIndexAutoRebuild`（索引重建）、`appliedPreferencesFooter`（偏好脚注）、`autoDeliverableWorkflow`（自动交付流程）、`autoApproveSandboxWorkflowSteps`（不能用策略跳过危险操作确认）、`privilegeSentinel`（特权提示不能关）、`productInsightsCollection`（产品观察默认不上传，律所默认 `off`）、`teamMemorySync`（团队记忆云）、`memoryRecall`（记忆召回调参）、`retrievalMode`（检索通道）、`hostAccess`（本机访问走本机授权）、`benchmarkGateMinScore`、`auditExportCadenceHint`、`networkAllowlistEnforced`（白名单强制与否由 `network.mode` 决定）、`buildChannel` / `LAWMIND_BUILD_CHANNEL`（构建通道不进策略文件）。

一个例外：**`context` 段可以写**（见 §30.1），引擎逐项校验夹取。开发时临时调压缩也可以用环境变量 `LAWMIND_CONTEXT_TUNING`（JSON）。

密钥（模型 key、副本令牌、审计链密钥）只走环境变量或钥匙串。写进策略文件会被拒绝。

## 30.3 旧键

仍能读、按新键生效，`policy.migrated` 里会提示改名：

| 旧键                           | 现在写法                                                                                        |
| ------------------------------ | ----------------------------------------------------------------------------------------------- |
| `egressMode`                   | `network.mode`（`allowlisted` 写成 `allowlist`）                                                |
| `highSecurityMode: true`       | `network.mode: "offline"`（按离线生效；若同时写了 `network.mode` 或值为 `false`，这个键被拒收） |
| `networkAllowlist`             | `network.hosts`                                                                                 |
| `outboundAllowedDomains`       | `outbound.recipientDomains`                                                                     |
| `agentMandatoryRulesPath`      | `firmRulesPath`                                                                                 |
| `delivery.firmForceFullReview` | `delivery: "always_full_review"` 或 `"standard"`                                                |
| `matterReplica.sharedRelayDir` | `replica.sharedDir`                                                                             |

两个不算迁移的旧写法：`matterReplica.enabled` / `matterReplica.autoSync` 仍能读（无提示）；`guardianTrackedRedline` 不迁移——修订稿不再用审稿硬墙，写了只收一条「已忽略」。

## 30.4 不生效时看哪里

1. 文件在工作区根，名叫 `lawmind.policy.json`。
2. 有 `schemaVersion` 且 ≥ 1，JSON 能解析。
3. `GET /api/health` 的 `policy`：`applied` 是**启动时**应用过的键；`effective` / `migrated` / `rejected` 是请求时重新读盘的现值（生效行、迁移提示、未采纳的键，各附原因）。改完文件看 `effective`，不要只看 `applied`。
4. 生效键压过同名环境变量（`edition` 压 `LAWMIND_EDITION`）；被拒的键不生效，环境变量是它们唯一的覆盖口。
5. `pnpm lawmind:doctor` 只巡检文件在不在，不打这份清单——清单在 `/api/health`。
