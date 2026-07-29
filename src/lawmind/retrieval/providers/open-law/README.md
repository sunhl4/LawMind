# Open-law provider（开源权威路径）

面向 **开源 / Solo 默认可复现** 的法条与公开裁判检索，不依赖北大法宝 / Lexis。

> **诚实边界**：内置 sample 仅演示检索与 citation 管线，**不是**完整中国法库。无命中仍拒答/缺源；正式引用须核对官方法条（如 [flk.npc.gov.cn](https://flk.npc.gov.cn/)）。直播/外部 dump **不会**伪装成法宝。

## 已接入开源来源

| 来源 | 许可 / 属性 | 访问方式 | 如何启用 | 风险 |
|------|-------------|----------|----------|------|
| **内置 sample** | 公开法律文本演示摘录 | 嵌入 JSONL | 默认 `provider=open` | 非完整库；命中带「演示语料」 |
| **外部 CORPUS** | 用户自备；须自行确认 | 本地 JSONL/JSON | `LAWMIND_OPEN_LAW_CORPUS=` | 许可不明则勿用于生产出稿 |
| **NPC 国家法律法规数据库** | 官方政府公开信息 | 直播 HTTP `POST /law-search/search/list` | `LAWMIND_OPEN_LAW_NPC=1` | 接口可变；限流；勿批量镜像 |
| **cncases / caseopen** | 软件 MPL-2.0；文书为公开裁判 | 自建 `GET /api/search`（默认本机） | `LAWMIND_OPEN_LAW_CASEOPEN=1` | 索引体量大；公网 demo 有 Cloudflare |

### 研究后未默认捆绑

| 候选 | 结论 |
|------|------|
| twang2218/law-datasets、HF `chinese-law-and-regulations` | **无明确 LICENSE** → 仅支持本地 convert，不自动下载 |
| dengcao/Chinese-Laws 等条文行语料 | GitHub `license: null` → 同样 manual-only + `article_line` 转换器 |
| 元典 / 法研开放平台 / flfgsc API | 商业或需 Key → **不**接入开源默认路径 |
| 北大法宝 / Lexis | 闭源占位，见 `docs/LAWMIND-EXTERNAL-INTEGRATIONS.md` §10 |

许可说明见 `corpus/LICENSE-ATTRIBUTION.md`。

## 环境变量

```bash
LAWMIND_AUTHORITY_PROVIDER=open
LAWMIND_OPEN_LAW_MODE=local          # local | npc_flk | caseopen | hybrid
LAWMIND_OPEN_LAW_CORPUS=/abs/path/laws.jsonl   # 可选
LAWMIND_OPEN_LAW_CORPUS_DEMO=0|1               # 1 时外部 CORPUS 全部打演示水印
LAWMIND_OPEN_LAW_NPC=0|1                       # 1 启用官库直播
LAWMIND_OPEN_LAW_NPC_ENDPOINT=https://flk.npc.gov.cn/law-search/search/list
LAWMIND_OPEN_LAW_CASEOPEN=0|1                  # 1 启用自建裁判检索
LAWMIND_OPEN_LAW_CASEOPEN_ENDPOINT=http://127.0.0.1:8081/api/search
```

无需 `LAWMIND_AUTHORITY_ENDPOINT` / API Key。

`hybrid`：先本地 CORPUS/sample → 若无命中且已启用则试 NPC → 再试 caseopen。

## 把开放 dump 转成 CORPUS

```bash
# FLK 风格 JSON 数组（title/content/office/…）或 JSONL
pnpm lawmind:open-law:convert -- --in ./laws.json --out ./laws.jsonl

# 条文行：《民法典》第八条规定，……
pnpm lawmind:open-law:convert -- --in ./articles.txt --format article_line --out ./articles.jsonl

export LAWMIND_OPEN_LAW_CORPUS=$PWD/laws.jsonl
```

仓库**不**提交大型二进制/百 MB dump；请自行下载后转换。`--limit` / `--demo` 可用于试点。

## CORPUS 文件格式

支持：

1. **JSONL**（推荐）：每行一个 JSON 对象；`//` / `#` 行注释可跳过。
2. **JSON 数组**：文件以 `[` 开头时按数组解析。

| 字段 | 必填 | 说明 |
|------|------|------|
| `id` | ✅ | 稳定 ID；与内置 sample 冲突时 **外部 CORPUS 覆盖** |
| `title` | ✅ | 展示标题 |
| `kind` | | `statute` \| `case` \| `regulation` \| `other` |
| `citation` | | 短引用标签（如《民法典》第563条） |
| `excerpt` | | 短摘录（claims / 预览） |
| `body` | | 较长正文（本地关键词检索主字段） |
| `url` | | 来源链接（建议官库） |
| `status` / `office` / `tags` | | 元数据；tags 参与打分 |
| `demo` | | `true` 时打演示水印 |
| `provider` / `corpusId` / `licenseNote` | | 归属元数据（检索结果透传） |

## Doctor 状态口径

| status | 含义 |
|--------|------|
| `sample-ready` | 仅内置演示 sample（非正式完整法库） |
| `configured` | 已加载外部 CORPUS（仍非「已接法宝」） |
| `unimplemented` | 如 Lexis：适配器占位 |

健康摘要额外带 `openSources[]`：local_sample / local_corpus / npc_flk / caseopen 各自是否就绪。

## 闭源占位

`LAWMIND_AUTHORITY_PROVIDER=pkulaw|lexis` 仍为商业/手动接入路径，见仓库根文档 `docs/LAWMIND-EXTERNAL-INTEGRATIONS.md` §10。
