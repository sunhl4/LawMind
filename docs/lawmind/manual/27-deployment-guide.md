# 第 27 章 交付实施与团队部署

这一章给交付实施方和律所 IT 看：怎么把 LawMind 部署到一台机器或一个团队，怎么验收，怎么长期维护。

## 27.1 部署形态有三种

| 形态      | 适用                                       | 数据在哪                                 |
| --------- | ------------------------------------------ | ---------------------------------------- |
| 单机 solo | 独立律师                                   | 全部在本机（工作区 + 应用数据目录）      |
| 单机 firm | 一人机器但启用所级功能（伦理墙、强制互审） | 仍在本机，多了一层门禁                   |
| 多人协作  | 团队办同一个案子                           | 名册与操作经中继同步，**内容端到端加密** |

第三种不是「把数据放服务器」——**内容仍加密，密钥永不出本机**（第 16 章）。

## 27.2 单机部署清单

### 装机

1. 确认系统和架构（macOS 分 arm64 / x64；Windows x64；Linux x64）。
2. 用安装包，或者源码按第 2 章跑。
3. **不要**为了「方便」用浏览器打开 5174。

### 配模型

推荐走 UI 向导（设置 → 模型与连接），因为：

- 密钥会进系统密钥链。
- 会从环境文件里抹掉明文。

批量部署想走环境文件的，在 `.env.lawmind` 里写：

```text
LAWMIND_AGENT_BASE_URL=...
LAWMIND_AGENT_MODEL=...
LAWMIND_AGENT_API_KEY=...
```

**注意**：手工写环境文件的密钥是明文的，而且优先级高于密钥链。确认这台机器的权限控制和备份策略能接受这一点。

### 配策略文件

在工作区根放 `lawmind.policy.json`。**必须有 `schemaVersion: 1`，否则整份被忽略**（这是最常见的配置失效原因）。

一个 firm 版的最小示例：

```json
{
  "schemaVersion": 1,
  "edition": "firm",
  "egressMode": "allowlisted",
  "networkAllowlist": ["api.deepseek.com", "flk.npc.gov.cn"],
  "networkAllowlistEnforced": true,
  "auditIntegrityExport": true,
  "toolSandbox": true
}
```

**几个键的作用**：

| 键                                              | 作用                                           |
| ----------------------------------------------- | ---------------------------------------------- |
| `edition`                                       | 定版本（`solo` / `firm` / `private_deploy`）   |
| `egressMode`                                    | 出网上限（`open` / `allowlisted` / `offline`） |
| `networkAllowlist` + `networkAllowlistEnforced` | 允许哪些域名，是否强制                         |
| `toolSandbox`                                   | 高风险工具进子进程                             |
| `ethicsWall.enabled`                            | 伦理墙                                         |
| `guardianTrackedRedline`                        | 修订稿独立审稿档位（`block` / `advisory`）     |
| `agentMandatoryRules`                           | 每轮必注入的强制规则（短文本）                 |
| `agentMandatoryRulesPath`                       | 强制规则文件路径（工作区内）                   |
| `judgmentTiering`                               | 判断项分级（`off` / `shadow` / `on`）          |
| `searchIndexAutoRebuild`                        | 索引陈旧时自动重建                             |

**配完在体检页核对 `policy.applied`**——它会列出真的生效了哪几项。

### 配技能签名

如果要用自己写的技能：

```bash
export LAWMIND_SKILL_SIGNING_SECRET='<足够长的随机串>'
pnpm lawmind:skills:sign --workspace <工作区>
```

**必须用真密钥。** 派生兜底值（`derived`）不算安全机制，CLI 在没有 `--allow-derived` 时会拒绝。

签完之后验证：

```bash
pnpm lawmind:skills:sign --workspace <工作区> --check
```

## 27.3 团队部署清单

在单机清单基础上，多做四件事。

### 一、定中继形态

| 形态                       | 什么时候用           |
| -------------------------- | -------------------- |
| 共享文件夹（NAS / 同步盘） | 小团队，已有内部共享 |
| HTTP 中继（自建）          | 稍大规模，想控制访问 |
| 案件云                     | 要名册管理、多租户   |

共享文件夹最省事，但要注意：**同步盘本身会做文件同步**，可能和 LawMind 的同步机制叠加。建议给它一个独立目录。

### 二、确认版本与关键开关

firm 版默认开的几项（第 15 章那张表）：

- 强制互审（`forcePeerReview`）
- 伦理墙（`ethicsWall`）
- 案件副本协作（`matterReplicaCollab`）
- 修订稿独立审稿硬墙（`guardianTrackedRedlineBlock`）
- 危险工具严格审批（`strictDangerousToolApproval`）

**注意 `wordAddinAutoRun` 在 firm 默认关**——保留「桌面端必须有一次显式动作」的档位。要开得在策略里显式打开。

### 三、准备培训材料

至少讲清四件事：

1. **五个工作面各干什么**（第 2 章）。
2. **只有外发会打断你**（减少「为什么它不问我就做了」的疑惑）。
3. **记忆要确认才写入**（减少「它怎么知道我偏好这个」的顾虑）。
4. **必核清单和签批是两道门**。

### 四、定验收口径

见 27.4。

## 27.4 验收怎么验

### 功能验收（一定要跑的）

| 验什么     | 怎么验                             | 通过标准                                  |
| ---------- | ---------------------------------- | ----------------------------------------- |
| 模型通     | 设置 → 系统健康                    | 已配置且连通                              |
| 交办通     | 发一条「查一下民法典违约责任」     | 出备忘，且没中途问「要不要继续」          |
| 材料通     | 拖一份合同说「审一下」             | 出审查意见，风险指向具体条款              |
| 改稿通     | 走一遍改稿 → 签批 → 导出           | 导出的是带修订轨的 Word，且改动是最短锚点 |
| 记忆通     | 记忆库确认一条                     | 档案里出现对应改动                        |
| 外发闸门通 | 让它发一封邮件                     | 停在「待我拍板」                          |
| 审计通     | `pnpm lawmind:ops acceptance-pack` | 出验收包                                  |

### 门禁验收（命令行）

```bash
pnpm lawmind:gate --all --strict          # 交付验收门
pnpm lawmind:ops matter-consistency       # 案件投影一致性
pnpm lawmind:doctor --json                # 体检
pnpm lawmind:release-readiness            # 发布就绪（如果是发版场景）
```

`lawmind:gate` 的退出码：0 = 全部就绪或没有草稿；1 = `--strict` 下有未就绪；2 = 参数或 IO 错误。

### 三个「诚实 SKIP」要认识

以下三项**没有夹具时会 SKIP，这是正常的**：

| 门                                   | 需要什么才有意义                                         |
| ------------------------------------ | -------------------------------------------------------- |
| 真稿门（`lawmind:true-manuscript`）  | 律师脱敏后的真稿放在 `fixtures/lawmind-true-manuscript/` |
| 人类基准（`lawmind:human-baseline`） | 同题双稿（人写 + 系统写）至少 10 个案例                  |
| 类案就绪                             | 本机有可用的类案索引                                     |

**不要把 SKIP 当失败**，也不要用仓库里的示例文件去凑（那会让门禁失去意义）。

### 安全验收

| 项                | 怎么验                                                    |
| ----------------- | --------------------------------------------------------- |
| 本机 API 只对回环 | 从另一台机器访问本机端口，应该连不上                      |
| 分包鉴权          | `word-addin` 客户端不能调 `/api/matters/*`（返回 403）    |
| 治理路径保护      | 试着通过文件接口改 `lawmind.policy.json`，应该被拒        |
| 本机文件夹只读    | 试着改本机文件夹里的文件，应该被拒并提示「收进本案」      |
| 外发要审批        | 已验                                                      |
| 审计链完整性      | `GET /api/audit/export-summary` 看 `rootHash`；异机验外锚 |

## 27.5 长期维护

### 备份

备份清单（第 C.1 节详列）：

| 要备   | 位置                                                                                             |
| ------ | ------------------------------------------------------------------------------------------------ |
| 工作区 | `<工作区>/`（重点是 `matters/`、`cases/`、`drafts/`、`sessions/`、`tasks/`、`*.md`、`lawmind/`） |
| 应用根 | `<用户数据目录>/LawMind/`（助手档案等）                                                          |
| 密钥   | 系统密钥链 + `~/.lawmind/keys/`                                                                  |
| 许可   | `~/.lawmind/license.json`                                                                        |

```bash
LAWMIND_WORKSPACE_DIR=<工作区> bash scripts/lawmind/lawmind-backup.sh <输出.tar.gz>
```

备份默认**不含** `.env.lawmind`。要含得设 `LAWMIND_BACKUP_INCLUDE_ENV=1`。

**派生数据不用备**：`lawmind/search-index.sqlite` 可以从真相源重建。

### 升级

1. 先备份。
2. 装新版本。
3. 打开后看体检页（策略有没有生效、索引要不要重建）。
4. 如果升级提示大量 404，重建本地服务 bundle：

```bash
pnpm lawmind:bundle:desktop-server
```

5. Word 插件如果连不上，重新侧载清单（端口可能变了）。

### 定期体检

建议每月跑一次：

```bash
pnpm lawmind:ops status --deep
pnpm lawmind:doctor
pnpm lawmind:ops matter-consistency
```

看三件事：投影有没有漂移、会话历史有没有损坏（`--fix` 可修）、索引是否陈旧。

### 审计导出

如果需要合规归档：

```text
GET /api/audit/export?since=<起始>&until=<结束>&compliance=1
GET /api/audit/export?integrity=1        # 带完整性信息
GET /api/audit/export-summary?format=text # 摘要
```

外锚用于「防篡改」：配 `LAWMIND_AUDIT_EXTERNAL_ANCHOR_URL`（`file://` 或 HTTP PUT），每 24 小时推一次摘要。

**注意审计不记 query 参数和 body**（第 15 章），所以别指望从审计里还原「查了什么」。

### 密钥轮换

| 密钥                           | 怎么轮换                 | 影响                                       |
| ------------------------------ | ------------------------ | ------------------------------------------ |
| 模型 API Key                   | 设置里重存               | 无                                         |
| `LAWMIND_AUDIT_CHAIN_KEY`      | 换之后新事件用新密钥     | 旧链仍可验（接受本机任一把匹配密钥）       |
| `LAWMIND_SKILL_SIGNING_SECRET` | 换后要**重新签所有技能** | 不重签的技能会静默失效                     |
| `LAWMIND_MAIL_SECRETS_KEY`     | 换后旧密文解不开         | 邮箱账号要重配（且系统**拒绝覆盖**旧密文） |
| 本机 API 安装密钥              | 会自动生成并注入         | 无（客户端凭据是派生的）                   |

**邮件密钥那条要特别注意**：换密钥前先导出邮箱配置，否则「解不开又不许覆盖」会让你卡住。

## 27.6 私有化部署的额外检查

`private_deploy` 版本有一份自检（第 15 章），六项：

| 项                       | 检查什么                         |
| ------------------------ | -------------------------------- |
| `policy_file`            | 策略文件在不在                   |
| `edition_private`        | 版本对不对                       |
| `network_allowlist`      | 白名单配了没                     |
| `strict_dangerous_tools` | 危险工具严格审批开了没           |
| `compliance_export`      | 合规审计导出可用                 |
| `skill_signing_secret`   | 技能签名用了真密钥（不是派生值） |

结果在体检页的 `doctor.privateDeployChecklist`，会显示通过几项。

另外 `private_deploy` 独有的两项功能是开的：

- `complianceAuditExport`（合规审计导出）
- `securitySbomPanel`（SBOM 安全面板）

## 27.7 常见实施问题

### 「模型选哪个」

看三件事：能不能连、贵不贵、够不够用。

实践建议：**先用一个通用模型跑通，再考虑换钱**。法律垂类模型（ChatLaw / LawGPT 等）可以配成检索或推理的专用通道，不是必须。

### 「提示词要调吗」

**不用。** 这个系统里「调效果」的正确做法是：

1. 填准首跑偏好。
2. 配工作区的 `playbooks/CLAUSE_PLAYBOOK.md`。
3. 确认记忆库里的建议。
4. 必要时用明确的交办话术（第 26 章）。

改系统提示词是最后手段，而且改动会影响所有任务。

### 「审计要保存多久」

法律上没有统一答案，看你们的合规要求。技术上：

- 审计按天分文件，写在 `<工作区>/audit/`，不会自动删除。
- 外锚摘要是轻量的，可以长期留着。
- 历史审计**不要手动删**——哈希链是按顺序连的，删中间某天会让链断。

### 「能不能多人同时用一台机器」

不建议。工作区是**同一时刻一个写者**的设计（第 7 章的锁）。真要多人用，走案件副本那条路（第 16 章）。

### 「换机器怎么迁」

1. 备份工作区。
2. 新机器装好。
3. 恢复工作区。
4. **重配密钥**（密钥链是本机的）：模型 API Key、技能签名密钥、审计链密钥、邮箱密钥。
5. 重建索引（打开应用会自动跑，或者显式触发）。
6. 如果是 Word 插件场景，重新侧载清单。

## 27.8 一份部署检查表

装完之后逐项打勾：

```text
[ ] 安装包与系统架构匹配
[ ] 桌面窗口能打开
[ ] 模型已配置且连通
[ ] 检康页无红色项（SKIP 除外）
[ ] 工作区路径符合你们的规范
[ ] lawmind.policy.json 已配且 schemaVersion=1
[ ] 体检页 policy.applied 列出了预期项
[ ] 网络白名单（如启用）已放行模型域名与法源域名
[ ] 技能签名密钥已设（如果用自定义技能）
[ ] 审计外锚（如需要）已配
[ ] 测试交办能跑通
[ ] 外发会停在「待我拍板」
[ ] 备份脚本能跑通
[ ] Word 插件（如用）能侧载并取件
[ ] 培训材料已讲
```

## 27.9 已知坑（本章相关）

- **策略文件缺 `schemaVersion: 1` 会被整份忽略。** 配完一定看 `policy.applied`。
- **手工写环境文件的密钥是明文，且优先级高于密钥链。** 想让它进密钥链就走 UI。
- **`wordAddinAutoRun` 在 firm 默认关。** 不是漏配。
- **三个诚实 SKIP 不是失败。** 别用示例文件去凑。
- **换技能签名密钥必须重签所有技能。** 不重签会静默失效。
- **换邮箱密钥前先导出配置。** 解不开的旧密文会被拒绝覆盖。
- **不要手动删中间某天的审计文件。** 会让哈希链断。
- **同一台机器不要多人同时用一个工作区。**
- **换机器必须重配密钥。** 密钥链不跟着目录走。
- **派生数据不用备份**（索引、质量快照都从真相源重算）。
