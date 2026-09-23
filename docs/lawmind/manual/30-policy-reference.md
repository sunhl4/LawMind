# 第 30 章 策略文件字段参考

`lawmind.policy.json` 放在**工作区根**（不在 `lawmind/` 里）。它是「下硬约束」的文件，不是存密钥的地方。

**第一条规矩**：必须有 `schemaVersion` 且 ≥1，否则**整份文件被忽略**。这是配置失效最常见的原因。

配完在体检页核对 `policy.applied`——它会列出真的生效了哪几项。

## 30.1 最小可用

```json
{
  "schemaVersion": 1,
  "edition": "firm"
}
```

`edition` 三选：`solo` / `firm` / `private_deploy`。它的优先级高于 `LAWMIND_EDITION` 环境变量。

## 30.2 出口与联网

| 键                         | 类型                                     | 说明                              |
| -------------------------- | ---------------------------------------- | --------------------------------- |
| `egressMode`               | `"open"` / `"allowlisted"` / `"offline"` | 出网总模式（**上限**）            |
| `allowWebSearch`           | boolean                                  | 联网偏好（不是上限）              |
| `networkAllowlist`         | string[]                                 | 允许的域名（支持 `.后缀`）        |
| `networkAllowlistEnforced` | boolean                                  | 是否强制白名单                    |
| `outboundAllowedDomains`   | string[]                                 | 外发允许的收件域名                |
| `highSecurityMode`         | boolean                                  | **废弃**，`true` 等价于 `offline` |

**`egressMode` 和 `allowWebSearch` 的关系**（第 29 章那个坑）：

- `egressMode` 是上限。设成 `offline` 时联网强制关闭。
- `allowWebSearch` 是偏好。**离线模式不改写它**，所以退出离线后偏好自动恢复。

**白名单是否强制的判定**：`networkAllowlistEnforced === true`，或者版本是 firm / private_deploy。空名单 + 强制 = 全拒。

`networkAllowlist` 只影响出站；`outboundAllowedDomains` 影响的是**外发邮件**的收件人检查（第 5 章那个 `outbound_recipient_gate`）。

## 30.3 版本与能力开关

| 键                                | 说明                                        |
| --------------------------------- | ------------------------------------------- |
| `edition`                         | 版本                                        |
| `enableCollaboration`             | 是否启用协作（`false` 时相关端点返回 503）  |
| `retrievalMode`                   | 检索通道 `single` / `dual`                  |
| `allowAnalysisScripts`            | 是否允许预置分析脚本（`run_analysis`）      |
| `toolSandbox`                     | 高风险工具进子进程                          |
| `autoApproveSandboxWorkflowSteps` | 沙箱工作流步骤自动批准                      |
| `wordAddinAutoRun`                | Word 插件自动跑（solo 默认开，firm 默认关） |
| `guardianTrackedRedline`          | 修订稿独立审稿档位 `block` / `advisory`     |
| `ethicsWall.enabled`              | 伦理墙                                      |
| `privilegeSentinel`               | 特权提示（`false` 关闭）                    |
| `matterReplica.enabled`           | 案件副本                                    |
| `citationMode`                    | 引用模式 `grounded` / `assisted` / `off`    |

## 30.4 Agent 行为

| 键                                      | 说明                                   |
| --------------------------------------- | -------------------------------------- |
| `agentMandatoryRules`                   | 每轮必注入的强制规则（**内联短文本**） |
| `agentMandatoryRulesPath`               | 强制规则文件路径（工作区内相对路径）   |
| `agentMaxToolCallsPerTurn`              | 每轮工具调用上限（1–80，默认 80）      |
| `agentMaxHistoryMessages`               | 历史消息条数上限（8–200）              |
| `agentPromptVerbosity`                  | `compact` / `full`                     |
| `context.contextTokens`                 | 上下文窗口大小                         |
| `context.autoCompactBufferTokens`       | 自动压缩缓冲                           |
| `context.summaryOutputTokenReserve`     | 摘要输出预留                           |
| `context.midTurnCompactTriggerRatio`    | 回合内压缩触发比例（默认 0.9）         |
| `context.maxConsecutiveCompactFailures` | 连续压缩失败上限                       |

**`context.*` 是整条上下文/压缩链路的调参面**（高级设置）。它覆盖上面第 18–24 条背后的每一个阈值与帽：预算（`warnRatio`、`smallWindowReserveRatio`、`minEffectiveLimitTokens`）、回合内（`midTurn.maxPerTurn` / `deferralBounceMax` / `elideKeepTail` / `elideThreshold*` / `llmDigestMinChars` / `llmDigestTimeoutMs`）、摘要额度（`digest.charRatio` / `minChars` / `maxChars` / `task*` / `taskLineMax` / `lawyerLine*` / `carriedRatio` / `carriedMinChars` / `recentLineKeep` / `citationAnchorMax` / `llm*`）、钉子（`pins.taskCharCap` / `factEnabled` / `factMaxItems` / `factItemCharCap` / `factTotalCharCap` / `factCitationAnchorMax`）、续接（`carryover.seedCharRatio` / `seedMinChars` / `seedMaxChars` / `digestShare` / `digestMinChars` / `frameMinChars` / `digestPreviewChars` / `suggestMinCompacts`）。

三条纪律（`src/lawmind/agent/context-tuning.ts` 的 `resolveContextTuning`）：

- **类型不对回落默认、越界夹到边界，绝不抛错**——写错一个数不会让采样路径炸。
- **跨字段不变量**在解析处收敛：`min ≤ max`、`warnRatio ≤ midTurnCompactTriggerRatio`。
- **没写就逐位等于默认**（行为不变）。

**比例类键没有业务性下限**：只拦「明显非法」（非正 / `NaN` 回落默认、超大夹到该键的上界）。合法的极小值必须原样生效——曾把触发线下界写成 `0.1`，于是「压到 0.02 以强制触发」被**静默**改掉；越界自动修正不该替调用方决定「多小才算合理」。

配完在用量面板 / `GET /api/sessions/:id/context-budget` 看 `tuning`（生效值）与 `tuningOverrides`（显式写过的键）——能说清「按哪套数字在跑」，而不只是「按默认」。完整键表与默认值见 `docs/LAWMIND-EXECUTION-CONSTRAINTS.md` 第 24 条与 `LawMindContextPolicy` 类型注释。

**`agentMandatoryRules` 和 `agentMandatoryRulesPath` 的区别**：

- 内联版适合短规则（比如「所有金额必须写出来源」）。
- 文件版适合长规则，路径必须是工作区内相对路径，有字符上限（8192）。

两者都不走检索——它们**每轮都注入**。所以只放真正必须的。

案件级的强制规则是另一个机制：`matters/<id>/RULES.md` 或 `cases/<id>/RULES.md`（这两个路径受写保护，因为它们进提示词）。

## 30.5 判断与决策

| 键                                                                 | 说明                                                          |
| ------------------------------------------------------------------ | ------------------------------------------------------------- |
| `judgmentTiering`                                                  | `off` / `shadow` / `on`（默认 `shadow`）                      |
| `judgmentDisabledVerifiers`                                        | 禁用的机器验证器 id 数组                                      |
| `judgmentEscalation`                                               | `off` / `on`（默认 `off`）                                    |
| `judgmentEscalationPosture`                                        | `advisory` / `block`（默认按版本：solo advisory，其他 block） |
| `judgementPromotion.minSamples`                                    | 判断项升级的最小样本数（默认 20）                             |
| `judgementPromotion.maxFalsePositiveRate`                          | 允许的最大误报率（默认 0.1）                                  |
| `decisionModelMode`                                                | `off` / `shadow` / `on`                                       |
| `decisionModelBaseUrl` / `decisionModelApiKey` / `decisionModelId` | 决策模型配置                                                  |
| `routeDivergenceShadow`                                            | 路由分歧影子                                                  |
| `routeDivergencePosture`                                           | `off` / `shadow` / `escalate`                                 |

**`shadow` 是什么**：只记录、不改变结论。这是很克制的上线方式——先攒数据看准不准，再切 `on`。

**`judgementPromotion` 是棘轮的参数**（第 12 章）。注意「误报率」这个指标曾经因为判定条件写错而恒为 0，导致所有项都被判可升级（第 29 章案例 29.11）。

## 30.6 交付与自主

| 键                                      | 说明                                            |
| --------------------------------------- | ----------------------------------------------- |
| `delivery.firmForceFullReview`          | 律所强制全审                                    |
| `progressiveAutonomy.minFirstPassRate`  | 解锁自动交付的最低一次通过率（默认 0.8）        |
| `progressiveAutonomy.minSamples`        | 最低样本数（默认 20）                           |
| `progressiveAutonomy.maxLintEscapeRate` | 最大逃逸率（默认 0.15）                         |
| `appliedPreferencesFooter`              | 已生效偏好的展示位置 `always` / `first` / `off` |
| `autoDeliverableWorkflow`               | 自动交付物工作流                                |
| `benchmarkGateMinScore`                 | benchmark 门的最低分（默认 0.8）                |

`delivery.firmForceFullReview` 为真时，**所有交付都走 `full_review`**，不看风险等级。

## 30.7 记忆

| 键                                                   | 说明                            |
| ---------------------------------------------------- | ------------------------------- |
| `memoryRecall.preferSmallFiles`                      | 偏好小文件召回                  |
| `memoryRecall.smallFileMaxBytes`                     | 小文件阈值（默认 8000）         |
| `productInsightsCollection`                          | `off` / `local-only` / `synced` |
| `teamMemorySync.enabled` / `teamMemorySync.endpoint` | 团队记忆同步（默认关）          |
| `intakeHeuristicsEnabled`                            | 交办启发式                      |

**`productInsightsCollection` 的默认**：离线模式下强制 `off`；否则 solo 是 `local-only`，其他版本是 `synced`。也就是说**产品观察事件默认不上传**，除了律所版。

## 30.8 索引与检索

| 键                       | 说明               |
| ------------------------ | ------------------ |
| `searchIndexAutoRebuild` | 索引陈旧时自动重建 |
| `retrievalMode`          | 见 30.3            |

**注意重建索引还有另一道开关**（`LAWMIND_ALLOW_INDEX_REBUILD`），那个管的是「能不能通过 API 触发重建」，和「守不守自动重建」是两件事。

## 30.9 本机访问

| 键           | 说明             |
| ------------ | ---------------- |
| `hostAccess` | 本机访问相关配置 |

对应的环境变量是 `LAWMIND_HOST_ACCESS_MODE`、`LAWMIND_HOST_ACCESS_FILE`、`LAWMIND_HOST_COMMANDS`。默认策略是**本机文件夹只读**（第 15 章）。

## 30.10 审计

| 键                       | 说明                                            |
| ------------------------ | ----------------------------------------------- |
| `auditExportCadenceHint` | 导出节奏提示（写进治理报告）                    |
| `auditExternalAnchorUrl` | 外锚地址（也可放 `lawmind/desk-settings.json`） |

审计链密钥用环境变量 `LAWMIND_AUDIT_CHAIN_KEY`（不能放工作区里）。

## 30.11 案件副本

| 键                             | 说明               |
| ------------------------------ | ------------------ |
| `matterReplica.enabled`        | 开关               |
| `matterReplica.endpoint`       | HTTP 中继地址      |
| `matterReplica.sharedRelayDir` | 共享文件夹中继目录 |
| `matterReplica.cloudDataDir`   | 案件云数据目录     |
| `matterReplica.cloudToken`     | 云令牌             |
| `matterReplica.autoSync`       | 自动同步           |

**版本门禁**：`matterReplicaCollab` 在 solo 是关的。要开至少需要 firm，或者在 policy 里显式 `enabled: true`（`matter_replica_requires_firm_or_opt_in` 这个原因码说明可以显式开）。

## 30.12 完整示例（律所版）

```json
{
  "schemaVersion": 1,
  "description": "XX 律所生产配置",
  "edition": "firm",

  "egressMode": "allowlisted",
  "networkAllowlist": ["api.deepseek.com", "flk.npc.gov.cn", "www.gov.cn"],
  "networkAllowlistEnforced": true,

  "toolSandbox": true,
  "strictDangerousToolApproval": true,

  "agentMandatoryRules": "所有引用必须能回溯到本案检索结果或材料；金额必须写出来源；不得改写事实。",
  "agentMaxToolCallsPerTurn": 40,

  "judgmentTiering": "shadow",
  "judgmentEscalation": "on",
  "judgmentEscalationPosture": "block",

  "guardianTrackedRedline": "block",
  "wordAddinAutoRun": false,

  "ethicsWall": { "enabled": true },

  "delivery": { "firmForceFullReview": false },

  "matterReplica": {
    "enabled": true,
    "sharedRelayDir": "/Volumes/firm-share/lawmind-relay",
    "autoSync": true
  },

  "memoryRecall": { "preferSmallFiles": true },
  "productInsightsCollection": "off",
  "searchIndexAutoRebuild": true,

  "auditExportCadenceHint": "每月归档一次"
}
```

**注意**：这个示例里的路径和域名都是示意，实际要按你们的网络环境改。

## 30.13 一个容易忽略的细节

策略文件能**直接覆盖环境变量**。能覆盖的四项（第 14 章）：

| 策略键                               | 覆盖的环境变量                         |
| ------------------------------------ | -------------------------------------- |
| `egressOffline` / `forceNoWebSearch` | `LAWMIND_POLICY_FORCE_NO_WEB_SEARCH=1` |
| `retrievalMode`                      | `LAWMIND_RETRIEVAL_MODE`               |
| `enableCollaboration: false`         | `LAWMIND_ENABLE_COLLABORATION=false`   |
| `edition`                            | `LAWMIND_EDITION`                      |

**加载顺序**：环境文件（用户 → 仓库补缺）→ 策略文件。所以策略文件能压住环境变量。

这个设计的用途是：**IT 可以在不改 .env（不动密钥）的前提下，用策略文件下硬约束。**

## 30.14 排查配置不生效

按这个顺序查：

1. **`schemaVersion` 有没有且是 1？** 没有就整份被忽略。
2. **文件是不是在工作区根？** 它叫 `lawmind.policy.json`，不在 `lawmind/` 目录里。
3. **JSON 语法对不对？** 解析失败也是静默忽略。
4. **体检页 `policy.applied` 列了哪些项？** 只有列出来的才生效了。
5. **是不是被环境变量压住了？** 注意上面那个覆盖关系是「策略压环境」，反过来不成立。
6. **版本对不对？** 有些功能是版本门禁（比如 solo 默认不开协作）。

## 30.15 已知坑（本章相关）

- **缺 `schemaVersion` 整份忽略。** 最常见的配置失效原因。
- **策略文件在工作区根，不在 `lawmind/` 里。**
- **`egressMode` 是上限，`allowWebSearch` 是偏好。** 别用策略去改偏好。
- **策略能压环境变量，反过来不行。**
- **`highSecurityMode` 已废弃**，用 `egressMode: "offline"`。
- **`judgmentTiering` 默认是 `shadow`**（只记录不生效）。想要真的拦，得设 `on`。
- **`agentMandatoryRules` 每轮都注入。** 别把长文档塞进去，用 `agentMandatoryRulesPath`。
- **`cases/<id>/RULES.md` 也进提示词，所以它受写保护。**
- **`searchIndexAutoRebuild` 和 `LAWMIND_ALLOW_INDEX_REBUILD` 是两件事。**
- **`productInsightsCollection` 的默认在离线模式下是 `off`。**
- **改完一定看 `policy.applied`。**
