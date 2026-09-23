# 附录 D 排障手册

这一章按症状组织：**看到什么 → 可能是什么 → 怎么查 → 怎么修**。

## D.0 先学会两件事

### 看体检页

设置 → 系统健康。里面的字段直接对应代码里的状态：

| 字段                           | 看什么                              |
| ------------------------------ | ----------------------------------- |
| `doctor.process.degraded`      | 有没有未处理的 Promise 拒绝         |
| `doctor.searchIndex`           | 索引是否陈旧（`staleReason`）       |
| `doctor.authorityCorpus`       | 法源是 sample-ready 还是 configured |
| `doctor.rateLimit`             | 有没有被限流                        |
| `doctor.saltmatterConsistency` | 案件投影有没有漂移                  |
| `policy.applied`               | 策略文件里哪几项真的生效了          |
| `envHint`                      | 环境文件的实际路径与是否存在        |
| `edition.source`               | 版本是 policy 定的还是环境变量定的  |

### 跑一次命令行体检

```bash
pnpm lawmind:doctor --json
pnpm lawmind:ops status --deep
```

`--json` 适合贴给支持人员。`ops status --deep` 会多查一些东西。

## D.1 启动类

### 症状：双击没反应 / 窗口一闪就没了

**查**：

```bash
pnpm lawmind:desktop            # 开发态启动，看终端报错
```

**常见原因**：

| 现象                        | 原因                             | 修法                    |
| --------------------------- | -------------------------------- | ----------------------- |
| 提示已有实例                | 单实例锁生效（同一用户数据目录） | 看 Dock，已有窗口在后台 |
| `[LawMind] startup failed:` | 启动异常                         | 看具体异常；会重试一次  |
| 白屏                        | CSP 或渲染层加载失败             | 看是否打包态产物缺失    |

关于「提示已有实例」：第二实例被拒时 Electron 会用它自己的 argv 触发 `second-instance` 事件，正常行为是把已有窗口叫到前台。如果窗口在后台没出现，看 Dock。

### 症状：开发态能跑，打包后白屏

**常见原因**：`dist/` 没构建，或 `server/dist/lawmind-local-server.cjs` 没打包。

**修**：

```bash
pnpm lawmind:bundle:desktop-server
pnpm lawmind:desktop:dist
```

### 症状：升级后大量 404

**原因**：本地服务还是旧的 bundle，新路由不存在。

**修**：

```bash
pnpm lawmind:bundle:desktop-server
```

然后重启桌面端。404 的响应里本身就带着这条提示（`no_route` 的 `hint`）。

### 症状：把 5174 打开在浏览器里，一片空白

这不是故障。**5174 只是 Electron 渲染进程的来源**，不是可用的网页版工作台。请打开桌面窗口。

## D.2 模型与网络

### 症状：填了 API Key 但保存不了

**文案**：`系统加密存储不可用，无法安全保存新的 API Key。请启用操作系统密钥链，或先在 .env.lawmind 中手工配置后重启。`

**原因**：`safeStorage.isEncryptionAvailable()` 返回假（Linux 上某些配置常见）。

**修**：启用系统密钥链，或者手工写 `.env.lawmind`。**不要**去改代码让它「能保存」——那会明文落盘。

### 症状：换了 API Key 但好像没生效

**查**：`envHint.userDataEnvExists` 和 `keychainStatus`。

**原因**：环境变量文件的优先级**高于**密钥链。如果旧明文还在 `.env.lawmind` 里，它会盖住密钥链里的新密钥。

**修**：正常流程下保存新密钥会自动抹掉旧的 8 个明文键（`WIZARD_ENV_SECRET_KEYS`）。如果手工改过环境文件，检查这几个键还在不在。

### 症状：模型报 502 / 连不通

**查**：

```bash
pnpm lawmind:env:check --strict
```

**常见原因**：

| 原因                  | 修法                                                    |
| --------------------- | ------------------------------------------------------- |
| Base URL 或模型名不对 | 改配置                                                  |
| 出口被网络白名单拦住  | 看 `policy.networkAllowlistEnforced`，把域名加进白名单  |
| 代理环境变量不对      | 检查 `HTTPS_PROXY` / `NO_PROXY`（注意只支持 http 代理） |
| 企业内网自签 CA       | 通过 `rootCerts` 注入                                   |
| 密钥失效              | 换密钥                                                  |

### 症状：日志里有一堆 `model_error` 但界面看着正常

**原因**：模型调用失败会落助手错误气泡，但回合不一定整体失败。

**查**：审计里搜 `model_error` 相关事件；或者看会话的 transcript。

### 症状：`/api/health` 里 `doctor.process.degraded` 是 true

**原因**：有过 `unhandledRejection`。**注意这是「不退出只降级」的那一类**——服务还活着，但有未处理的 Promise 拒绝。

**查**：看服务日志里的 `[lawmind-local-server] unhandledRejection:`。

如果是 `uncaughtException`，进程会**退出**（`exit(1)`），由监督进程重启，那个会记在 `doctor.process.uncaughtExceptions`。

## D.3 Word 插件

### 症状：窗格报「无法加载该加载项。请确保您具有网络和/或 Internet 连接。」

**这是最误导人的一个报错。** 它通常不是网络问题。

**第一步：确认用的是 `localhost` 而不是 `127.0.0.1` 取清单。** 服务同时绑了 IPv4 和 IPv6，但 WebKit 会先试 `::1`。

**第二步：看端口漂移。** 查 `lawmind:get-config` 的 `loopbackPortDrift`，或者体检页的端口漂移提示。如果端口变了，已侧载的清单指向旧端口，必然连不上。

**修**：用「设置 → 体检」里的「重新侧载 Word 清单」重新侧载，然后**完全退出 Word 再打开**（macOS 上侧载是启动时读的）。

### 症状：窗格报 `unauthorized`

**原因**：窗格持有的凭据是旧的（比如派生凭据改造之前的令牌，或者服务换了实例）。

**修**：重开窗格让它重新取凭据（从同源 `config.js`）。如果还不行，看服务日志里的 `[word-addin] ...` 访问行——它会打出 host、remote（ipv4/ipv6）和 UA。

### 症状：点了「审这份」一直转圈

**查**：

1. 本机的服务是不是还活着（`GET /api/health`）。
2. `workspace/lawmind/word-addin/reviews.json` 里这条请求的状态。
3. 如果是 `running` 卡很久，30 分钟后会被如实标成 `failed`（孤儿清理）。

**常见真因**（代码注释里点名的）：**模型调用失败**（比如 key 失效 401）。因为引擎会把「本轮模型调用失败」当成一次成功的步骤结果，job 状态仍是 `completed`——所以窗格里的错误文案要写得具体，否则会把人往「降级导出」那个方向带偏。

### 症状：插件说「回桌面端看」

**原因**：这次改稿里有**整节重写**（锚点超过 60 字），插件不上这种改动。它们被记在 `skippedSectionHunks` 里。

**修**：回桌面端改稿工作面处理那几处。

### 症状：Word 里落改之后文件没变

**查**：产物旁边有没有 `.<taskId>.redline-manifest.json`，里面有 `applyResult`。

**常见原因**：

| `applyResult`                             | 原因                                           |
| ----------------------------------------- | ---------------------------------------------- |
| `applied: 0`，`lastError` 里有 `io_error` | 工作副本是只读的（从 Finder 拷来的 0444 文件） |
| `ambiguous: N`                            | 有 N 处锚点找不到唯一位置，整处跳过了          |
| `rollbackFailed`                          | 回滚也失败，这次不算可交付                     |

只读文件的问题代码里有修（落改前 `chmod 0o644`），但如果环境特殊（比如目录权限不对），仍可能复现。

## D.4 改稿与导出

### 症状：导出时提示「尚无待叠加修订」

**文案**：`合同审阅稿尚无待叠加修订（redline hunks=N，至少需要 1）。…禁止仅写 summary 后空修订导出。`

**原因**：这是**空修订门**（`MIN_TRACKED_RENDER_HUNKS = 1`）在起作用。

**修**：先真的落下改动（`apply_surgical_edits`），再导出。不要绕过这个门。

### 症状：导出的 Word 里，改动处显示成整句删除加整句新增

**查**：看有没有 XML 复核警告（`xml_qa_non_minimal_edits`）。

**原因**：某些改动没被最小化。可能发生在：

- 历史遗留的 section 级 hunk（整节粒度）被直接用了。
- 落盘时歧义跳过，导致部分改动没落。

**修**：看 `drafts/<taskId>.redline-plan.json` 的 `skipped` 数组，那里会列原因（原文找不到 / 待收窄 / 碎片化）。

### 症状：「原文中未找到 find 原文」

**原因**：模型给的 find 文本和实际正文对不上。

**修**：让它先 `analyze_document` 看清精确原文再改。这句话本身就是报错文案的一部分。

### 症状：改了正文之后红线全乱了

**原因**：hunk 的 `before` 是相对**基线**的，不是相对当前正文。手工改了正文，基线就对不上了。

**修**：用「重置基线」（`POST /api/drafts/:taskId/redline/baseline`）。

### 症状：导出后 Word 打不开或提示修复

**查**：`applyResult.applied` 和 `ambiguous`。如果 `rollbackFailed` 为真，产物可能不完整。

**修**：重新导出一次。优先用原件路径（有原合同那条路），别用无基线的渲染路径。

### 症状：导出没有生成修订轨

**原因**：可能落到了「普通渲染」那条路（`mode: "plain_fallback"`），或者 `baselineSource` 是 `rendered_draft` 而不是 `contract_file`。

**查**：结果对象里的 `mode` 和 `baselineSource` 字段。

## D.5 检索与法源

### 症状：查法条什么都查不到

**查**：体检页的 `doctor.authorityCorpus.status`。

| 状态            | 含义             | 怎么办                                           |
| --------------- | ---------------- | ------------------------------------------------ |
| `sample-ready`  | 只有演示语料     | 正常，只能查到内置的那些。要更多得配语料或接端点 |
| `configured`    | 已加载外部语料   | 检查语料文件里有没有你要的法                     |
| `unset`         | 没配             | 配 `LAWMIND_AUTHORITY_ENDPOINT` 或语料路径       |
| `invalid`       | 配了但非法       | 看 URL 格式                                      |
| `unimplemented` | 占位（如 Lexis） | 换 provider                                      |

### 症状：结果里说「演示语料」

**这是正常的**。未标注来源的外部语料一律按演示处理（保守默认）。要让它不算演示，在语料记录里显式写 `demo: false`。

**不要**为了让水印消失而把标为演示的检查去掉。

### 症状：类案查不到

**查**：Doctor 里的「类案」行。

**原因**：本机没接类案库。系统**只探测本机**（不主动捅公网），要求回环端点能响应且不是 HTML 挑战页。

**修**：自建 cncases / caseopen 索引并指向本机端点，或者开 `LAWMIND_OPEN_LAW_COURTLISTENER=1`。

**注意**：没类案库时**不会编案号**，这是设计。

### 症状：搜不到工作区里的东西

**查**：`doctor.searchIndex.stale` 和 `staleReason`。

**修**：

```bash
# 需要开关
LAWMIND_ALLOW_INDEX_REBUILD=1
# 然后
POST /api/search/workspace/rebuild
```

陈旧原因是三种之一：`index_missing`、`last_rebuild_unknown`、`older_than_24h`。

### 症状：材料检索能搜到但页码不对

材料的页码来自抽取时的定位（`page` 字段）。扫描件走 OCR 的条目页码可能不准。这不是 bug，是 OCR 的固有不确定性。

### 症状：跨案先例库查不到

**原因**：默认关（伦理墙姿态）。

**修**：`LAWMIND_ALLOW_CROSS_MATTER_SEARCH=1`，然后**重建索引**（否则先例文档根本没入库）。

注意：开启后工具返回 `ok: true`（不是报错），只是找不到东西——因为它本来就没开。

## D.6 记忆与学习

### 症状：技能好像没生效

**查**：`GET /api/skills` 里那条技能的 `enabled` 和 `signatureOk`。

**原因**：签名失败是**静默的**——技能变成不可用，不报错。

**常见真因**：密钥来源是 `derived` 而不是真密钥；或者初始化顺序被改了（先解析密钥再加载环境变量）。

**修**：设 `LAWMIND_SKILL_SIGNING_SECRET`，重启。或者

```bash
pnpm lawmind:skills:sign --check
```

### 症状：技能改了但行为没变

**原因**：你改的是工作区里那份（`workspace/lawmind/skills/<id>/SKILL.md`），它是**播种产物**。

**修**：改仓库里的 `src/lawmind/skills/builtin/<id>.md`，然后重新播种（重开设置页会触发一次幂等播种）。

### 症状：改稿范例没进提示词

**查**：`edits/edit-examples.jsonl` 里有没有条目。

**常见原因**：

| 原因           | 说明                                         |
| -------------- | -------------------------------------------- |
| 改动小于 12 字 | `MIN_EXAMPLE_DELTA_CHARS = 12`               |
| 默认只取 2 条  | `DEFAULT_EXAMPLE_LIMIT = 2`，且每侧限 220 字 |

### 症状：模型好像「忘了」我的偏好

**查**：`GET /api/memory/sources` 里那一层的 `inAgentSystemPrompt`。

**记住**：加载了 ≠ 进提示词。`MEMORY.md`、`FIRM_PROFILE.md`、`CLAUSE_PLAYBOOK.md`、`MATTER_STRATEGY.md`、昨天的日志都是**加载但不整段进提示词**的。

**另外**：`LAWYER_PROFILE.md` 如果是**空模板**（没有填过的身份字段、也没有真的积累条目），是不会注入的。

### 症状：立场库里的东西没进提示词

**查门槛**（三个）：

1. 置信度衰减后是否 ≥ 0.4。
2. 证据是否跨了至少 2 个不同案件（同案证据豁免）。
3. 冲突检查是否通过（当前客户/对方曾在证据来源案件里出现过）。

跳过原因会写在 `selectInjectableStances` 的返回里。

### 症状：压缩之后模型忘了红线

**查**：压缩事件（`compact_boundary`）里有没有带重注信息。

**原因**：正常情况下压缩后会重注红线（`applyCompactReinjectionToSession`）。如果没重注，看是不是压缩发生在某个特殊分支里。

## D.7 案件与工作台

### 症状：工作台看不到刚在对话里说的事实

**原因**：这是「写了等于没写」那类问题。检查 `intake-brief.json` 和 `matter.json` 是否一致。

**修**：确认 `apply_intake_brief` 真的跑了写穿（`planIntakePromotion`），而不是只打了 `confirmedAt`。

### 症状：CASE.md 和 matter.json 不一致

**查**：

```bash
pnpm lawmind:ops matter-consistency
```

**修**：

```bash
pnpm lawmind:ops matter-repair-projection
# 或
POST /api/matters/repair-projections
```

**注意**：CASE.md 里的**叙事小节**（争点、风险、进展）**不镜像回 JSON**，所以它们不一致不算漂移。

### 症状：主体填不全，第 9 个当事人消失了

**原因**：历史上限是 8，会静默丢弃。现在上限是 32（`MATTER_PARTIES_CAP`）。

**修**：升级到含这个修复的版本。真要更多得改常量，别绕校验。

### 症状：期限不提醒

**查三点**：

1. 这条期限是不是**未释放**（有前置没完成）？未释放的不催办。
2. `remindBeforeHours` 是不是设得太大。
3. 守护进程在不在跑（关窗后靠守护进程 tick）。

**注意**：**开庭期限不参与释放判断**——开庭永远提醒。

### 症状：传票抽出来的日期不对

**原因**：抽取是**纯启发式**，而且**写进工作台之前要律师确认**。

**修**：在确认卡片上改掉。不要去改抽取器的置信度阈值来「让它别猜」——它本来就不写。

## D.8 自动化

### 症状：自动化在「running」卡住不结束

**查**：`GET /api/automations/:id/runs` 和 `GET /api/jobs`。

**常见原因**：门禁停住了（比如独立审稿连续不过），而这一步**必须产生一个律师可见的待处置项**。看「在办 / 待我拍板」里有没有。

**历史事故**：早先门禁停下后只在对话正文里留一句话，律师看不到，于是自动化反复重派同一份材料。现在有派发台账和待处置项。

### 症状：自动化失败但我没收到通知

**不应该发生。** 「失败与待拍板永不静默」是不可让的规则，与 `notifyPolicy` 无关。

**查**：`notifyEmail` 是不是空；以及自动化是否真的跑到了失败分支（看 runs 历史）。

### 症状：同一个附件被反复处理

**查**：派发台账（`automation-dispatch-ledger`）和门禁停事件。

**修**：确认门禁停时产生了待处置项（这是防重派的前提）。

### 症状：自动化开着但从不运行

**查三点**：

1. 六项确认填全了没（缺了会被拒，事件 `automation_confirmations_missing`）。
2. 守护进程在跑吗（应用关着时靠它）。
3. `nextRunAt` 是不是被推到很后面（抢占后会推一小时）。

## D.9 协作

### 症状：邀请同事后他看不到案件

**查**：

1. 中继配置（共享目录或 HTTP 端点）两边一致吗。
2. 邀请码是否过期（14 天）。
3. 对方是否真的接受了邀请（`collab.invite_accepted` 事件）。
4. `LAWMIND_EDITION` 是不是 firm 或已开 `matterReplicaCollab`。

### 症状：材料同步报「完整性拒绝」

**事件**：`collab.integrity_rejected`。

**原因**：接收端重算哈希和清单里的不一致。可能的原因：中继被写入过、传输截断、或者对端版本不一致。

**修**：让对方重新发布这份材料。**不要**为了「让它同步成功」去掉哈希校验——那等于允许任何能写中继的人往卷宗里塞东西。

### 症状：两个人改了同一个文件，出现「（冲突）」文件

**这是设计。** 后写胜出 + 冲突旁车，两份字节都在磁盘上。

**修**：人工对比两份，合一版，删掉旁车。

**不要**期待自动合并——"Not a CRDT" 是明确写在代码里的取舍。

### 症状：跨机器同步不工作

**跑探针**：

```bash
pnpm lawmind:matter-replica:probe --strict
```

它会建两个临时工作区加一个中继，跑十项检查（X1–X10）。

## D.10 数据与备份

### 症状：担心数据丢

**真相源清单**（这些是必须备份的）：

| 类别       | 位置                                                                                             |
| ---------- | ------------------------------------------------------------------------------------------------ |
| 工作区全部 | `<工作区>/`（重点是 `matters/`、`cases/`、`drafts/`、`sessions/`、`tasks/`、`*.md`、`lawmind/`） |
| 应用根     | `<用户数据目录>/LawMind/`（`assistants.json`、`assistants/`、`desktop-config.json`）             |
| 密钥       | 系统密钥链 + `~/.lawmind/keys/`                                                                  |
| 许可       | `~/.lawmind/license.json`                                                                        |

**派生数据不用备**：`lawmind/search-index.sqlite`、`quality/`（可从事件重算）。

**备份命令**：

```bash
LAWMIND_WORKSPACE_DIR=<工作区> pnpm lawmind:backup <输出.tar.gz>
```

默认**不含** `.env.lawmind`。要含得设 `LAWMIND_BACKUP_INCLUDE_ENV=1`。

### 症状：备份里没有 API Key

这是默认行为（防泄漏）。要连环境文件一起备，显式开开关。

### 症状：换了机器，密钥全没了

系统密钥链是**本机**的，不跟着目录走。新机器上要重新配 API Key、重新生成技能签名密钥。

**注意**：审计链密钥换了之后，**旧的链仍能验**（密钥解析接受本机的任一把匹配密钥），但新写的事件会带新的 `hmacKeyId`。如果完全找不到旧密钥，那段会显示成 `legacy` 或验签失败。

## D.11 性能

### 症状：打开工作台很慢

**查**：案件数量和材料数量。打开工作台走的是 `buildTodayWorkSnapshot`（同步、不扫审计），但案件多时列表渲染仍可能慢。

**注意**：材料列表**不算哈希**（有意的，为了让打开快）。案件副本发布时才算。

### 症状：一个回合跑很久

**查**：`GET /api/sessions/:id/live-turn` 看当前在做什么。

**常见原因**：

- 检索工具在空转（有专门的门禁，会在回执里给你「换个做法」的建议）。
- 工作流步骤多且串行。
- 模型本身慢。

### 症状：上下文很快就被压缩

**查**：`GET /api/sessions/:id/context-budget` 看用量分解（`estimateTokenBudgetBreakdown` 按桶拆）。

**常见原因**：钉了很大的文件（pins 桶很大），或者工具结果很多（toolResults 桶大）。

## D.12 怎么收集诊断信息

三步：

1. **体检页**截图（或 `pnpm lawmind:doctor --json`）。
2. **诊断包**：设置 → 系统健康 → 支持诊断包（`GET /api/support/bundle?download=1`）。它是**脱敏 zip**，不含案件正文、不含 `.env*`、不含许可激活码。
3. **相关审计**：`GET /api/audit/export?taskId=<任务id>`。

三样加起来通常能定位大部分问题。

## D.13 一条通用建议

看到奇怪的报错，先去代码里搜那句文案。这个仓库的报错文案写得比较具体，而且**附近通常有一段注释解释了为什么会出这个错、以及以前的修法**。

举例：搜「无法加载该加载项」会把你带到 IPv6 监听那段注释；搜「Failed to fetch」会把你带到 CORS 那段；搜「已停止生成」会到会议室打断逻辑。

这个方法在这个代码库特别有效，因为**注释里留着大量真实故障的记录**。
