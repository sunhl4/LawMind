# 第 30 章 策略文件字段参考

`lawmind.policy.json` 放在**工作区根**。它只给所务信息管理员下硬边界：出网、外发收件域、律所规则文件、交付是否一律全审、案件副本共享目录。不是调模型的地方，也不是存密钥的地方。

缺 `schemaVersion`（须 ≥ 1）或 JSON 坏了，整份不生效。写错的键**不会悄悄生效**：`GET /api/health` 的 `policy.applied` / `policy.migrated` / `policy.rejected` 分别列出已生效、旧键迁移、未采纳（键名和原因，`apps/lawmind-desktop/server/lawmind-policy.ts`）；`pnpm lawmind:doctor` 也会打出来。

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
| `edition`                   | `solo` / `firm` / `private_deploy`。决定伦理墙、协作、修订稿是否必须过独立审稿。优先级高于 `LAWMIND_EDITION`                                                                                                                                                           |
| `network.mode`              | 出网上限：`open` / `allowlist` / `offline`。`offline` 强制断网，不改律师自己的联网偏好                                                                                                                                                                                 |
| `network.hosts`             | `allowlist` 时允许的域名。裸后缀 `gov.cn` 含子域                                                                                                                                                                                                                       |
| `outbound.recipientDomains` | 外发邮件允许的收件域                                                                                                                                                                                                                                                   |
| `firmRulesPath`             | 工作区内相对路径，UTF-8，最多 8192 字，每轮注入。不要把长文内联进 JSON                                                                                                                                                                                                 |
| `delivery`                  | `standard` 或 `always_full_review`（一律全审）                                                                                                                                                                                                                         |
| `replica.sharedDir`         | 案件副本共享目录。令牌和云地址不要写在这里                                                                                                                                                                                                                             |
| `wordAddinAutoRun`          | 只在要推翻版本默认时写。独立律师默认开，律所默认关                                                                                                                                                                                                                     |
| `allowWebSearch`            | 只能写 `false`，表示不许联网检索。要封顶用 `network.mode`                                                                                                                                                                                                              |
| `enableCollaboration`       | 只能写 `false`，关掉协作                                                                                                                                                                                                                                               |
| `conversationLength`        | 对话长度档：`"200k"` / `"500k"` / `"1m"`。这是本轮硬天花板 = min(模型窗口, 所选档)。历史整理仍按 200K 质量带，不随档位推迟。旧值 `daily` / `dossier` 读出时自动迁移成 200k / 1m（`src/lawmind/agent/context-preset.ts`）。律师日常在对话输入栏工具条里切，不必手写文件 |

独立律师不必建这个文件。联网或离线在设置里切。

## 30.2 版本已经定死、策略改不了的

- 引用门禁：律所和私有化是 `grounded`，独立律师是 `assisted`。不能写成关掉。
- 修订稿：律所和私有化导出前必须过独立审稿，不能降成只提示。
- 伦理墙、危险操作确认、产品观察：跟版本走。律所默认不上传产品观察。
- 上下文压缩、每轮工具次数、历史条数、判断分级、决策模型、渐进自主：引擎内置。开发时可以用环境变量 `LAWMIND_CONTEXT_TUNING`（JSON）调压缩，不要写进策略文件。

密钥（模型 key、副本令牌、审计链密钥）只走环境变量或钥匙串。写进策略文件会被拒绝。

## 30.3 旧键

仍能读、`policy.migrated` 里会提示改名：`egressMode`（`allowlisted` 对应 `allowlist`）、`networkAllowlist`、`outboundAllowedDomains`、`agentMandatoryRulesPath`、`delivery.firmForceFullReview`、`matterReplica.sharedRelayDir`、`highSecurityMode: true`（按离线生效）。

## 30.4 不生效时看哪里

1. 文件在工作区根，名叫 `lawmind.policy.json`。
2. 有 `schemaVersion` 且 ≥ 1，JSON 能解析。
3. `GET /api/health` 的 `policy`：`applied` 已生效的键、`migrated` 迁移提示、`rejected` 未采纳的键（附原因）。
4. 策略压过同名环境变量；环境变量压不过策略。
