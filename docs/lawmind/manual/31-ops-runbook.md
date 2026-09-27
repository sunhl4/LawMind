# 第 31 章 运维手册（Runbook）

这一章给律所 IT 和支持。律师日常打开应用即可：模型不通看设置 → 模型与连接，索引要重建看设置 → 工作区，Word 要重连看设置 → 外观；诊断包导出没有界面入口，只有端点 `GET /api/support/bundle`。命令行（`pnpm lawmind:doctor`）只在没人能开界面、或要修投影时用。

可审计不是产品价值。没有写明的留存义务或正在做的安全调查，不要把审计导出、外锚、哈希链放进巡检。交件好不好看第 27.5 节的金标，不看运行次数，也不看审计厚度。

五条铁律在这里的取舍：

| 铁律           | 这一章怎么落                                                                                 |
| -------------- | -------------------------------------------------------------------------------------------- |
| 上手简单       | 先跑 `pnpm lawmind:doctor`。一条命令覆盖会话、投影、索引。不要求每周再跑一套开发用的 smoke。 |
| 交付质量       | 巡检不证明稿子能用。质量仍看金标。                                                           |
| 稳定           | 会话配对和「文件改过」的索引会自己补上。只有投影漂移要人修。                                 |
| 先复用，后自研 | 备份是 tar。外锚是文件或 HTTP PUT。不自造运维平台。                                          |
| 发挥模型能力   | 不把词表、用量曲线、审计厚度当成「系统健康」。                                               |

## 31.1 每周看一次

打开应用能看的地方：模型连通看设置 → 模型与连接，索引与案件档案看设置 → 工作区（只在需要时出现）。更全的一遍：

```bash
pnpm lawmind:doctor
```

它打印三行：

| 行   | 完好时长什么样                           | 不完好时                                                             |
| ---- | ---------------------------------------- | -------------------------------------------------------------------- |
| 会话 | 最近若干会话的工具调用配对完好           | 下一轮对话会自动补上。要立刻写回磁盘：`pnpm lawmind:doctor -- --fix` |
| 投影 | CASE.md 的结构化字段与 matter.json 一致  | `pnpm lawmind:ops matter-repair-projection`（31.3）                  |
| 索引 | 就绪，或「有文件改过，下一次检索会补上」 | 缺索引时检索一次就会建。要整库重建走设置 → 工作区（31.2）            |

投影对不上，或有自定义技能因签名未通过而停用时，退出码是 1。签名失败不会在对话里报错，所以巡检必须说出来。会话损坏和索引缺失不因此失败：它们会在下一次对话或检索里自己好。

`pnpm lawmind:ops doctor` 打的是同一份三行。`--deep` 额外跑开发用的 smoke，**不是**每周巡检，也不再检查 `MEMORY.md` 在不在、环境变量严不严。安装包把密钥放在密钥链里，终端里的环境检查经常是红的，应用却是通的。模型通不通看设置 → 模型与连接的「验证模型」。

工作区不是仓库里的 `workspace/` 时，两条命令都认 `LAWMIND_WORKSPACE_DIR`。

## 31.2 重建检索索引

**什么时候做**：搜不到本来该搜到的东西；升级后体检写明要整库重建。文件改过（`sources_changed`）不用整库重建，下一次检索会把改过的材料补进索引。

**怎么做**：设置 → 工作区 →「重建查找」（索引没建好或过期时这组才出现）。从桌面应用打开时已经允许这个动作，不必再设 `LAWMIND_ALLOW_INDEX_REBUILD`。

只有单独启动、不经过桌面壳的 API 进程才要先设 `LAWMIND_ALLOW_INDEX_REBUILD=1`，再 `POST /api/search/workspace/rebuild`。索引文件还不存在时，检索会自己建，不看这个开关。

索引是派生的。删了不影响案件、文稿和会话。材料多时会跑一阵。

**确认**：设置 → 工作区的查找组消失（已跟上），或 `pnpm lawmind:doctor` 的索引行恢复就绪。

## 31.3 修案件投影漂移

**症状**：`cases/<id>/CASE.md` 里的标题、状态等结构化字段和 `matters/<id>/matter.json` 不一致。`matter.json` 是真相源。

**查**：`pnpm lawmind:doctor` 的「投影」行，或 `pnpm lawmind:ops matter-consistency`（会给出 `title_drift`、`status_drift` 这类码）。

**修**：

```bash
pnpm lawmind:ops matter-repair-projection
```

界面走不通时才用 `POST /api/matters/repair-projections`。

CASE.md 里的争点、风险、进展不写回 JSON。它们对不上不算漂移。模板里用斜体括号写的填写说明（例如客户那一行的「与目录 clients/…」）也不是客户名。

只有 `CASE.md`、没有 `matter.json` 时，同一条修复命令会按档案里的名称、阶段、客户补一份案件记录，再把结构化字段投影回去。争点、风险、进展保持原样。补完后这件会出现在工作台列表里。

## 31.4 备份与恢复

```bash
LAWMIND_WORKSPACE_DIR=<工作区> pnpm lawmind:backup -- /path/to/backup-$(date +%F).tar.gz
```

默认不含工作区根上的 `.env` 和 `.env.lawmind`。要打进包里才设 `LAWMIND_BACKUP_INCLUDE_ENV=1`，并且加密归档。密钥链和 `~/.lawmind/keys/` 不在这个包里。索引（`lawmind/search-index.sqlite`）是派生的，不进备份。

**确认**：解开后有 `BACKUP-MANIFEST.txt`，以及 `matters/`、`cases/`、`drafts/`。

**恢复**：

1. 退出应用。若关窗后还有守护进程：`pnpm lawmind:daemon -- stop --workspace <工作区>`。
2. 先把当前工作区另存一份。
3. 把归档解到工作区路径。
4. 打开应用，看体检。索引缺了会在检索时重建。
5. 换过机器就重配模型密钥、技能签名、邮箱。许可文件在 `~/.lawmind/license.json`，不在工作区包里。

## 31.5 卡住的后台任务

先看「在办」。命令只在界面打不开时用：`GET /api/jobs?status=running`。

| 情况       | 怎么处理                                                                                                  |
| ---------- | --------------------------------------------------------------------------------------------------------- |
| 刚起不久   | 等它跑                                                                                                    |
| 卡很久     | `POST /api/jobs/:id/cancel`。`running` 只是请求取消，在步骤批次之间生效，不会掐断已经发出的那一次模型调用 |
| 进程重启过 | 非终态任务会被标成 `interrupted_by_restart`，不用手工改状态                                               |

自动办件的失败必须出现在收件箱里。不要用「运行次数正常」判断它还在干活。

## 31.6 重新连接 Word

Word 或 WPS 报无法加载加载项、端口变了、或换了机器：设置 → 外观，看 Word 和 WPS 两行，点「重新连接」。另一个 LawMind 占着原端口时不改写清单。

然后**完全退出 Word 和 WPS 再打开**（侧载是启动时读的）。

**确认**：任务窗格能打开，输入框里点「开始」能建出请求。这一步在本机还没有验收记录。缺什么、还要提供什么，见 [LAWMIND-WORD-ADDIN.md](../LAWMIND-WORD-ADDIN.md) 的「现状：半成品」。

卡住的审查请求：服务在跑时，超过 30 分钟仍是 `running` 的会被标成 `failed`。窗口关着且守护进程也没起，就没有 tick，清理不会发生。先按 31.8 确认有一个 tick 主人，不要去手改 `word-addin/reviews.json`。

## 31.7 升级

1. 按 31.4 备份。
2. 装新版本（仍走原来的软件分发）。
3. 打开应用看体检：跑 `pnpm lawmind:doctor` 或看 `GET /api/health`——策略是否仍是 `policy.applied` 里的那些项；索引是否要重建。
4. 只有源码开发态出现大量 404 时才 `pnpm lawmind:bundle:desktop-server`，然后重启。安装包用户不要跑这条。
5. Word 连不上走 31.6。

## 31.8 关停与重启

退出应用。窗口开着时由桌面端负责 tick，并会停掉守护进程。关窗之后若还有定时自动办件，守护进程接手。

彻底停：

```bash
pnpm lawmind:daemon -- stop --workspace <工作区>
pnpm lawmind:daemon -- status --workspace <工作区>
```

不打开界面、只跑定时任务：

```bash
pnpm lawmind:daemon -- start --workspace <工作区>
```

守护进程是单实例。已经有一个在跑，后起的会让位。

## 31.9 「它不动了」

按这个顺序，停在第一处对得上的：

1. 应用窗口还在吗？不在就先打开。本地服务由桌面壳拉起，崩了会由监督进程再拉。
2. 设置 → 模型与连接里模型通不通（点「验证模型」）？不通就走该页的模型向导。终端里的 `pnpm lawmind:env:check` 只反映环境文件，不反映密钥链。
3. 「待我拍板」或「在办」里有没有等律师决定的项？等签批、等补充材料，看起来像卡住。
4. 关窗后的定时任务：守护进程在不在（31.8）。
5. 后台任务是不是还在 `running`（31.5）。

## 31.10 报问题

诊断包没有界面入口，用端点：`GET /api/support/bundle` 先预览将包含哪些文件，`GET /api/support/bundle?download=1` 下载 zip。包是脱敏的：不含案件正文、不含 `.env*`、不含许可激活码。发出去之前仍要自己看一眼。

配合 `pnpm lawmind:doctor` 的输出。只有支持方要追某一次交办时，才加 `GET /api/audit/export?taskId=<id>`。审计不记 query 和 body，不能用来还原「查了什么」。

## 31.11 只有义务或调查才碰的审计

没有留存义务时，到此为止。

要归档时见第 27.6 节：`GET /api/audit/export` 可加 `compliance=1` 或 `integrity=1`，摘要用 `GET /api/audit/export-summary?format=text`。外锚是 `LAWMIND_AUDIT_EXTERNAL_ANCHOR_URL`（`file://` 原子写，或 HTTPS PUT），也可以写在 `lawmind/desk-settings.json` 的 `auditExternalAnchorUrl`。大约每 24 小时推一次摘要；失败只警告，不影响写入。验外锚：`POST /api/audit/verify-external`。

不要删中间某一天的审计文件，哈希链会断。外锚地址不要写进 `lawmind.policy.json`，那个键会被忽略。

## 31.12 轮换密钥（有需要时，不是季检）

| 密钥                           | 怎么换                   | 换完会怎样                                                                                                                                   |
| ------------------------------ | ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| 模型 API Key                   | 设置里重存               | 新密钥进密钥链。环境文件里若还有明文，明文压过密钥链                                                                                         |
| `LAWMIND_AUDIT_CHAIN_KEY`      | 换环境变量或本机密钥文件 | 旧 HMAC 仍可用本机匹配过的密钥验。事件上是 `hashAlg` 与 `eventHash`。`legacy` 是写入时没有密钥才降级的 SHA-256；旧密钥全丢时 HMAC 段验签失败 |
| `LAWMIND_SKILL_SIGNING_SECRET` | 换完必须重签             | 见下方命令。不重签的自定义技能会变成 `enabled: false`，且不报错                                                                              |
| `LAWMIND_MAIL_SECRETS_KEY`     | 先把邮箱配置抄下来       | 旧密文解不开，系统又拒绝覆盖解不开的密文。换完删掉 `mail-secrets.json`，再重新配                                                             |
| 本机 API 安装密钥              | 不用手工轮换             | 桌面壳生成并注入。客户端凭据是派生的                                                                                                         |

技能重签：

```bash
export LAWMIND_SKILL_SIGNING_SECRET='<新密钥>'
pnpm lawmind:skills:sign --workspace <工作区>
pnpm lawmind:skills:sign --workspace <工作区> --check
```

`.env.lawmind` 必须在技能种子之前加载。否则签名用的是按路径派生的兜底密钥，验签用的是后来的密钥，技能会静默失效。

## 31.13 许可

设置里看许可状态，或 `GET /api/license`。激活：`POST /api/license/activate`，正文 `{ "code": "<激活码>" }`。机器指纹：`GET /api/license/fingerprint`。清除：`POST /api/license/clear`。

试用到期或未激活只提醒，不锁交办。`machine_mismatch` 表示激活码绑的不是这台机器。

私有化档的包装项在 `GET /api/health` 的 `doctor.privateDeployChecklist`。过了只说明包装项齐了，不是安全证明，也不代替金标。

## 31.14 不要做的事

- 不要把 `pnpm lawmind:ops export-dashboard` 或 `acceptance-pack` 列进月检。它们是实施存档，不证明稿子能用。
- 不要把 `pnpm lawmind:ops doctor --deep` 当每周任务。那是开发 smoke。
- 不要为了「防篡改」给每个客户开外锚。有合同义务再开。
- 不要手改 `reviews.json`、中间某天的审计文件、或解不开的 `mail-secrets.json` 以外的密文。
- 不要用审计保存期限代替质量复盘。
