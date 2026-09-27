# 第 10 章 检索与法源

这一章讲「系统从哪找资料」，以及它找不到的时候怎么办。后半句比前半句重要。

## 10.1 定位：检索的第一原则是不编

法律工作的引用必须能回溯到来源。模型脑子里记着的法条经常是错的、过期的、或者根本不存在的——这不是模型「不够聪明」，而是它的工作方式就是这样。

所以 LawMind 的检索层有一条贯穿全层的约束，写在 `src/lawmind/retrieval/index.ts` 的头部：

```text
- 所有结论必须有 sourceIds，无来源的不得放入 claims
- riskFlags 不得省略
- 模型无法确认的事项放入 missingItems
```

「无来源不得放入 claims」这半句是硬的。合并阶段有两道降级，都会把结论从列表里拿掉，改成风险标记：

```text
结论引用缺失来源，已降级处理：…
结论所写条号未出现在引用来源，已降级：…
```

第一道对的是来源 id。第二道对的是正文里写出的「第 N 条」：先把中文数字和阿拉伯数字收成同一个条号，再和所引来源的标题、引用、摘录、案号或 URL 比对。因此「第五百七十七条」和「第577条」算同一条，「第五条」不会因为包含关系误配「第五十条」。没写条号的转述保留。

## 10.2 数据契约

检索的产出是一个 `ResearchBundle`：

```ts
type ResearchBundle = {
  taskId: string;
  query: string;
  sources: ResearchSource[];
  claims: ResearchClaim[];
  riskFlags: string[];
  missingItems: string[];
  requiresReview: boolean;
  completedAt: string;
};
```

来源（`ResearchSource`）带这些字段：`id`、`title`、`kind`、`citation?`、`url?`、`date?`、`court?`、`caseNumber?`，以及三个和「诚实」直接相关的：

| 字段          | 含义                                                                          |
| ------------- | ----------------------------------------------------------------------------- |
| `demo`        | 命中来自内置演示语料，或标注为 demo 的 CORPUS                                 |
| `provider`    | 来源标识，比如 `open-law.local`、`open-law.npc_flk`（**注意：不是「法宝」**） |
| `corpusId`    | 语料库标识，比如 `bundled_sample`、`npc_flk_live`                             |
| `licenseNote` | 许可说明                                                                      |

`demo` 这个字段的解释（注释原话）：

> True when hit came from open-law bundled sample or CORPUS marked demo. Acceptance/chat should surface「演示语料」— not a verified commercial statute.

来源类型（`SourceKind`）八种：`statute`、`regulation`、`case`、`memo`、`contract`、`web`、`workspace`、`unknown`。

结论（`ResearchClaim`）有五个字段：`text`、`sourceIds`、`confidence`、`model`（`general` 或 `legal`），以及一个可选的 `demo`（标记这条结论来自演示语料）。注意 `sourceIds` 是**数组且有来源**，这是上面那条约束的落地形式。

## 10.3 适配器机制

检索不是一个函数，是一串适配器（`RetrievalAdapter`），每个适配器声明「我支持哪类任务」：

```ts
type RetrievalAdapter = {
  name: string;
  supports: (intent: TaskIntent) => boolean;
  retrieve: (params: {...}) => Promise<RetrievalResult>;
};
```

合并规则（`retrieve()`）：

1. 先按 `supports(intent)` 过滤。**一个都不剩就直接报「没有可用的检索适配器，请手动补充资料。」**
2. 用 `Promise.allSettled` **并行**跑，全部等完。
3. 成功的拼在一起；失败的转成风险标记 `检索适配器异常：<原因>`。单个适配器超过 20 秒记为超时，不拖住其余来源。
4. 按 `id` 去重。同一 id 保留非演示、引用更完整的那条，直播覆盖 sample。
5. 检查结论的来源 id，以及正文条号是否落在所引来源上；对不上就降级（见 10.1）。
6. 算 `requiresReview`：高风险任务、有 missing、或者有 riskFlags，都为真。

工作区适配器（`createWorkspaceAdapter`）永远返回支持，它读案件档案（`cases/<matterId>/CASE.md`，标为 `memo`）和客户档案（`CLIENT_PROFILE.md`，标为 `workspace`）。

## 10.4 法源路由：一个环境变量切四家

法源走 `createAuthorityAdapterFromEnv`。路由键是 `LAWMIND_AUTHORITY_PROVIDER`，四个取值：

| 值                 | 含义                                                                          |
| ------------------ | ----------------------------------------------------------------------------- |
| `open`（**默认**） | 本地开源语料（可选 NPC / caseopen / CourtListener / EUR-Lex / e-Gov JP 直播） |
| `generic`          | 通用 HTTP（`?q=` → `hits` 或 `items`）                                        |
| `pkulaw`           | 北大法宝（闭源，手动接入）                                                    |
| `lexis`            | LexisNexis（闭源，占位）                                                      |

别名挺多，认起来方便：`pku` 和「法宝」都指向 `pkulaw`；`npc`、`flk`、`opensource`、`open-law` 都指向 `open`。

**未知取值一律回落到 `open`**，同时写入风险标记「法源提供方「…」无法识别，已退回开源语料，未连接商业库。」空值仍是默认 open，不算配错。注释解释了为什么退回而不是连商业库：

> Unknown → open (fail-closed local corpus) rather than commercial

`supports` 的判定是：任务种类是 `research.legal` 或 `research.hybrid`，或者指令里出现「法条」「法规」「民法典」「司法解释」「判例」「权威」这些词。

`lexis` 是**失败关闭**的：直接返回风险标记「Lexis 适配器未实现（闭源占位）」。它不假装能用。

## 10.5 open-law 的五条车道

`open` 是最复杂的一条路，内部有五种数据源：

| 车道                          | 默认端点                                            | 默认开吗                                    |
| ----------------------------- | --------------------------------------------------- | ------------------------------------------- |
| NPC FLK（国家法律法规数据库） | `https://flk.npc.gov.cn/law-search/search/list`     | **默认开**（`LAWMIND_OPEN_LAW_NPC=0` 才关） |
| caseopen（自建类案）          | `http://127.0.0.1:8081/api/search`                  | 显式开                                      |
| CourtListener（美国判例）     | `https://www.courtlistener.com/api/rest/v4/search/` | 显式开                                      |
| EUR-Lex                       | `https://publications.europa.eu/webapi/rdf/sparql`  | 显式开                                      |
| e-Gov JP（日本法令）          | `https://laws.e-gov.go.jp/api/2/keyword`            | 显式开                                      |

模式用 `LAWMIND_OPEN_LAW_MODE` 指定：`local`（只有本地语料）、`npc_flk`、`caseopen`、`courtlistener`、`eurlex`、`egov_jp`、`hybrid`。不指定时的默认逻辑是：**任何一个直播车道开着就是 `hybrid`，否则 `local`**。

hybrid 把已启用的直播车道**并列**查询。优先级仍是 NPC → caseopen → CourtListener → EUR-Lex → e-Gov JP，用来决定主来源标签；有命中的车道合并进同一包（最多 24 条），不再第一家有结果就停。本地 sample 只在全部直播都空时兜底，避免演示语料盖住官方法条。

### NPC 的三条实做细节

NPC 是默认开的，所以它的细节最值得知道：

- **节流**：最小请求间隔 1500ms（`NPC_FLK_MIN_INTERVAL_MS`），缓存 5 分钟（`NPC_FLK_CACHE_TTL_MS`）。这是不给人家站点添麻烦。
- **请求体固定**：`{ searchContent, searchType: 2, searchRange: 1, pageNum: 1, pageSize: 10, sxrq: [], gbrq: [], sxx: [], gbrqYear: [], flfgCodeId: [], zdjgCodeId: [], xgzlSearch: false }`，超时 10 秒。
- **要装成浏览器**：注释写着「WAF on flk.npc.gov.cn often 403s non-browser UAs; match public site clients.」所以请求头带了 `referer`、`origin`、`x-requested-with: XMLHttpRequest` 和一个 Firefox UA。站点从老的 GET `/api/` 改成了 POST `/law-search/search/list`，旧路径会返回 HTML，这时报 `npc_html_shell:旧 /api/ 或端点已改为 SPA；请使用 /law-search/search/list`，然后**如实地回落到本地 sample 并标注**。

### 诚实边界（原文）

open-law 的 README 里有一段写得很直白，我原文引用：

> **诚实边界**：内置 sample 仅演示检索与 citation 管线，**不是**完整中国法库。无命中仍拒答/缺源；正式引用须核对官方法条（如 flk.npc.gov.cn）。直播/外部 dump **不会**伪装成法宝。

「不会伪装成法宝」这句是有针对性的：有些人会拿开放 dump 当商业法源卖，LawMind 明确不干这件事。

README 里还明确了两件事：一是**不提交大型二进制 / 百 MB dump**（怕污染仓库）；二是 `api.case.law` 的直播 API 已于 2024 停用，检索并入 CourtListener。

### sample、CORPUS、live 三者的关系

- **sample**：随包内置的一小组法条（`sample-statutes.embedded.ts`），只够演示管线。
- **CORPUS**：你自己用 `LAWMIND_OPEN_LAW_CORPUS` 指一个 JSONL 文件。同 id 时**外部 CORPUS 覆盖 sample**。
- **live**：前面那五条车道。

CORPUS 的格式是 JSONL（一行一个 JSON），如果文件以 `[` 开头也认 JSON 数组；`#` 和 `//` 开头的行跳过。

### demo 水印规则（这条很关键）

什么算「演示语料」有四条规则：

1. 来自内置 sample → 是演示。
2. `LAWMIND_OPEN_LAW_CORPUS_DEMO=1` → 整个 store 都是演示。
3. 记录里标了 `demo: true` 或标签带 `demo` → 是演示。
4. **未标注的外部 CORPUS 一律按演示处理**（注释：「保守默认（N-A4）：未标注的外部 CORPUS 一律按演示语料处理——许可与核验状态不明，不应被当作正式权威直接用于成稿。」）

第 4 条是「疑罪从有」的做法：不确定来源的合法性，就先当演示。只有显式写 `demo: false` 才不算演示。

演示命中会被打上固定的风险标记：

```ts
DEMO_CORPUS_RISK_FLAG = "演示语料（非正式完整法库；正式引用请核对官方法条）";
```

系统提示里也有一条对应的纪律（`system-prompt.ts`）：

> `search_statute` / `search_case_law` 可先查 NPC；未命中时可能回退到**演示语料**——演示命中必须标成演示，不得写成已核实权威库。

### 转 dump 的工具

如果你手上有法规 dump，`open-law-corpus-convert.ts` 能转成 CORPUS 格式，支持三种源格式：`flk_json`、`article_line`、`hf_china_laws`。

其中「一行一条」的格式很好用，正则长这样：

```text
^[《「]([^》」]+)[》」]\s*(第[零〇一二三四五六七八九十百千0-9]+条)\s*规定[，,：:]\s*(.+)$
```

也就是「《民法典》第一千零七条 规定：……」这种一行一条的写法。

CLI 入口：`pnpm lawmind:open-law:convert`，参数 `--in/--out/--format/--limit/--demo`。

### 法源状态的口径

`GET /api/health` 会带上法源状态（`doctor.authorityCorpus`；原 Doctor 页已撤），四个值：

| 状态            | 含义                                      |
| --------------- | ----------------------------------------- |
| `sample-ready`  | 只有内置演示 sample（非正式完整法库）     |
| `configured`    | 已加载外部 CORPUS（仍不等于「已接法宝」） |
| `unset`         | 没配端点                                  |
| `invalid`       | 配了但非法                                |
| `unimplemented` | 占位（比如 Lexis）                        |

`configured` 的说明里特意加了「仍不等于「已接法宝」」。这条注释防的是把「我配了个语料库」说成「我接了商业法源」。

## 10.6 商业法源

### 北大法宝（pkulaw）

BYOK 模式（自带密钥），三种协议（`LAWMIND_PKULAW_MODE`，默认 `rest_compat`）：

| 模式             | 形式                                                                                                                                              |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `rest_compat`    | `GET <endpoint>?q=<query>&type=<law\|case>`                                                                                                       |
| `search_post`    | POST `{ query, searchType, q, text }`                                                                                                             |
| `mcp_tools_call` | JSON-RPC `tools/call`，工具名由 `LAWMIND_PKULAW_MCP_LAW_TOOL`（默认 `search_article`）和 `LAWMIND_PKULAW_MCP_CASE_TOOL`（默认 `search_case`）指定 |

有一条细节写在注释里：官方的 MCP 工具**拒绝未知字段**（传 `query`/`q` 会直接 `isError`）。所以 `buildPkulawMcpArguments` 只发 `{ text, size: 10 }`。

按「案例 / 判例 / 判决 / 案号 / 类案」这类词判断是查法规还是查案例（`inferPkulawSearchKind`）。注释还提了一句：「Avoid `\b` — unreliable for CJK.」——中文字符边界不能用 `\b`。

### 引用核验

`citation-validate.ts` 是个可选功能（`LAWMIND_AUTHORITY_CITATION_VALIDATE=1`），把引用列表 POST 到 `<endpoint>/validate`，拿回 `{ ok, issues[] }`。

跳过的条件是：pkulaw + `mcp_tools_call` 模式 + 没有独立路径。原因是官方 MCP 没有这个接口，此时提示要用 `adjust_provisions`。

### 通用 HTTP

`generic` 期望的响应体是 `{hits: [...]}` 或 `{items: [...]}`，超时 12 秒。

## 10.7 安全加固：四条防线

法源要访问外网，这里有一组安全措施。

### 第一道：URL 黑名单（`authority-url-guard.ts`）

拒绝的**主机名**：`localhost`、`metadata`、`metadata.google.internal`、`metadata.goog`、`metadata.aws.internal`，以及所有 `.localhost` / `.local` 结尾的。缩写 IP（`127.1`、`127.0.1`）、前导零或超长八位组（`0177.0.0.1`）、纯十进制长数字和 `0x` 混淆写法一并拒绝。

拒绝的**IP 段**：

| 段                             | 说明                                 |
| ------------------------------ | ------------------------------------ |
| `0.0.0.0/8`                    | 本网络                               |
| `127.0.0.0/8`                  | 回环                                 |
| `10.0.0.0/8`                   | 私有                                 |
| `100.64.0.0/10`                | CGNAT                                |
| `172.16.0.0/12`                | 私有                                 |
| `192.168.0.0/16`               | 私有                                 |
| `169.254.0.0/16`               | 链路本地（**云元数据服务就在这里**） |
| `::1`、`fe80::/10`、`fc00::/7` | IPv6 回环、链路本地、唯一本地        |

`169.254.169.254` 是云厂商的元数据服务地址，能读到实例凭证。这类地址必须拒。

### 第二道：DNS 钉扎（`authority-pinned-fetch.ts`）

这一道防的是 TOCTOU（检查与使用之间的时间差）：你检查域名时它解析到公网 IP，实际连接时 DNS 被换成了内网 IP。

做法是用 Node 的 `http(s).Agent` 自定义 `lookup`，**把连接锁死在已校验的那个 IP 上**，同时 TLS 仍按原主机名校验证书。

响应体上限 8MB（`DEFAULT_MAX_AUTHORITY_RESPONSE_BYTES`），超了报 `authority_response_too_large:>...`。

注释说明适用范围：「仅用于**商业权威端点**（pkulaw/generic/LexEdge）——这些端点禁止 loopback/私网。」本机回环的端点（比如自建 caseopen）不需要钉扎。

### 第三道：用量计量（`authority-usage.ts`）

记每天调了多少次、成功几次、失败几次，存在 `workspace/ops/authority-usage.json`，只留最近 14 天。

**只记次数，不记查询正文、不记密钥。** 给律师看的文案是：

```text
今日权威调用 N 次（成功 X / 失败 Y）。不含查询正文。
```

### 第四道：来源层级（`authority-source-tier.ts`）

三层：`sample`、`corpus`、`live`。判 `live` 的条件是「状态是 `configured` 且 provider 不是 `open`」。

这层用来给成稿做「来源够不够硬」的判断。工作区启发式的来源固定算 `sample`（`WORKSPACE_HEURISTIC_SOURCE_TIER`）——也就是工作区里自己的文件不算权威来源。

## 10.8 类案就绪：探测器与诚实降级

`case-law-readiness.ts` 干一件事：看本机有没有能查的类案库。

**只探测本机**（回环地址），注释写明「不主动捅公网」。做法是 GET `<endpoint>?search=probe`，超时 1500ms，判据是：

> 任何 HTTP 响应（哪怕 4xx）都说明索引进程在跑；HTML 挑战页不算。

也就是说，响应内容类型带 `text/html` 就当作没就绪（可能是 Cloudflare 挑战页）。探测结果缓存 10 分钟（`CASE_LAW_PROBE_TTL_MS`），探测失败不抛错，因为「类案不可用是可降级的正常状态」。

两个源：

| id              | 名称                                         |
| --------------- | -------------------------------------------- |
| `caseopen`      | cncases / caseopen 裁判文书检索（本地自建）  |
| `courtlistener` | CourtListener / Free Law Project（美国判例） |

没接的时候，给律师的说明是（原文）：

```text
本机未接类案库。要查真实类案：自建 cncases 索引（本机可达即自动启用），或
LAWMIND_OPEN_LAW_COURTLISTENER=1 直连美国判例。在此之前，检索只能给工作区线索，
引擎不会编造案号或裁判要旨。
```

最后一句是重点。**没有类案库，就不能编案号。** 头部的设计原则也写着「诚实降级：都不就绪时明确说「未接类案库」，并给出可操作的启用路径，不编造案号/裁判要旨」。

## 10.9 先例库与伦理墙

`search_precedents` 工具查的是**本所旧案已签批的交付物**——注意是「已签批」，没签批的稿子不能当先例。

但这条功能**默认关闭**，开关是：

```ts
/** Cross-matter precedent ingestion is opt-in (ethical-wall posture by default). */
export function isPrecedentIngestEnabled(): boolean {
  return process.env.LAWMIND_ALLOW_CROSS_MATTER_SEARCH === "1";
}
```

注释解释了为什么默认关：「Cross-matter precedent ingestion is opt-in (ethical-wall posture by default).」跨案件读取涉及伦理墙，默认不开放。

关闭时，工具**不报错**，而是返回 `ok: true` 加一句说明：

```text
先例检索未开启：跨案读取需律师显式授权（LAWMIND_ALLOW_CROSS_MATTER_SEARCH=1）。
开启并重建索引后可用。
```

返回 `ok: true` 而不是报错，是因为「没开这个功能」不是失败。这一点和「查了但查不到」在语义上要分开。

工具还有一条纪律（注释）：「命中只作写法/口径参照——事实以本案为准，不得张冠李戴。」

工具支持三个参数：`query`、`limit`（默认 8，最大 20）、`target_task_id`、`term_map`（术语映射，配合术语自适应用）。

## 10.10 索引用的是 FTS5，不是向量

这点值得单独说，因为很多同类产品默认用向量库。

LawMind 的索引是 SQLite 的 **FTS5 全文检索**，位置 `<工作区>/lawmind/search-index.sqlite`，schema 版本 3（加材料表时升过一次）。

四张表：

| 表              | 分词器      | 内容                                                                         |
| --------------- | ----------- | ---------------------------------------------------------------------------- |
| `audit_fts`     | `unicode61` | 审计事件                                                                     |
| `session_fts`   | `unicode61` | 会话消息                                                                     |
| `knowledge_fts` | `trigram`   | 个人知识（案件、策略、会话摘要、记忆、日志、档案、playbook、黄金样本、先例） |
| `materials_fts` | `trigram`   | 案件材料（带页码）                                                           |

中文用 `trigram`（三元组）分词——这是 SQLite FTS5 处理中文的常规做法，不需要额外分词库。

### 为什么不用向量

`indexing/embeddings/index.ts` 默认**关闭**，注释写得很清楚：

> Default: disabled. When `LAWMIND_EMBEDDING_ENABLED=1`, uses a deterministic local hash-embedding stub suitable for tests / offline smoke — **NOT a production semantic model.**

也就是说，即使打开，也只是个哈希桩，不是真的语义模型。这是有意留的口子：将来可以换 bge-m3 或 onnx runtime，但现在不假装有语义检索能力。

打开时的参数：`LAWMIND_EMBEDDING_MODEL`（默认 `local-hash-stub-v1`）、`LAWMIND_EMBEDDING_DIMS`（默认 64，上限 1024）。

### 个人知识检索的权重

`searchPersonalKnowledge` 是「混合轻量检索」，打分方式是 `bm25 × 0.55 + 词面重叠 × 2.2`，再加一点类型加成。摘录对齐命中词，而不是永远截正文开头：

| 类型     | 加成     |
| -------- | -------- |
| 案件档案 | 1.35     |
| 策略     | 1.25     |
| 先例     | 1.22     |
| 黄金样本 | 1.2      |
| playbook | 1.15     |
| 会话摘要 | 1.1      |
| 个人档案 | 1.05     |
| 通用记忆 | 1.0      |
| 每日日志 | **0.35** |

每日日志被压到 0.35 是有道理的：日志里噪音最多，不该跟案件档案同等对待。

还有一层：命中「争点」「风险」「策略」「条款」这几个小节的话再乘 1.15——因为这些小节的内容密度更高。

### 材料检索能定位到页

`searchMaterials` 返回的命中带 `{matterId, relPath, fileName, page, snippet, score}`，**有页码**。

材料入库的限制：单文件 20MB（`MAX_FILE_BYTES`）、单文档正文 60000 字（`MAX_BODY_CHARS`）、分块 1800 字（`CHUNK_CHARS`）、最多 6 万行（`DEFAULT_MAX_ROWS`）。支持 txt/md/csv/log、docx、二进制 doc、pdf、xlsx/xls。

有一条很实在的限制：**图片不做批量 OCR**（注释：「Images are not bulk-OCR'd.」）。图片 OCR 走的是审查表抽取那条按需的路径，不是预先全库 OCR。

### 索引新鲜度

陈旧不再看 24 小时。三个原因：索引不存在、上次同步时间未知、源文件的修改时间或大小和索引戳不一致（`sources_changed`）。检索时会只补改过的文件。

重建入口是 `POST /api/search/workspace/rebuild`，但它**有开关**：需要 `LAWMIND_ALLOW_INDEX_REBUILD=1`，否则返回 403 `index_rebuild_disabled`。默认关的理由和服务端一致：重建索引是重活，不该随手触发。

## 10.11 深度研究协议

`research/` 目录是「认真做检索」的那条路，和随手 `search_statute` 不是一回事。

### 为什么要有协议

问题是这样：模型可以在没检索的情况下，凭记忆写「根据《民法典》第五百七十七条……」。这类引用看着很专业，实际可能是错的。

所以 `research-protocol.ts` 干一件事：**写条号之前先试检**。它注入的提示块有两条纪律：

```text
无命中：栏目保留并标【待核实】，不得把模型记忆写成条号。
```

以及 `formatUnretrievedStatuteBody()` 返回的整段：

```text
本回合尚未试检 search_statute / search_case_law。不得把模型记忆写成现行法条。
先检索；无工具或仅演示语料则标【待核实】并继续分析框架，不得写成已核对。
```

注意最后半句：「继续分析框架」——没有检索不等于不干活，只是引用要标「待核实」。

它**跳过的场景**只有一类：纯意见书的快速通道（`isOpinionOnlyFastLane`）。注释：「Skip only the 5-minute opinion fast lane」。其余情况（包括邮件和 Word 改稿）不冻结检索：

> Mail/Word may still search; do not freeze them off retrieval.

适用于六种管线：`research.memo`、`analysis.quick`、`contract.review`、`letter.draft`、`litigation.draft`、`mail.contract`。

### 深度研究的执行链

`executeDeepResearchPlan` 的步骤：

1. 用 `buildDeepResearchPlan` 生成一个问题树（广度默认 4，夹在 2–6；深度默认 2，夹在 1–3）。
2. 主检索：跑工作区 + 法源 + URL 三类适配器。
3. 扇出：对深度为 1 的问题分别再检索一次，最多 `breadth` 个，每条带上「子问题：<问题>」的前缀。
4. 合并 URL 档案。
5. 如果开了联网且还没有 URL 来源，再补一轮 URL 抓取（最多 8 条）。
6. 按主题相关性过滤掉跑题的命中。
7. 出大纲，并在同一轮用于写正文（律师写了「先出大纲」才停在大纲）。

问题树有五个视角（`ResearchPerspective`）：监管方、执法、商业、比较法、实务。

如果 `allowWebSearch` 是 false，出站适配器会被过滤掉，并加一条风险标记——**如实告诉你「这次没联网」**，而不是假装搜过了。

### 检索命题矩阵

`query-matrix.ts` 解决的是「检索词怎么定」。它把每个争点拆成正反两路：

| 争点类型                           | 正/反查询提示  |
| ---------------------------------- | -------------- |
| 违约责任 / 违约金                  | 有针对性的一组 |
| 解除劳动合同 / 违法解除 / 经济补偿 | 一组           |
| 管辖 / 仲裁条款 / 或裁或诉         | 一组           |
| 诉讼时效 / 时效抗辩                | 一组           |

没有命中预置类型时，查询词从交办原文抽出（整词加二字组），不再套「名称+可能条号」这种不能拿去检索的占位句。预置类型只补正反命题，不替换律师已经写明的争点。

生成的矩阵写进备忘正文，注释里也带着那句话：「无工具则保留栏目并标【待核实】，不编条号。」

### URL 档案

律师丢一个链接进来，`fetchUrlDossier` 会把它抓成一份有出处的卷宗。

四条限制：

| 常量                 | 值     |
| -------------------- | ------ |
| `MAX_BYTES`          | 400000 |
| `MAX_EXCERPT`        | 12000  |
| `DEFAULT_TIMEOUT_MS` | 15000  |
| `MAX_REDIRECTS`      | 5      |

**手动跟重定向**，每一跳都重新走 SSRF 检查和白名单检查。注释解释：「默认走连接层 DNS pin（authority-pinned-fetch）：连接钉到已校验 IP，消除 check-then-fetch 之间的 DNS rebinding TOCTOU 窗口；每个重定向跳同理。」

来源 id 是 `url-<序号>-<哈希前8位>`，哈希是内容 sha256 的前 32 个十六进制字符（再截 8 位）。类型判定看内容：政府域名 + 条例/办法/规定/法/规章 → 法规；含「裁判/判决/裁定/case」→ 案例；否则当网页。

每份档案的许可说明是固定的：「Public web fetch for lawyer research; verify official status before relying.」——提醒你自己核对官方状态。

### 大纲

合规卷宗、学习简报、培训课件会先排章节，再在同一轮写成正文。律师写出「先出大纲」「确认后再写」或「只要大纲」时才停下来等确认。

- `buildResearchOutline` 按交付物类型给出不同章节：合规备忘是「问题陈述/管辖区/发现/行动/来源」，学习简报是「背景/制度/比较」，培训课件是「封面/为什么/规则/案例/清单」。默认 `status: "approved"`。
- `lawyerWantsOutlineHold` 识别要停的说法。`outline-hitl.ts` 在停住之后解析批准、驳回或修改，需要 `【补充信息】`。
- 展开时 `expandApprovedOutlineToSections` 把大纲变成章节正文，每节最多匹配 2 条结论，剩下的归到「未归类检索要点」。模型可用时，`buildDraftWithModel` 在此基础上扩写，不再因为这三类交付物拒绝调用模型。

大纲存在 `drafts/<taskId>.outline.json`。

### 两道门：证据门与旁路门

**证据门**（`research-evidence-gate.ts`）拦的是「没有证据就硬写」。拒绝文案：

```text
研究类交付证据不足：已拒绝扩写正文。请配置模型/开启联网后重跑 deep_research，
或补充权威 URL 后再起草。勿用 write_document 旁路。
```

**旁路门**（`research-write-bypass-gate.ts`）拦的是「绕过流程直接写文件」：

```text
请使用 draft_document（经证据门禁），勿用 write_document 旁路交付。
```

它盯的扩展名是 `.md`、`.markdown`、`.txt`、`.docx`、`.pptx`、`.html`、`.htm`。也就是说，研究类任务想交付这些格式，必须走 `draft_document`，不能拿 `write_document` 绕过门禁。

### 立案试检

`auto-statute-trial.ts` 是个确定性动作：在合适的交付物上自动跑一次法条试检。适用类型：`memo.research`、`memo.opinion`、`memo.internal`、`contract.review`，以及所有 `letter.*` 和 `litigation.*`。来源上限 20 条。

### 培训材料的脱敏门

如果要用案件材料做培训课件，`desensitize-matter.ts` 会扫一遍泄漏风险。**实际有六类检测器**：手机号、身份证、银行账号、邮箱、金额、案号。其中**手机号和身份证是 blocker**（硬拦），其余是警告。扫描上限 40 条发现。必须脱敏并声明后才能继续：

**注意 `name_hint`（姓名线索）只在 `kind` 联合类型里存在，没有任何检测器会产出它**——所以别指望它拦姓名。要挡姓名得靠人工或另加规则。

```text
培训课件使用案件材料前须脱敏。…请脱敏后在指令中注明「已脱敏」再继续。
```

相关函数 `redactTrainingText` 的注释也提醒了一句：「not a substitute for lawyer review」——自动脱敏不能替代律师自己看一遍。

## 10.12 联网检索与白名单

联网这条线有两个概念要分清：

- **对话里的 `web_search`**：一个工具，模型主动调。
- **深度研究里的出站检索**：走 `brave-web` 适配器。

有个历史问题写在注释里，值得知道：

> Chat `web_search` is a separate tool the model must call. Deep research / `research_task` previously only used workspace + authority + optional URL dossier, so enabling「联网」did not actually search the public web.

也就是说，早先开了「联网」开关，深度研究其实还是没搜公开网页。现在补上了 `brave-web` 适配器（每次取 6 条，来源 id 是 URL 的 sha256 前 12 位）。

### 厂商原生联网拦不住，但能过滤

`lawmind-web-search.ts` 有一条很诚实的注释：

> 厂商原生联网（DeepSeek / 通义）是**模型侧**取回结果的，我们无法拦它的出站请求；但可以也只可以把不在白名单里的来源从结果里剔掉

所以有个「被策略收窄」的计数（`scopeFilteredOut`），注释要求：

> `> 0` 时调用方应如实告诉律师「范围被策略收窄了」，不要让它看起来像「网上就是没有」。

这个区别很重要：**「网上没有」和「被我们过滤掉了」是两件事**，不能混成一句「未找到」。

### 官方法规站优先

`search_statute_web` 会优先用这些站点（`PREFERRED_LEGAL_HOSTS`）：`npc.gov.cn`、`www.gov.cn`、`court.gov.cn`、`supremecourt.gov.cn`、`spp.gov.cn`、`moj.gov.cn`、`samr.gov.cn`、`pkulaw.com`、`chinalawinfo.com`。

来源层级分三档：official（前几个政府站）、legal_db（法宝这类法律数据库）、web（其他）。默认取 8 条。

## 10.13 检索相关工具一览

| 工具                      | 参数要点                                                                             |
| ------------------------- | ------------------------------------------------------------------------------------ |
| `deep_research`           | `instruction`（必填）、`matter_id`、`breadth`（2–6，默认 4）、`depth`（1–3，默认 2） |
| `web_search`              | `query`（必填）、`count`（1–10，默认 5）                                             |
| `search_statute_web`      | `query`（必填）、`count`（1–12，默认 8）                                             |
| `url_dossier`             | `urls`（必填）、`task_id`、`max_urls`（1–20，默认 10）                               |
| `search_statute`          | `query`（必填）、`matter_id`                                                         |
| `search_case_law`         | `query`（必填）、`matter_id`                                                         |
| `search_precedents`       | `query`（必填）、`limit`（默认 8，最大 20）、`target_task_id`、`term_map`            |
| `search_company_registry` | `name`（必填）                                                                       |

### 工商查询：诚实失败

`search_company_registry` 的注释写得很清楚：

> Company / 工商 lookup. No live registry adapter ships in Solo. Honest failure: never stamp as verified 登记信息. A configured URL is not live until a fetch actually succeeds.

三句话：solo 版没有内置工商数据源；失败就诚实失败，**绝不能标成「已核实登记信息」**；配了 URL 不代表能用，得真的拉通一次才算。

环境变量：`LAWMIND_COMPANY_REGISTRY_URL`、`LAWMIND_COMPANY_REGISTRY_KEY`，超时 8 秒。未接时标【待核实】。

### 检索不到的固定话术

`authority-hits.ts` 里两句不许编造的文案：

```text
权威库未检索到相关法条/案例。模型不得编造条文；请换关键词或请律师提供权威文本。
```

```text
权威法规/案例库未配置：不得编造法条编号或裁判要旨；请律师补充权威文本或配置检索端点。
```

`authority-gap.ts` 按工具分了两句：

- 类案检索：「请勿编造案号或裁判要旨。请换关键词、配置权威库，或手工提供裁判文书后再引用。」
- 法条检索：「请勿编造条文编号。请换关键词、配置权威库，或手工提供官方法条后再引用。」

## 10.14 HTTP 端点

| 端点                                                | 方法 | 说明                                                                       |
| --------------------------------------------------- | ---- | -------------------------------------------------------------------------- |
| `/api/search/workspace?q=&matterId=&source=&limit=` | GET  | 工作区检索。`source` 可传 `all`、`audit`、`session`、`knowledge`           |
| `/api/search/workspace/rebuild`                     | POST | 重建索引（需 `LAWMIND_ALLOW_INDEX_REBUILD=1`，否则 403）                   |
| `/api/authority/probe`                              | POST | 探测法源端点（open 语料走本机探测；lexis 返回 501；未配 generic 返回 400） |
| `/api/sources/:id/preview?taskId=`                  | GET  | 看某条来源的原文预览（含哪些结论引用了它、哪些章节引用了它）               |
| `/api/sources/:id/annotations?taskId=&matterId=`    | GET  | 来源批注                                                                   |
| `/api/sources/:id/annotations`                      | POST | 加批注（`comment` 必填）                                                   |
| `/api/health`                                       | GET  | 含法源状态、open-law 来源、索引状态                                        |
| `/api/matters/:matterId/materials/search?q=`        | GET  | 案件材料检索（带页码）                                                     |
| `/api/matters/:matterId/precedents?q=`              | GET  | 先例库（未开启时返回 `{enabled:false, hits:[]}`）                          |

来源预览的返回结构是 `{ ok, source, supportingClaims, taskId, sectionsCiting }`——**能看出这条来源支撑了哪些结论、被哪些章节引用了**。这是「引用可回溯」在界面上的样子。

## 10.15 关键文件

| 关注点           | 文件                                                                                                                                                                                                                        |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 检索层入口与合并 | `src/lawmind/retrieval/index.ts`                                                                                                                                                                                            |
| 法源路由         | `src/lawmind/retrieval/authority-adapter.ts`、`authority-provider.ts`                                                                                                                                                       |
| open-law         | `src/lawmind/retrieval/providers/open-law/`（含 README）                                                                                                                                                                    |
| 法宝             | `src/lawmind/retrieval/providers/pkulaw/`（`client.ts`、`citation-validate.ts`、`map.ts`）                                                                                                                                  |
| 安全加固         | `authority-url-guard.ts`、`authority-pinned-fetch.ts`、`authority-usage.ts`、`authority-source-tier.ts`                                                                                                                     |
| 命中映射与话术   | `authority-hits.ts`、`authority-gap.ts`、`authority-health.ts`                                                                                                                                                              |
| 类案就绪         | `src/lawmind/retrieval/case-law-readiness.ts`                                                                                                                                                                               |
| 联网适配器       | `brave-web-search-adapter.ts`、`url-dossier-adapter.ts`                                                                                                                                                                     |
| 模型适配器       | `model-adapters.ts`、`providers.ts`、`openai-compatible.ts`                                                                                                                                                                 |
| 研究协议         | `src/lawmind/research/research-protocol.ts`                                                                                                                                                                                 |
| 深度研究         | `execute-deep-research.ts`、`deep-research-plan.ts`、`query-matrix.ts`、`claim-relevance.ts`                                                                                                                                |
| 大纲             | `research-outline.ts`、`outline-hitl.ts`、`outline-store.ts`、`outline-expand.ts`                                                                                                                                           |
| URL 档案         | `url-dossier.ts`                                                                                                                                                                                                            |
| 门禁             | `research-evidence-gate.ts`、`research-write-bypass-gate.ts`、`auto-statute-trial.ts`                                                                                                                                       |
| 脱敏             | `desensitize-matter.ts`                                                                                                                                                                                                     |
| 索引             | `src/lawmind/indexing/`（`fts-*.ts`、`knowledge-search.ts`、`embeddings/`）                                                                                                                                                 |
| 工具             | `src/lawmind/agent/tools/lawmind-deep-research.ts`、`lawmind-web-search.ts`、`lawmind-legal-web-search.ts`、`lawmind-url-dossier.ts`、`tools/legal/search-tools.ts`、`precedent-search-tool.ts`、`company-registry-tool.ts` |
| HTTP             | `apps/lawmind-desktop/server/lawmind-server-route-search.ts`、`-sources.ts`、`-health.ts`                                                                                                                                   |
| 桌面 UI          | `LawmindSourcePreview.tsx`、`LawmindSourceAnnotations.tsx`、`LawmindCitationBanner.tsx`、`LawmindAuthoritySetup.tsx`、`LawmindResearchFastLaneCard.tsx`                                                                     |

## 10.16 已知坑

- **「演示语料」必须标出来。** 未标注的外部 CORPUS 一律按演示处理，这是故意的保守默认。想去掉标记得显式写 `demo: false`。
- **`provider` 字段不是「已接法宝」的证明。** `open-law.local` 只说明来源，说明不了权威性。
- **未知的 `LAWMIND_AUTHORITY_PROVIDER` 值会退到 `open`**，并在检索结果里写明无法识别、未连接商业库。空值仍是默认 open。
- **类案库探测只看本机。** 挂了公网端点不会被探测到，注释写明「不主动捅公网」。
- **没类案库就不许编案号。** 遇到「为什么查不到案例」，先看类案状态（`GET /api/health` 的 `doctor.scorecardRows` 里有「类案」行）。
- **先例库默认关**（伦理墙）。要开是 `LAWMIND_ALLOW_CROSS_MATTER_SEARCH=1` 且要重建索引。没开时工具返回 `ok: true` 加说明，不是错误。
- **索引默认不自动重建，重建还有独立开关。** 搜不到东西时先确认索引时间。
- **embedding 是桩，不是语义模型。** 打开 `LAWMIND_EMBEDDING_ENABLED=1` 也不要期待语义检索效果。
- **图片不做全库 OCR。** 图片要走审查表抽取那条按需路径。
- **「网上没有」和「被白名单过滤了」要分开说。** 看到 `scopeFilteredOut > 0` 就必须如实告诉律师。
- **重建索引、深度研究、联网都是重活**，别把它们接到「每次打开界面就跑」的路径上。
