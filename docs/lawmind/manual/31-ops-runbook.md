# 第 31 章 运维手册（Runbook）

这一章是给日常运维用的操作步骤。每个步骤都按 **什么时候做 → 怎么做 → 怎么确认** 写。

## 31.1 日常巡检（每周一次）

```bash
pnpm lawmind:doctor
pnpm lawmind:doctor --deep
```

看三件事：

| 看什么     | 期望                       | 不对怎么办 |
| ---------- | -------------------------- | ---------- |
| 投影一致性 | 无漂移                     | 见 31.5    |
| 会话完整性 | 无损坏会话、无悬空工具调用 | 见 31.6    |
| 索引状态   | 就绪、不陈旧               | 见 31.4    |

**每周花两分钟跑这两条，比出问题后翻半天强。**

## 31.2 每月一次：完整检查

```bash
pnpm lawmind:ops matter-consistency
pnpm lawmind:ops export-dashboard
pnpm lawmind:ops acceptance-pack
```

第二三条会产出报告文件，可以存档。

另外手工看一次体检页的这几行：

- `doctor.process.degraded`（有没有未处理的 Promise 拒绝）
- `doctor.authorityUsage`（法源调用量，看有没有异常高）
- `doctor.license`（许可状态）
- `doctor.privateDeployChecklist`（私有化部署版才有）

## 31.3 备份（按需 / 定期）

```bash
LAWMIND_WORKSPACE_DIR=<工作区> bash scripts/lawmind/lawmind-backup.sh /path/to/backup-$(date +%F).tar.gz
```

**默认不含 `.env.lawmind`。** 要含得加：

```bash
LAWMIND_BACKUP_INCLUDE_ENV=1 LAWMIND_WORKSPACE_DIR=<工作区> bash scripts/lawmind/lawmind-backup.sh <路径>
```

**注意这里不是 `pnpm` 脚本。** `package.json` 里**没有** `lawmind:backup` 这个入口（所以照 `pnpm lawmind:backup` 敲会 command not found），要像上面这样直接跑 bash 脚本。第 17.5 节讲脚本清单时点过这件事。

**确认方法**：解开看有没有 `BACKUP-MANIFEST.txt`，再看关键目录在不在（`matters/`、`cases/`、`drafts/`）。

**恢复步骤**：

1. 停掉 LawMind（退出应用，也停守护进程：`pnpm lawmind:daemon -- stop`）。
2. 备份当前工作区（万一要回滚）。
3. 解开到工作区路径。
4. 起应用，看体检页。
5. 如果需要，重建索引（见 31.4）。
6. **确认密钥还在**（备份不含密钥链；换机器要重配）。

## 31.4 重建检索索引

**什么时候做**：

- 体检页显示索引陈旧（`staleReason` 非空）。
- 搜不到本来该搜到的东西。
- 升级之后（schema 版本可能变了）。

**怎么做**：

```bash
# 需要有开关
export LAWMIND_ALLOW_INDEX_REBUILD=1
```

然后：

```text
POST /api/search/workspace/rebuild
```

或者直接重启应用（启动了索引不存在时会在后台重建一次）。

**注意**：重建是重活，材料多的时候会跑一阵。它**不影响真相源**——索引是派生的，删了也能重建。

**确认方法**：体检页的 `doctor.searchIndex` 里 `lastRebuildAt` 更新了，`stale` 变 false。

## 31.5 修案件投影漂移

**症状**：`cases/<id>/CASE.md` 里的结构化字段和 `matters/<id>/matter.json` 不一致。

**查**：

```bash
pnpm lawmind:ops matter-consistency
```

它会给出问题码（`title_drift`、`status_drift` 等）。

**修**：

```bash
pnpm lawmind:ops matter-repair-projection
```

或者：

```text
POST /api/matters/repair-projections
```

**注意**：CASE.md 里的**叙事小节**（争点、风险、进展）**不镜像回 JSON**，所以它们不一致不算漂移。

## 31.6 修会话历史损坏

**症状**：仪表盘显示有损坏会话、悬空工具调用或孤儿工具结果。

**原因**：一般是进程崩溃或异常中断留下的。模型 API 对「工具调用没有对应结果」这类历史很敏感，会导致后续请求被拒。

**修**：

```bash
pnpm lawmind:doctor --fix
```

它会修 `session.json` 和 `transcript.jsonl` 里的工具调用配对。

**确认**：再跑一次 `pnpm lawmind:doctor`，损坏计数归零。

## 31.7 处理卡住的后台任务

**查**：

```text
GET /api/jobs?status=running
GET /api/automations/<id>/runs
```

**三种情况**：

| 情况       | 怎么处理                                                                          |
| ---------- | --------------------------------------------------------------------------------- |
| 刚起不久   | 等它跑                                                                            |
| 卡很久     | `POST /api/jobs/:id/cancel`（running 状态只能「请求取消」，会在步骤批次之间生效） |
| 进程重启过 | 非终态任务已被自动标成 `interrupted_by_restart`，不用管                           |

**注意**：`running` 的取消不是立即的——已经在跑的单次调用不会被打断。

## 31.8 重新侧载 Word 插件清单

**什么时候做**：

- 体检页提示端口漂移。
- Word 窗格报「无法加载该加载项」。
- 换了机器或重装了应用。

**怎么做**：

设置 → 系统健康 → Word 插件组 → 「重新侧载 Word 清单」。

**然后必须完全退出 Word 再打开**（macOS 上侧载是启动时读的）。

**确认**：Word 里任务窗格能打开，且点「审这份」能建出请求。

## 31.9 处理 Word 插件卡住的请求

**查** `workspace/lawmind/word-addin/reviews.json`，找 `running` 状态的。

**系统会自动清理**：超过 30 分钟的 `running` 会被如实标成 `failed`（孤儿清理）。所以正常情况下不用手工干预。

**如果一直卡**，看是不是服务没在跑——孤儿清理也需要 tick。

## 31.10 导出审计

**日常导出**：

```text
GET /api/audit/export?since=<起始>&until=<结束>
```

**合规导出**（多一段按类型的计数和免责声明）：

```text
GET /api/audit/export?...&compliance=1
```

**带完整性信息**：

```text
GET /api/audit/export?...&integrity=1
```

**只要摘要**：

```text
GET /api/audit/export-summary?format=text
```

**验外锚**：

```text
POST /api/audit/verify-external
```

**注意**：

- 审计**不记 query 和 body**，所以别指望从审计还原「查了什么」。
- **不要手动删中间某天的审计文件**——哈希链是按顺序连的。

## 31.11 配审计外锚

**什么时候做**：需要「防篡改」证据时（合规要求）。

**怎么做**：设 `LAWMIND_AUDIT_EXTERNAL_ANCHOR_URL`，或者写 `lawmind/desk-settings.json` 的 `auditExternalAnchorUrl`。

支持两种目标：

| 形式                      | 说明             |
| ------------------------- | ---------------- |
| `file:///path/to/anchors` | 写文件（原子写） |
| `https://...`             | HTTP PUT         |

**自动同步每 24 小时一次**，也可以手动触发。

**注意**：外锚同步是 **best-effort**——失败只警告，不影响审计写入。

## 31.12 轮换密钥

按类型分别处理：

### 模型 API Key

设置里重存即可（新密钥进密钥链，旧明文被抹掉）。

### 审计链密钥（`LAWMIND_AUDIT_CHAIN_KEY`）

换之后：

- **旧链仍可验**（密钥解析接受本机任一把匹配的密钥）。
- 新事件带新的 `hmacKeyId`。
- 如果完全找不到旧密钥，那段会显示成 `legacy`。

**所以换之前确认旧密钥还在**（本机密钥文件或环境变量）。

### 技能签名密钥（`LAWMIND_SKILL_SIGNING_SECRET`）

```bash
export LAWMIND_SKILL_SIGNING_SECRET='<新密钥>'
pnpm lawmind:skills:sign --workspace <工作区>
pnpm lawmind:skills:sign --workspace <工作区> --check
```

**必须重签所有技能。** 不重签的技能会**静默失效**（变成 `enabled: false`，不报错）。

### 邮箱密钥（`LAWMIND_MAIL_SECRETS_KEY`）

**换之前先导出邮箱配置！**

因为换密钥后旧密文解不开，而系统**拒绝覆盖解不开的密文**（防误毁）。所以你会既读不到旧配置，又不能写新的。

正确顺序：

1. 记下所有邮箱账号配置。
2. 换密钥。
3. 删掉 `mail-secrets.json`（因为解不开）。
4. 重新配邮箱。

### 本机 API 安装密钥

不用手工处理——它会自动生成并注入子进程。凭据是派生的，所以不需要客户端做任何事。

## 31.13 处理许可

**查状态**：

```text
GET /api/license
```

**激活**：

```text
POST /api/license/activate   { "code": "<激活码>" }
```

**机器指纹**（发给发行方换激活码）：

```text
GET /api/license/fingerprint
```

**清除**：

```text
POST /api/license/clear
```

**记两条**：

- 试用 30 天，**到期只提醒不锁死**。
- 激活码可以绑定机器指纹（`machine_mismatch` 就是不匹配）。

## 31.14 收集诊断包

**什么时候做**：要报问题给支持方时。

```text
GET /api/support/bundle?download=1
```

产出**脱敏 zip**：不含案件正文、不含 `.env*`、不含许可激活码。

配合使用：

1. 诊断包。
2. `pnpm lawmind:doctor --json` 的输出。
3. 相关审计导出（`/api/audit/export?taskId=<id>`）。

## 31.15 升级流程

1. **备份**（31.3）。
2. 装新版本。
3. 打开应用，看体检页：
   - `edition` 和 `policy.applied` 对不对。
   - 索引要不要重建。
4. 如果出现大量 404：

```bash
pnpm lawmind:bundle:desktop-server
```

然后重启。

5. Word 插件连不上 → 重新侧载清单（31.8）。
6. 如果升级涉及索引 schema 变化，重建索引（31.4）。

## 31.16 关停与重启

### 停

1. 退出应用（窗口关闭时如果还有后台任务，守护进程会接手）。
2. 想彻底停：

```bash
pnpm lawmind:daemon -- stop --workspace <工作区>
```

3. 确认守护状态：

```bash
pnpm lawmind:daemon -- status --workspace <工作区>
```

### 起

1. 打开应用。
2. 应用会自动停掉守护进程（窗口开着时由桌面端负责 tick）。
3. 想单独起守护（不用开界面）：

```bash
pnpm lawmind:daemon -- start --workspace <工作区>
```

**注意**：守护进程是**单实例**的。已经有在跑的，新起的会主动让位（日志里会写「已在运行，本进程让位」）。

## 31.17 一个「什么都没发生」的排查思路

如果用户说「它就是不动了」，按这个顺序查：

1. **服务活着吗？** `GET /api/health`。不通就看是不是崩了（会有监督进程重启）。
2. **模型通吗？** 体检页的模型行；或者 `pnpm lawmind:env:check`。
3. **卡在门禁上了吗？** 看「待我拍板」和「在办」有没有待处置项。
4. **守护进程在跑吗？** 关窗后的定时任务靠它。
5. **任务真的在跑吗？** `GET /api/jobs?status=running`。
6. **有没有孤儿？** 会话里的 `running` 占位轮次（读取时表现为 `interrupted`）。

大部分「不动了」都能在这六步里定位。

## 31.18 一份巡检表

```text
每周：
[ ] pnpm lawmind:doctor
[ ] pnpm lawmind:doctor --deep
[ ] 体检页看 process.degraded / 索引 / 许可

每月：
[ ] pnpm lawmind:ops matter-consistency
[ ] pnpm lawmind:ops export-dashboard（存档）
[ ] pnpm lawmind:ops acceptance-pack（存档）
[ ] 审计导出并归档
[ ] 确认备份可恢复（抽一个文件试解开）

每季：
[ ] 轮换模型 API Key
[ ] 检查技能签名是否都有效（pnpm lawmind:skills:sign --check）
[ ] 看一次法源用量（doctor.authorityUsage）
[ ] 审阅记忆库里的建议（有没有该采纳没采纳的）
```

## 31.19 已知坑（本章相关）

- **重建索引需要 `LAWMIND_ALLOW_INDEX_REBUILD=1`。**
- **`--fix` 修的是工具调用配对**，不是别的。
- **`running` 的 job 取消不是立即的。**
- **Word 插件的孤儿清理也要 tick**（服务没跑就不会清）。
- **备份默认不含环境文件。** 恢复前先确认拿到的备份含不含密钥。
- **不要手动删中间某天的审计文件**（会断链）。
- **换邮箱密钥前必须先导出配置。**
- **换技能签名密钥必须重签所有技能**（不重签会静默失效）。
- **守护进程是单实例，重复启动会让位。**
- **外锚同步失败只警告，不影响审计写入。**
- **诊断包是脱敏的，但不等于可以随便发**——发之前还是看一眼内容。
