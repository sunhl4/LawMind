# 附录 D 排障手册

这一章按症状组织：**看到什么 → 可能是什么 → 怎么查 → 怎么修**。

## D.0 先学会两件事

### 看健康数据

`GET /api/health`（或 `pnpm lawmind:doctor`；曾经的「设置 → 系统健康」页已撤）。里面的字段直接对应代码里的状态：

| 字段                       | 看什么                                               |
| -------------------------- | ---------------------------------------------------- |
| `doctor.process.degraded`  | 未捕获异常或未处理拒绝任一非零。界面上不显示这个键名 |
| `doctor.searchIndex`       | 索引是否陈旧（`staleReason`）                        |
| `doctor.authorityCorpus`   | 法源是 sample-ready 还是 configured                  |
| `doctor.rateLimit`         | 有没有被限流                                         |
| `doctor.matterConsistency` | 案件投影有没有漂移、当事人联系方式有没有冲突         |
| `policy.applied`           | 策略文件里哪几项真的生效了                           |
| `policy.rejected`          | 策略文件里哪些键被拒收（附原因）                     |
| `lawmindRouterMode`        | 指令路由走模型还是关键词（`model` / `keyword`）      |
| `envHint`                  | 环境文件的实际路径与是否存在                         |
| `edition.source`           | 版本是 policy 定的还是环境变量定的                   |

### 跑一次命令行体检

```bash
pnpm lawmind:doctor --json
pnpm lawmind:ops doctor --deep
```

`--json` 适合贴给支持人员。**注意两个脚本不通用**：`--json` / `--fix` 属于 `pnpm lawmind:doctor`；`--deep` 属于 **`pnpm lawmind:ops doctor`**（`lawmind-doctor.ts` 根本不认 `--deep`，写了也等于没写）。所以深度体检要敲 `pnpm lawmind:ops doctor --deep`。

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

然后重启桌面端。404 JSON 的 `hint` 是「退出 LawMind 后重新打开」；`pnpm lawmind:bundle:desktop-server` 写在服务端日志里，不在响应体里。

### 症状：升级后旧配置被拒 / 策略文件整份不生效

**查**：`GET /api/health` 的 `policy.applied`、`policy.rejected`、`policy.migrated`。

**原因**：

- `lawmind.policy.json` 必须带 `schemaVersion: 1`（不小于 1 的数字），否则整份不生效。
- 旧键改名会进 `policy.migrated`，不是被拒，但仍要按提示改名。
- 版本功能键（如 `citationGateStrict`、`auditIntegrityExport`）和引擎调参键（如 `retrievalMode`）会被逐条拒收，原因写在 `policy.rejected` 里。

**修**：把 `policy.rejected` 里的键删掉，或按第 30 章换成现行键名；以 `policy.applied` 为准确认哪些真的生效。**不要**为了「让旧文件过」去放宽校验——拒收是有意的前向兼容边界。

### 症状：把 5174 打开在浏览器里，一片空白

这不是故障。**5174 只是 Electron 渲染进程的来源**，不是可用的网页版工作台。请打开桌面窗口。

## D.2 模型与网络

### 症状：填了 API Key 但保存不了

**文案**：`无法安全保存。请在系统设置里打开钥匙串后再试。`

**原因**：`safeStorage.isEncryptionAvailable()` 返回假（Linux 上某些配置常见）。

**修**：启用系统密钥链，或者手工写 `.env.lawmind`。**不要**去改代码让它「能保存」——那会明文落盘。

### 症状：换了 API Key 但好像没生效

**查**：`GET /api/health` 的 `envHint.userDataEnvExists`。密钥链状态不在健康 JSON 里，走桌面端 IPC `window.lawmindDesktop.keychainStatus()`（设置页保存密钥时用的就是它）。

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
| 密钥失效              | 换密钥。探针里 401 与 403 共用「密钥无效或已过期」      |

### 症状：模型路由不走模型，仍按关键词分错类

**查**：`GET /api/health` 顶层的 `lawmindRouterMode`（`model` / `keyword`，不在 `doctor` 里）。聊天响应在 `includeTurnDiagnostics` 打开、或 firm / private_deploy 时也会带 `runtimeHints.lawmindRouterMode`。

**原因**：

- 不是「`LAWMIND_ROUTER_MODE` 没设」就关。缺省（或写 `model`）时，只要主模型有可用凭据就会尝试模型分类；只有显式写 `keyword` / `off` / `0` / `false` / `no` 才强制关键词。
- 路由模型没有可用凭据（`LAWMIND_ROUTER_BASE_URL` / `_API_KEY` / `_MODEL` 和回退的 `LAWMIND_AGENT_*` 都没配）→ 回退关键词。
- 即使 `lawmindRouterMode` 是 `model`，也只有引擎 `planAsync` 走 `routeAsync`。深度检索、交付管线、接诊门、引擎步骤工具仍然直接调同步关键词 `route()`——这些入口模型不参与，是当前实现边界，不是故障。

**修**：删掉 `LAWMIND_ROUTER_MODE=keyword`（或改成 `model`），配好主模型 key，确认 `lawmindRouterMode` 变成 `model`。对上面那几个入口不要期待模型路由。

### 症状：日志里有一堆 `model_error` 但界面看着正常

**原因**：`model_error` 会把这一回合标成 `error`，界面走错误气泡。它不是「回合还在正常进行」。

**查**：`model_error` 是**回合事件**（`turn-orchestrator-model-loop.ts`），不是审计事件。看会话 transcript，或 `GET /api/sessions/:id/live-turn` 的进度；`turn.error` 里留着原始报错。

### 症状：`/api/health` 里 `doctor.process.degraded` 是 true

**原因**：`uncaughtExceptions` 或 `unhandledRejections` **任一非零**——`degraded` 就是「两者之和不为零」。

两类信号的处理方式不同（写在 `lawmind-process-policy.ts` 的头注释里）：`unhandledRejection` 是**不退出只降级**——本服务有大量 best-effort 后台任务，孤立 rejection 多为单任务失败，可用性优先；`uncaughtException` 则是**干净退出**由监督层重启。两者都算进 `degraded`。

**查**：看服务日志里的 `[lawmind-local-server] unhandledRejection:`。

如果是 `uncaughtException`，进程会**退出**（`exit(1)`），由监督进程重启。新进程的 `uncaughtExceptions` 从 0 起，律师几乎看不到上一进程的计数。

## D.3 Word 插件

### 症状：窗格报「无法加载该加载项。请确保您具有网络和/或 Internet 连接。」

**这是最误导人的一个报错。** 它通常不是网络问题。

**第一步：看桌面服务日志里有没有 `[word-addin] GET /word-addin/taskpane.html …` 这一行。** 没有这行，说明 Word 的 webview 根本没来取页面（清单没读到，或 URL 方案不被接受）；有这行，说明页面确实被取走了，问题在页面里（CSP、Office.js、初始化超时）。日志同时打出 host、remote（ipv4/ipv6）和 UA——服务本来就同时监听 `127.0.0.1` 和 `::1`，别先去改主机名。

**第二步：看设置 → 外观里的 Word 和 WPS。** 若 Word 那行写着「请完全退出 Word 后再打开。」（WPS 同理），先完全退出对应软件再打开。LawMind 会在启动时按当前端口登记清单；另一个 LawMind 占着原端口时不改写，并显示「请改用已经打开的 LawMind。不要同时开两份。」

**修**：点「重新连接」，然后**完全退出 Word 或 WPS 再打开**。加载项仍是半成品，真机验收和还要提供的东西见 [LAWMIND-WORD-ADDIN.md](../LAWMIND-WORD-ADDIN.md) 开头。

### 症状：设置 → 外观里 Word/WPS 一直「请完全退出」或「请改用已经打开的 LawMind」

**看**：两行状态（`lm-doctor-addin-port-contract` / `lm-doctor-addin-wps`）。`reopen` 表示清单里记的端口和本机服务当前端口不一致（或刚重写过清单）；`another-copy` 表示另一个 LawMind 占着原端口。

**修**：点「重新连接」，再完全退出 Word/WPS 后打开。若提示「请改用已经打开的 LawMind」，先退出多余那一份——这份实例**不会**把清单改到自己端口上，点多少次「重新连接」都连不上。

**不要**手改端口号或 `manifest.xml` / `publish.xml`：端口由 `listen(0)` 决定，下次启动还会变；清单由主进程按实际端口重写，手改只会制造下一次漂移。

### 症状：窗格报 `unauthorized`

**原因**：窗格手里的凭据对不上当前服务：派生凭据改造前下发的旧令牌、`LAWMIND_LOCAL_API_EPOCH` 抬过代次，或该 `clientId` 被吊销。**重启本身不会**让派生凭据失效（安装密钥在钥匙串里，跨重启稳定）。

**修**：重开窗格让它重新取凭据（从同源 `config.js`）。如果还不行，看服务日志里的 `[word-addin] ...` 访问行——它会打出 host、remote（ipv4/ipv6）和 UA。

### 症状：点了「审这份」一直转圈

**查**：

1. 本机的服务是不是还活着（`GET /api/health`）。
2. `workspace/lawmind/word-addin/reviews.json` 里这条请求的状态。
3. 如果是 `running` 卡很久，30 分钟后会被如实标成 `failed`（孤儿清理）。
4. 如果状态是 `stale`，说明点击之后、取件之前文件被改过。用旧基线跑会出错，重新点一次「审这份」。

**常见真因**（代码注释里点名的）：**模型调用失败**（比如 key 失效 401）。因为引擎会把「本轮模型调用失败」当成一次成功的步骤结果，job 状态仍是 `completed`——所以窗格里的错误文案要写得具体，否则会把人往「降级导出」那个方向带偏。

### 症状：插件说「回桌面端看」

**原因**：这次改稿里有**整节重写**（锚点超过 60 字），插件不上这种改动。它们被记在 `skippedSectionHunks` 里。

**修**：回桌面端，在对话中栏的改稿台（`lm-middle-draft-desk`）处理那几处。

### 症状：Word 里落改之后文件没变

**查**：工作区 `cache/redline-manifests/.<taskId>.redline-manifest.json` 里的 `applyResult`。清单**刻意不写**在律师的案件夹或交付目录；只有没有工作区时（单测临时目录）才旁路到产物旁边。

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

**修**：看 `drafts/<taskId>.redline-plan.json` 的 `skipped` 数组。`reason` 是具体句子，例如「find 为空」「find 与 replace 相同」「正文中未找到 find 原文」「同一锚点命中 N 处」「请收窄到最短必要原文」。

### 症状：「原文中未找到 find 原文」

**原因**：模型给的 find 文本和实际正文对不上。

**修**：让它先 `analyze_document` 看清精确原文再改。落盘原因是「正文中未找到 find 原文（请用 analyze 可见的精确原文）」。

### 症状：改了正文之后红线全乱了

**原因**：hunk 的 `before` 是相对**基线**的，不是相对当前正文。手工改了正文，基线就对不上了。

**修**：用「重置基线」（`POST /api/drafts/:taskId/redline/baseline`）。

### 症状：导出后 Word 打不开或提示修复

**查**：`applyResult.applied` 和 `ambiguous`。如果 `rollbackFailed` 为真，产物可能不完整。

**修**：重新导出一次。优先用原件路径（有原合同那条路），别用无基线的渲染路径。

### 症状：导出没有生成修订轨

**原因**：可能落到了「普通渲染」那条路（`mode: "plain_fallback"`），或者 `baselineSource` 是 `rendered_draft` 而不是 `contract_file`。

**查**：结果对象里的 `mode` 和 `baselineSource` 字段。

### 症状：PDF 找不到预览 / 只看到前 80 页 / 没有「改稿」入口

**查**：

- 中栏 PDF 预览是 `PdfFileView`，字节走 `GET /api/fs/raw`。打不开时的文案是「本机服务未连接，打不开这份 PDF。」或「读不到这份 PDF（状态码）。」
- 超过 80 页只画前 80 页（`MAX_PREVIEW_PAGES = 80`）：顶栏显示「80 / 总页数」，底部写「只预览前 80 页。全文请用本机应用打开。」
- **PDF 不能直接进改稿台**。修订面接 `.docx`；`.doc` 会先提示你存成同名 `.docx`；PDF 只能预览、引用和用本机应用打开。
- 旧的 `GET /api/fs/pdf-preview` 已经没有任何调用方（桌面 PDF 预览在渲染进程用 pdf.js），不要拿它排障。

**修**：看全文用预览头的「用本机应用打开」；要改内容，先在 Word/WPS 里另存为 `.docx`，再从工作区打开。

## D.5 检索与法源

### 症状：查法条什么都查不到

**查**：`GET /api/health` 的 `doctor.authorityCorpus.status`。

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

**查**：`GET /api/health` 的 `doctor.scorecardRows` 里的「类案」行。

**原因**：本机没接类案库。系统**只探测本机**（不主动捅公网），要求回环端点能响应且不是 HTML 挑战页。

**修**：自建 cncases / caseopen 索引并指向本机端点，或者开 `LAWMIND_OPEN_LAW_COURTLISTENER=1`。

**注意**：没类案库时**不会编案号**，这是设计。

### 症状：搜不到工作区里的东西

**查**：`doctor.searchIndex.stale` 和 `staleReason`。

**修**：

桌面壳拉起的本机 API 已经注入 `LAWMIND_ALLOW_INDEX_REBUILD=1`，直接 `POST /api/search/workspace/rebuild`。独立拉起的服务才要自己设这个变量，否则 403。界面入口在设置 → 工作区的「查找」：只有索引未就绪或陈旧时才露出「重建查找」按钮。

陈旧原因是三种之一：`index_missing`、`last_rebuild_unknown`、`sources_changed`（源文件改过，检索时会按修改时间补进，不再按 24 小时整库重建）。

### 症状：材料检索能搜到但页码不对

材料的页码来自抽取时的定位（`page` 字段）。扫描件走 OCR 的条目页码可能不准。扫描件 OCR 最多 12 页，后面页没进文本。

### 症状：跨案先例库查不到

**原因**：默认关（伦理墙姿态）。

**修**：`LAWMIND_ALLOW_CROSS_MATTER_SEARCH=1`，然后**重建索引**（否则先例文档根本没入库）。

没开时工具也返回 `ok: true`、`hits` 为空、`precedentSearchEnabled: false`。那不是「开了也正常」。开了还是空，再查索引有没有重建。

## D.6 记忆与学习

### 症状：技能好像没生效

**查**：回合只读 `src/lawmind/skills/builtin/`。工作区 `SKILL.md` 和 `enabled.json` 不会让一份作业标准生效或失效。一次最多注入 2 份正文，其余要模型调用 `read_skill`。

签名失败只让工作区副本 `signatureOk: false`。交办用的作业标准不走那条路径，设 `LAWMIND_SKILL_SIGNING_SECRET` 修不了「回合里技能没生效」。

**修**：改 `src/lawmind/skills/builtin/` 里的原文，然后重启本地服务（打包版要重新打包）。本地服务启动**不会**再播种，重开设置页也不会。`pnpm lawmind:skills:sign --check` 只查工作区副本的签名，改不了回合里的作业标准。

### 症状：技能改了但行为没变

**原因**：你改的是工作区里那份（`workspace/lawmind/skills/<id>/SKILL.md`）。它是旧版播种产物，**回合根本不读**。

**修**：改仓库里的 `src/lawmind/skills/builtin/<id>.md`，重启本地服务。`ensureBuiltinSkillSeeds` 现在只在测试里用来对照副本，启动路径不再调用它。

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

### 症状：待发信一直没发出去

**这不是故障。** `send_email` 只把信写进本案「待发信」，回合照常结束，**不会真的发出**（它的 `requiresApproval` 是 false，正是为了不打断回合）。对话底部会出现「本案有 N 封待发出 · 核对后点批准才会寄出」的提示和「去批准发送」按钮。

**查 / 修**：

1. 打开工作台的待发列表（或案件页的待发信），核对收件人、正文、签名，点「批准发送」。
2. 批准后才会走 SMTP / Graph，并归档到 `cases/<matterId>/mail/sent/<id>.json`。
3. 没配邮箱时批准会失败：先看 `GET /api/mail/accounts`，在账号上点「测试」。
4. 没有任何自动外发通道；也不要指望 `notifyPolicy` 或自动化替你点「批准发送」。

## D.8 自动化

### 症状：自动化在「running」卡住不结束

**查**：`GET /api/automations/:id/runs` 和 `GET /api/jobs`。

**常见原因**：门禁停住了（比如独立审稿连续不过），而这一步**必须产生一个律师可见的待处置项**。看工作台案卷里的「待拍板」，或对话里最后一条助手下的「待您拍板」卡；也可以用命令面板 `/agents` 打开在办页。

**注意**：侧栏没有「待我拍板」这个按钮（e2e 也断言它不存在）。别照旧版截图找侧栏入口；审批面只有这三处：对话卡片、工作台待拍板、操作确认浮层。

**历史事故**：早先门禁停下后只在对话正文里留一句话，律师看不到，于是自动化反复重派同一份材料。现在有派发台账和待处置项。

### 症状：自动化失败但我没收到通知

**不应该发生。** 「失败与待拍板永不静默」是不可让的规则，与 `notifyPolicy` 无关。

**查**：`notifyEmail` 是不是空；以及自动化是否真的跑到了失败分支（看 runs 历史）。

### 症状：同一个附件被反复处理

**查**：派发台账（`automation-dispatch-ledger`）和门禁停事件。

**修**：确认门禁停时产生了待处置项（这是防重派的前提）。

### 症状：自动化开着但从不运行

**查三点**：

1. 确认填全了没。门禁看四个持久化字段：`expectedResult`、`approvalBoundary`、`missingDataPolicy`、`notifyPolicy`。缺了会被拒，返回的是 **API 错误码** `automation_confirmations_missing`（不是审计事件），并附 `missing` 列表。代码注释里的「六项」还把标题和计划算进去。
2. 守护进程在跑吗（应用关着时靠它）。
3. `nextRunAt` 是不是被推到很后面：领跑时会先推一小时；运行失败也会从 `now + 1h` 重算下一次。刚失败过的办件看起来「从不运行」是正常的。

**边界**：这道确认门只拦设置页的显式新建（`POST /api/automations`）。「说一句话就交办」走 `/api/automations/from-instruction`，不在这里设卡。

## D.9 协作

### 症状：邀请同事后他看不到案件

**查**：

1. 中继配置（共享目录或 HTTP 端点）两边一致吗。
2. 邀请码是否过期（14 天）。
3. 对方是否真的接受了邀请（`collab.invite_accepted` 事件）。
4. `matterReplicaCollab` 是否还开着（各版本默认开；`matterReplica.enabled: false` 会关掉）。

### 症状：材料同步报「完整性拒绝」

**事件**：`collab.integrity_rejected`。

**原因**：接收端重算哈希和清单里的不一致。可能的原因：中继被写入过、传输截断、或者对端版本不一致。

**修**：让对方重新发布这份材料。**不要**为了「让它同步成功」去掉哈希校验——那等于允许任何能写中继的人往卷宗里塞东西。

### 症状：两个人改了同一个文件，出现「（冲突）」文件

**这是设计。** 后写胜出 + 冲突旁车，两份字节都在磁盘上。材料是 `合同 (冲突).docx`（同名的递增到 `(冲突 2)`）；`CASE.md` 不覆盖本机文件，分歧摘录写到 `cases/<案>/CASE（冲突摘录）.md`。

**修**：人工对比两份，合一版，删掉旁车。

**不要**期待自动合并——"Not a CRDT" 是明确写在代码里的取舍。

### 症状：跨机器同步不工作

**跑探针**：

```bash
pnpm lawmind:matter-replica:probe --strict
```

它会建两个临时工作区加一个中继，跑十二项检查（X1–X12）。

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

**备份命令只打工作区**：

```bash
LAWMIND_WORKSPACE_DIR=<工作区> pnpm lawmind:backup <输出.tar.gz>
# 等价于
LAWMIND_WORKSPACE_DIR=<工作区> bash scripts/lawmind/lawmind-backup.sh <输出.tar.gz>
```

这个 tar **不含**应用根、钥匙串、`~/.lawmind/keys/`、`license.json`。默认也不含工作区根的 `.env.lawmind`；要连那份环境文件一起打进 tar，设 `LAWMIND_BACKUP_INCLUDE_ENV=1`。密钥和许可要另外拷。

### 症状：备份里没有 API Key

这是默认行为（防泄漏）。要连环境文件一起备，显式开开关。

### 症状：换了机器，密钥全没了

系统密钥链是**本机**的，不跟着目录走。新机器上要重新配 API Key、重新生成技能签名密钥。

**注意**：验签接受本机 env 密钥或 key 文件里任一匹配的密钥，所以换钥后旧 HMAC 事件仍可能验过。`legacy` 是**写入时没有密钥**才降级的纯 SHA-256，不是「找不到旧密钥就显示成 legacy」。旧 HMAC 在密钥全丢之后是验签失败。事件上是 `hashAlg` 与 `eventHash`，没有逐条 `hmacKeyId`。

## D.11 性能

### 症状：打开工作台很慢

**查**：案件数量和材料数量。律师桌「今日」走 `buildTodayWorkSnapshot`（同步、不扫审计）。案件工作台还会拉材料与概览，慢不一定只是这一函数。同一工作区同时最多 2 个工作流，其余排队。对话 JSON 超过 256KB 返回 413。

**注意**：材料列表**不算哈希**（有意的，为了让打开快）。案件副本发布时才算。

### 症状：一个回合跑很久

**查**：`GET /api/sessions/:id/live-turn` 看当前在做什么。

**常见原因**：

- 检索工具在空转（有专门的门禁，会在回执里给你「换个做法」的建议）。
- 工作流步骤多且串行。
- 模型本身慢。

### 症状：回合中途停下，说「步骤已经到上限」

**文案**：`这一轮的步骤已经到上限。已经做好的结果都还在，缺的事实留在文中待确认。`

**原因**：单回合工具迭代有硬顶 80（`DEFAULT_HARD_TOOL_CALL_CEILING = 80`）。`agentMaxToolCallsPerTurn` 和 `LAWMIND_AGENT_MAX_TOOL_CALLS` 都会被夹到 ≤80，**想调大调不动**；实际生效值看 `GET /api/health` 顶层的 `lawmindAgentMaxToolCalls`。另有检索/列表类单工具限额（`search_workspace` 3、`search_matter` 2、`read_project_file` 8、`analyze_document` 8）和总量 8–32（按上下文伸缩），那是另一道闸，见 38 章 Q33。

**修**：把这一轮拆成两轮（先检索/整理，再起草），或收窄任务。不要先怀疑「模型变笨」——先看是不是检索工具在空转。

### 症状：上下文压缩触发太早 / 太晚

**查**：`GET /api/sessions/:id/context-budget` 看用量分解（`estimateTokenBudgetBreakdown` 按桶拆）；输入栏的上下文用量面板也能手动「压缩」/「蒸馏」。

**默认触发线**（`src/lawmind/agent/context-tuning.ts` 的 `DEFAULT_CONTEXT_TUNING`）：

- 回合内压缩 `budget.midTurnCompactTriggerRatio = 0.9`；
- 提示水位 `budget.warnRatio = 0.85`（必须 ≤ 上面的触发线）；
- 预算预留 `summaryOutputTokenReserve = 20_000`、`autoCompactBufferTokens = 13_000`。

**按部署调**：写 `lawmind.policy.json` 的 `context.*`（优先），或整表 JSON 覆盖 `LAWMIND_CONTEXT_TUNING`。调低更容易压缩、摘要失真；调高更容易溢出丢回合。别把它当「让模型记住更多」的开关。

**另外**：历史质量带固定按 200K 管（`HISTORY_QUALITY_CONTEXT_TOKENS`），所以 500K / 1M 窗口也不等于历史能无限长。

**常见原因**：钉了很大的文件（pins 桶很大），或者工具结果很多（toolResults 桶大）。

## D.12 怎么收集诊断信息

三步：

1. **健康数据**：`pnpm lawmind:doctor --json`（或 `GET /api/health`）。
2. **诊断包**：`GET /api/support/bundle?download=1`（界面没有入口）。它是**脱敏 zip**，不含案件正文、不含 `.env*`、不含许可激活码。
3. **相关审计**：`GET /api/audit/export?taskId=<任务id>`。

三样加起来通常能定位大部分问题。

## D.13 一条通用建议

看到奇怪的报错，先去代码里搜那句文案。这个仓库的报错文案写得比较具体，而且**附近通常有一段注释解释了为什么会出这个错、以及以前的修法**。

举例：搜「无法加载该加载项」会把你带到 IPv6 监听那段注释；搜「Failed to fetch」会把你带到 CORS 那段；搜「已停止生成」会到 `turn-orchestrator.ts` 的中止分支（会议室那条 `lawmind-meeting-interrupt.ts` 是退役代码，别跟）。

这个方法在这个代码库特别有效，因为**注释里留着大量真实故障的记录**。
