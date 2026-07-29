# LawMind 外接能力矩阵与闭源商业路线

> **创建**：2026-07-27（open-law 默认权威路径）  
> **范围**：除大模型（LLM）以外的外接库 / SaaS / 协议能力。  
> **原则**：本地优先；无真源则拒答缺源；开源默认本地开放语料；闭源厂商仅手动/商业占位 + 后续 BYOK。  
> **关联**：[LAWMIND-OPTIMIZATION-BACKLOG.md](./LAWMIND-OPTIMIZATION-BACKLOG.md)（P0-1 权威）、[LAWMIND-NEXT-EXECUTION-PLAN.md](./LAWMIND-NEXT-EXECUTION-PLAN.md)（Track B）、[LAWMIND-ENGINEERING-REVIEW.md](./LAWMIND-ENGINEERING-REVIEW.md)、[LAWMIND-EDITION-FEATURE-MATRIX.md](./LAWMIND-EDITION-FEATURE-MATRIX.md)

---

## 0. 双轨总原则

| | **开源版** | **闭源商业版**（对标 Cursor / Claude Code 体验水位） |
| -- | ---------- | ---------------------------------------------------- |
| 默认 | 本地优先、零强制付费外库 | 开箱可选「平台权威」+ 用户自备 Key（BYOK） |
| 权威法源 | **默认 `provider=open`**：内置 sample + 可选 `LAWMIND_OPEN_LAW_CORPUS`；**不**捆绑付费库 | **主签一家**（中国：北大法宝或威科）；涉外 SKU 再加 Lexis |
| 密钥 | 开源路径无需厂商密钥；generic/闭源由用户自配 | 平台代购额度 + BYOK；钥匙串存储；用量可观测 |
| 合规叙事 | 无命中仍拒答；sample 仅演示，正式引用须核对官方法条 | 合同、转授权、审计、配额、Doctor 可探测 |
| 目标 | 可 fork、可审、可离线试点 | 「打开就能交件、敢引用」 |

**付费事实（选型前提）**

- **北大法宝**：网页订阅与 **MCP/开放 API** 均为商业；MCP 有按次包与企业版（嵌入/转授权通常走企业）。见 [mcp.pkulaw.com/pricing](https://mcp.pkulaw.com/pricing)。
- **LexisNexis API**：无公开标价，商务定制；开发者门户可申请试用/沙箱。
- **不可**把爬虫公开网当权威真源写进默认路径。

---

## 1. 外接能力全景（两端共用分类）

### 1.1 P0 — 信任与法源

| 能力 | 典型供应商 / 形态 | 为何需要 |
| ---- | ----------------- | -------- |
| 权威法规库 | 北大法宝、威科先行、法信等 | 法条真源；禁编造 |
| 权威类案 / 要旨 | 法宝案例、商业类案库 | 类案与引用 |
| 效力 / 废止 / 修订链 | 法宝校验类 API | 防过期条文 |
| 引用核验 | citation validator | 出稿可核 |
| 网页检索（辅助） | Bing / Serper 等 | **非权威**；仅补公开材料 |

### 1.2 P1 — 材料与个人知识

| 能力 | 典型形态 | 为何需要 |
| ---- | -------- | -------- |
| OCR / 文档解析 | 本地 PaddleOCR / Tesseract；云文档智能 | 扫描卷宗进 matter |
| 版面 / 表格 | 云或本地版面模型 | 合同表、鉴定意见 |
| Embedding / 向量检索 | 本地 bge/m3e + sqlite-vss/lance；可选云 embedding | hybrid 个人知识（OPTIMIZATION P1-5） |
| 语音转写 | Whisper 本地；云 ASR | 会议纪要（可选） |
| 翻译 | DeepL / 厂商（涉外） | 双语交付（可选） |

### 1.3 P1 — 律师日常入口

| 能力 | 典型形态 | 为何需要 |
| ---- | -------- | -------- |
| 邮件 | Microsoft Graph、Gmail、IMAP | 收发归档进 matter |
| 日历 / 时限 | Graph / Google Calendar / CalDAV | 开庭与时效 |
| 电子签 | 法大大、e签宝、DocuSign | 交付签署闭环 |
| 会议纪要 | Teams / Zoom（可选） | 会议室回流 |

### 1.4 P2 — Firm / 规模化

| 能力 | 典型形态 | 为何需要 |
| ---- | -------- | -------- |
| DMS | iManage、NetDocuments、SharePoint | 所内文档体系 |
| 企查 / 尽调 | 企查查、天眼查等 | 主体尽调 |
| IP 库 | 商标 / 专利数据商 | IP 业务线 |
| SSO | Azure AD / OIDC | 多律师身份 |
| 法院电子送达等 | 机构通道 | 诉讼流程（合规敏感） |

### 1.5 工程分发

| 能力 | 开源 | 闭源商业 |
| ---- | ---- | -------- |
| 自动更新 | GitHub Releases | 签名更新通道 |
| 遥测 | 默认关 | 脱敏可关 |
| MCP | 用户自挂 | 官方法宝 MCP 向导 + 自有扩展位 |

---

## 2. 开源路线建议（选型）

### 2.1 最小可信集

1. **权威（默认）**：`LAWMIND_AUTHORITY_PROVIDER=open` → `src/lawmind/retrieval/providers/open-law/`（本地 JSONL sample + 可选外部语料；可选 NPC FLK / 自建 caseopen 直播）。无命中仍拒答。  
2. **权威（可选）**：`generic` 自建 `GET ?q=`；或手动切到闭源 `pkulaw` / `lexis`（见 §10）。  
3. **OCR**：PaddleOCR / Tesseract 本地。  
4. **检索**：FTS（已有演进）+ 本地 bge 类 embedding。  
5. **邮件**：IMAP/SMTP 可选；Graph/Gmail 作社区插件。  
6. **电子签**：导出后外链。  
7. **不**捆绑 Lexis / 企查 / DMS；**不**把爬虫公开网当默认权威。

### 2.2 开源权威环境变量（open-law）

```bash
LAWMIND_AUTHORITY_PROVIDER=open   # 默认；可省略
LAWMIND_OPEN_LAW_MODE=local|npc_flk|caseopen|hybrid
LAWMIND_OPEN_LAW_CORPUS=/path/to/laws.jsonl   # 可选；扩充本地语料
LAWMIND_OPEN_LAW_NPC=0|1                      # 1 启用国家法律法规数据库直播（POST /law-search/search/list）
LAWMIND_OPEN_LAW_CASEOPEN=0|1                 # 1 启用自建 cncases/caseopen 裁判检索
LAWMIND_OPEN_LAW_CASEOPEN_ENDPOINT=http://127.0.0.1:8081/api/search
```

- 无需 `LAWMIND_AUTHORITY_ENDPOINT` / `LAWMIND_AUTHORITY_API_KEY`。  
- 模块说明、**开源来源表**、CORPUS JSONL 字段 / 许可边界：`src/lawmind/retrieval/providers/open-law/README.md`。  
- 开放 dump → JSONL：`pnpm lawmind:open-law:convert -- --in … --out …`（不自动拉取无 LICENSE 的大型 GitHub/HF 包）。  
- Doctor / 设置页探测：对 `open` 做本地语料就绪检查（非厂商付费核验）；`sample-ready` = 演示 sample，`configured` = 含外部 CORPUS；摘要含 `openSources[]`（sample / CORPUS / NPC / caseopen）；Lexis 占位为 `unimplemented`（勿与端点 `invalid` 混淆）。  
- **不等于法宝**：开源路径无效力链、无完整类案库、无商业转授权；无命中仍拒答。

### 2.3 开源工程约束

- 核心树保持 vendor-agnostic（`authority-adapter` / MCP 桥可插拔）。  
- 许可证：禁止把 NC / 不可再分发的厂商 SDK 源码打进默认包（对照 `LAWMIND-SKILLS-LICENSE-TABLE.md` 精神）。  
- README / Doctor：明确「开源 sample ≠ 完整法库」；无命中 = 拒答 / 缺源。

---

## 3. 闭源商业路线建议（选型）

### 3.1 Cursor 级最小集（首发必须）

1. **默认权威**：北大法宝（MCP 或 REST）— 平台额度 **或** BYOK。  
2. **引用 / 效力校验**：与同一供应商捆绑，出稿门禁可开。  
3. **OCR**：本地默认 + 可选云加速 SKU。  
4. **知识**：FTS + 本地 embedding；发布带召回评测门禁。  
5. **邮件**：Microsoft Graph 一等公民（OAuth 向导）。  
6. **电子签**：预集成一家国内（法大大或 e签宝）深链回 matter。  
7. Doctor：配额、探测、鉴权是否配置、最近失败原因（无密钥明文）。

### 3.2 二期 / Firm 包

- Lexis / Westlaw 涉外 SKU。  
- SSO（OIDC / Azure AD）+ SharePoint 或 iManage。  
- 企查增值（注意转售条款）。  
- Teams 纪要、托管加密备份（显式同意）。

### 3.3 Edition 对齐

| Edition | 外接策略 |
| ------- | -------- |
| Solo（商业 App） | 法宝 BYOK 或小额平台包；本地 OCR/FTS；Graph 可选 |
| Firm | 平台权威合同 + SSO + DMS + 审计包 + 配额管理 |
| Private Deploy | 客户自备全部外接；我方交付适配器与离线文档 |

---

## 4. 闭源路线详细执行计划

> 目标：在 **不降低**「无源拒答」诚实性的前提下，把商业 App 的研究员从「启发式」提升到「默认真源可引用」。  
> 前提：商务拿到法宝（或威科）**嵌入/转授权**与技术凭证；工程不伪造语料。

### Phase C0 — 商务与契约冻结（0.5–1 周，可与工程并行准备）

| ID | 项 | 验收 |
| -- | -- | ---- |
| C0-1 | 选定主库（默认 **北大法宝 MCP/API**） | 书面：服务清单、SLA、转授权、日志留存、地域 |
| C0-2 | 计量模型 | 平台池 / 按席 / 按次；与 Doctor 字段对齐 |
| C0-3 | 数据出境与案件材料 | 默认 **查询串可上传、卷宗正文不上云**；文档写死 |
| C0-4 | 隐私政策 / 用户协议条文 | 「权威检索」单独披露；BYOK 责任边界 |

**Exit**：法务+产品签字的一页契约摘要进 `docs/`（可脱敏）。

### Phase C1 — 权威真源接入（工程主线，1.5–2.5 周）

| ID | 项 | 落点（建议） | 验收 |
| -- | -- | ------------ | ---- |
| C1-1 | **厂商客户端**（非法宝协议 ≠ 通用 `?q=`） | 新增 `src/lawmind/retrieval/providers/pkulaw/`（或 `authority-pkulaw-mcp.ts`） | 法规关键词/语义、案例检索至少各 1 条 happy-path 集成测（mock 固定夹具） |
| C1-2 | **响应映射** | hit → `ResearchSource` + `ResearchClaim`（必须带 `sourceIds`） | 与现 `authority-adapter` 输出类型一致；无 excerpt 不造 claim |
| C1-3 | **鉴权** | OSS 默认 `LAWMIND_AUTHORITY_PROVIDER=open`（无需 Key）；闭源扩展 `LAWMIND_AUTHORITY_API_KEY` / 法宝 Token；显式 `pkulaw\|generic\|lexis` | Doctor 显示 provider + authConfigured；密钥不进 health JSON |
| C1-4 | **配额 / 错误码** | 429/401/402 → 律师向中文 + `missingItems`；打审计 `authority.*` | 单测覆盖；UI Banner 不与缺源文案冲突 |
| C1-5 | **引用校验挂钩** | 出稿/验收路径可选调用校验 API | edition 或设置开关；失败 → 阻断或强警告（Firm 可强制） |
| C1-6 | **设置向导** | 「连接权威库」：BYOK 粘贴 / 平台已开通状态 | 与首跑、Doctor、ModelRetrieval 同一套 live 状态 |
| C1-7 | **平台额度代理（可选同期）** | 桌面 → 我方 BFF → 法宝（隐藏主密钥） | 仅商业构建打开；开源构建编译剔除 |

**Exit**：配置真 Token 时，对话/`research.legal` 能返回带 citation 的 sources；unset 时行为与今日 fail-closed **完全一致**。

### Phase C2 — 开箱材料与知识（1.5–2 周）

| ID | 项 | 验收 |
| -- | -- | ---- |
| C2-1 | 本地 OCR 流水线（拖入 PDF/图片 → 文本块进 matter） | 无网可跑；律师确认后入库 |
| C2-2 | 可选云 OCR | 显式开关；默认关 |
| C2-3 | 本地 embedding + hybrid 检索 | Golden/争点召回评测不回退；设置可关向量 |
| C2-4 | 证据时间线最小 UI | 从 OCR/文件名日期启发式 → 可编辑 |

**Exit**：扫描件合同可检索到关键段落；权威命中与个人知识分栏展示。

### Phase C3 — 日常入口（1–2 周）

| ID | 项 | 验收 |
| -- | -- | ---- |
| C3-1 | Microsoft Graph OAuth（邮件只读→归档） | 向导完成；token 进钥匙串 |
| C3-2 | 邮件 → matter 附件/线索 | 审计事件；可撤销授权 |
| C3-3 | 电子签深链（一家国内） | 导出交付物 → 签署页 → 状态回写（webhook 或轮询） |
| C3-4 | 日历只读（开庭节点） | 可选；不阻首发可降级 |

**Exit**：律师从邮件点进在办；签署状态在文书台可见。

### Phase C4 — Firm 商业包（2–4 周，可平行商务）

| ID | 项 | 验收 |
| -- | -- | ---- |
| C4-1 | OIDC / Azure AD | Firm edition 门禁 |
| C4-2 | SharePoint 或 iManage 单向同步（先读） | 路径映射 + 冲突提示 |
| C4-3 | Lexis 适配器（涉外 SKU） | provider 枚举扩展；与法宝并存时按 matter 法域选择 |
| C4-4 | 所级配额与审计导出 | Private/Firm 已有审计能力上展示外接调用摘要 |

**Exit**：Firm 演示脚本：登录 → 权威命中 → DMS 打开 → 审计包导出。

### Phase C5 — 发布与运营门禁（持续）

| ID | 项 | 验收 |
| -- | -- | ---- |
| C5-1 | 商业构建 flavor（`LAWMIND_BUILD_CHANNEL=oss\|commercial`） | OSS 构建无平台代理代码路径 |
| C5-2 | e2e：权威 mock 黄金路径 | `lawmind:desktop:e2e:pr` 含「命中 / 缺源 / 401」 |
| C5-3 | 用量看板（内测） | 按日调用、错误率；无案件正文 |
| C5-4 | 事故手册 | 法宝宕机 → 全员缺源；不降级为编造 |

---

## 5. 闭源路线下的工程缺口（相对当前仓库）与补足计划

> **与 §0 / §8 对齐**：OSS **默认**权威已是 `provider=open`（内置 sample + 可选 `LAWMIND_OPEN_LAW_CORPUS` / NPC），**不是**「必须配 HTTP 端点才算有权威」。  
> 本节缺口专指 **闭源商业 / BYOK 体验**（法宝·Lexis·平台额度）相对 Cursor 级水位的差距。  
> 基线：Track A 工程可合并 **≈8.7**（2026-07-28 晚独立复评校正；旧「9.5」自评已作废，见 `LAWMIND-ENGINEERING-REVIEW.md` §0）；HTTP `generic`（`GET ?q=` + Bearer）与 open-law 并存；**无**完整法宝/Lexis 专用协议产品化、无 OCR/向量产品化、无 Graph 一等 OAuth、无电子签状态机、无商业构建隔离。

### 5.1 缺口清单（按严重度）

| 缺口 | 现状 | 闭源为何挡发布 | 补足动作 | 阶段 |
| ---- | ---- | -------------- | -------- | ---- |
| **G1 厂商协议适配** | OSS 默认 open-law；`generic` 假定 `GET ?q=` → `{hits\|items}`；pkulaw/lexis 仍为显式手动/占位 | 法宝 MCP/网关协议不同，接真库会失败 | 实现 `provider=pkulaw` 客户端；保留 `generic` + `open` | C1 |
| **G2 MCP 桥** | 无一等 MCP client 调法宝工具 | 官方主推 MCP | `apps/lawmind-desktop` 或 engine 侧 MCP client；工具结果映射 Research\* | C1 |
| **G3 平台密钥代理** | 仅本机 env | Cursor 级「登录即用」需要 BFF | 商业专用最小 BFF + 桌面兑换短时 token；OSS 剔除 | C1-7 |
| **G4 配额与计量** | 无 | 无法控成本与滥用 | `authority.usage` 审计 + Doctor 摘要；429 文案 | C1-4 |
| **G5 引用校验未挂钩出稿** | citation-integrity 偏本地锚定 | 商业「敢引用」差最后一公里 | 可选调用厂商校验；验收门禁配置 | C1-5 |
| **G6 OCR 流水线缺失** | 愿景有、产品无系统入口 | 扫描卷宗仍靠手工 | 本地 OCR worker + 确认入库 API | C2 |
| **G7 Embedding 未产品化** | FTS/加权有；向量非标配 | 个人知识体验弱于竞品 | 本地 embedding 索引 + 设置开关 + 评测 | C2 |
| **G8 Graph OAuth 非一等** | mail 痕迹 / 非完整向导 | 律师日常入口断 | OAuth 向导 + 钥匙串 + 撤销 | C3 |
| **G9 电子签无状态回写** | 外链叙事 | 交付闭环不完整 | 一家签署 provider + matter 状态 | C3 |
| **G10 构建通道未隔离** | 单一桌面构建 | 开源发行易误带商业代理 | `oss` / `commercial` flavor + CI 矩阵 | C5 |
| **G11 法域 / 多 provider** | 单 endpoint | Firm 涉外 | `matter.jurisdiction` → provider 路由 | C4 |
| **G12 合约测试夹具** | 单测 mock fetch | 厂商字段漂移无保护 | 录制脱敏 fixture + contract test | C1/C5 |
| **G13 安全默认** | loopback API 已较好 | 商业攻击面增大（OAuth、BFF） | PKCE、state、redirect 白名单、BFF 速率限制；对照 `SECURITY.md` | C1/C3 |
| **G14 文档 / 销售叙事** | Track B「gated」 | 销售误称「已接法宝」 | 本文件 + Doctor 文案；未配置不得显示「已核实」 | 持续 |

### 5.2 工程补足优先级（闭源关键路径）

```text
C0 契约
  → C1 G1/G2/G3/G4/G5/G12/G13（权威真源）  ← 最大信任跃迁
  → C2 G6/G7（材料与知识）
  → C3 G8/G9（日常入口）
  → C5 G10/G14（发布隔离与叙事）
  → C4 G11（Firm）
```

### 5.3 建议新增模块边界（避免再胀神模块）

| 模块 | 职责 |
| ---- | ---- |
| `src/lawmind/retrieval/providers/*` | 各厂商客户端；禁止 UI 直呼 |
| `src/lawmind/retrieval/authority-router.ts` | provider 选择、法域、降级缺源 |
| `apps/lawmind-desktop/server/lawmind-server-route-authority*.ts` | probe/usage/BYOK 校验（扩展现有 health/probe） |
| `apps/lawmind-desktop/src/renderer/LawmindAuthoritySetup.*` | 连接向导（从 Settings 抽出，防 ModelRetrieval 再膨胀） |
| `src/lawmind/ingest/ocr/*`（新） | OCR 管道与确认入库 |
| `src/lawmind/indexing/embeddings/*`（新或扩） | 本地向量索引 |
| `apps/lawmind-commercial-bff/`（仅商业仓或 private 包） | 平台额度代理；**不得**进 OSS 默认 workspace 强制依赖 |

### 5.4 明确不做（闭源也禁止）

1. 无契约爬取裁判文书网充当默认权威。  
2. 无源时静默让模型「补全法条」。  
3. 将完整卷宗默认上传厂商「帮你分析」而不经律师确认。  
4. 在 OSS 构建中编译进平台主密钥。

---

## 6. 里程碑与宣称口径

| 里程碑 | 可对内宣称 | 不可宣称 |
| ------ | ---------- | -------- |
| 今（Track A ≈8.7 + open-law 默认） | 工程可合并；OSS 默认 `provider=open`（sample）；无命中拒答 | 「已接入北大法宝/Lexis」或「完整法库」 |
| C1 完成 + 真 Token 联调 | 「已接 {供应商} 检索（BYOK/平台）」 | 「覆盖全部中国法」 |
| C2 完成 | 「扫描卷宗可入库检索」 | 「替代人工阅卷」 |
| C3 完成 | 「邮件/签署工作流可用」 | 「取代所内 OA」 |
| C4 完成 | 「Firm 包：SSO+DMS+多库」 | — |

**产品信任分**（与工程分分离）：仅当 C1 真联调通过后，才在 `LAWMIND-ENGINEERING-REVIEW.md` 上调「产品信任（含外接权威语料）」轴。

---

## 7. 验证清单（开源 open + 闭源 C1 最小）

```bash
# open-law 默认 + 通用 fail-closed + provider 路由
pnpm exec vitest run src/lawmind/retrieval/authority-adapter.test.ts \
  src/lawmind/retrieval/authority-health.test.ts \
  src/lawmind/retrieval/authority-provider.test.ts \
  src/lawmind/retrieval/authority-usage.test.ts \
  src/lawmind/retrieval/providers/ \
  src/lawmind/build-channel.test.ts \
  src/lawmind/indexing/embeddings/index.test.ts \
  src/lawmind/ingest/ocr/index.test.ts

# 桌面
pnpm --filter lawmind-desktop typecheck

# e2e（权威设置面 mock；已纳入 e2e:pr）
pnpm --filter lawmind-desktop exec playwright test e2e/authority-mock.spec.ts --workers=1
```

**开源手动**：默认启动 → Doctor 显示开源语料已就绪 → 对话问 sample 内法条（如民法典解除）→ 有 citation；无命中仍缺源。  
**真库手动（需 USER 凭证后）**：显式 `provider=pkulaw` + Token → Doctor 探测绿 → 对话问现行有效法条 → Citation Banner 可点开来源 → 断开 Token → 恢复缺源拒答。

---

## 8. 执行记录（工程可做部分 · 2026-07-27）

| 日期 | 项 | 状态 |
| ---- | -- | ---- |
| 2026-07-26 | 本文落盘（开源/闭源矩阵 + 闭源计划 + 工程缺口） | ✅ |
| 2026-07-27 | **C1 工程骨架**：`provider` 路由、pkulaw client（rest/post/mcp）+ fixtures、401/429 文案、usage 计量、citation validate 挂钩 acceptance、AuthoritySetup UI、Doctor 扩展字段 | ✅ mock 测绿；**真 Token 联调仍 gated** |
| 2026-07-27 | **C2 骨架**：`ingest/ocr`（确认入库）+ `indexing/embeddings` 本地 stub/hybrid | ✅（云 OCR / 生产 embedding 模型仍占位） |
| 2026-07-27 | **C3 占位**：Graph OAuth / 电子签 status 进 Doctor | ✅ 未实现 OAuth/签署（见 §10） |
| 2026-07-27 | **C5**：`LAWMIND_BUILD_CHANNEL` + commercial BFF stub README；e2e `authority-mock` | ✅ |
| 2026-07-27 | **OSS 默认权威**：`provider=open` → open-law（local sample / CORPUS / 可选 NPC）；pkulaw/lexis 仍为显式手动占位 | ✅ |
| 2026-07-28 | Lexis health → `unimplemented`（Doctor 不与端点 `invalid` 混淆）；CORPUS 格式/许可文档；sample 增 `regulation` 演示条；FirstRun/Doctor 明示 sample≠完整法库 | ✅ |
| — | C0 商务契约摘要 | ⬜ **USER** |
| — | C1 法宝/主库 **真联调** | ⬜ **USER** + 凭证 |
| — | C3–C4 深集成 / Firm | ⬜ **USER** 凭证后继续工程 |

---

## 9. 一句话决策

- **开源**：默认 `open-law` 本地语料（sample + 可选 CORPUS）；无命中拒答；本地 OCR + FTS/向量。  
- **闭源（Cursor 级）**：**必须买通并工程接入一家权威法源**（显式 `pkulaw`/`lexis`）；再用 OCR、Graph、电子签做出开箱体验；Lexis/DMS/企查进 Firm。  
- **当前仓库（2026-07-27）**：OSS 默认权威路径已接 open-law；厂商 **协议客户端 + 计量 + UI + 构建隔离已落地（mock）**；**没有**真实法宝/Lexis 凭证前，仍不得宣称「已接入外库」。

---

## 10. USER 手动待办清单（工程已留好接缝，请你做完后我们再联调）

> **开源日常使用**：无需本节。默认 `provider=open`，内置 sample 即可演示检索；要扩充语料时设置 `LAWMIND_OPEN_LAW_CORPUS`（见 §2.2）。  
> **闭源 / 商业联调**：做完下列任一项后，把凭证写入本机 env（勿提交 git），然后通知工程侧跑 §7「真库手动」验收。

### 10.0 开源语料（可选增强，非阻塞）

| # | 你要做的事 | 完成后写入 / 交付 |
| - | ---------- | ----------------- |
| U0a | （可选）准备自有开放法规 JSONL（字段见 open-law README；自行确认许可） | `LAWMIND_OPEN_LAW_CORPUS=/abs/path/laws.jsonl` |
| U0b | （可选）启用国家法律法规数据库直播 | `LAWMIND_OPEN_LAW_MODE=hybrid`（或 `npc_flk`）+ `LAWMIND_OPEN_LAW_NPC=1` |
| U0c | Doctor / 设置 → **探测开源语料** | 默认应为「演示语料就绪」或含 CORPUS 时「已配置」；**不是**「权威未配置」 |

### 10.1 阻塞「产品信任」的必做项（闭源 C0–C1 · 手动）

| # | 你要做的事 | 完成后写入 / 交付 |
| - | ---------- | ----------------- |
| U1 | 选定主库（建议北大法宝 MCP/API）并完成商务：嵌入/转授权、SLA、计量 | 一页契约摘要（可脱敏）放 `docs/` 或私有 wiki |
| U2 | 在 [mcp.pkulaw.com](https://mcp.pkulaw.com)（或厂商控制台）注册应用，领取 **Access Token** | `LAWMIND_AUTHORITY_API_KEY=<token>` |
| U3 | 确认网关 Base URL（MCP 服务 URL 或贵司 REST 适配层） | `LAWMIND_AUTHORITY_ENDPOINT=<https://...>` |
| U4 | 设置闭源 provider（**显式**，勿依赖默认 open） | `LAWMIND_AUTHORITY_PROVIDER=pkulaw` |
| U5 | （可选）选择调用模式 | `LAWMIND_PKULAW_MODE=rest_compat\|search_post\|mcp_tools_call` |
| U6 | （可选）启用出稿厂商引用校验，并确认 `/validate` 路径可用 | `LAWMIND_AUTHORITY_CITATION_VALIDATE=1` |
| U7 | 重启桌面 / 本地 server，打开设置 → 模型 → **探测权威端点** | 截图或告知探测结果 |

### 10.2 商业平台额度（可选，Cursor 级「登录即用」）

| # | 你要做的事 | 说明 |
| - | ---------- | ---- |
| U8 | 部署 `apps/lawmind-commercial-bff` 的真实代理（非 stub） | 主密钥只放 BFF/KMS |
| U9 | 商业构建设置 | `LAWMIND_BUILD_CHANNEL=commercial` + `LAWMIND_PLATFORM_AUTHORITY_PROXY=1` + BFF URL |

### 10.3 材料 / 知识（C2 增强）

| # | 你要做的事 | 说明 |
| - | ---------- | ---- |
| U10 | （可选）选定云 OCR 厂商并给 API | 现在默认本地 tesseract；云为占位 |
| U11 | （可选）选定生产 embedding 模型（如 bge-m3）与运行时 | 当前 `LAWMIND_EMBEDDING_ENABLED=1` 仅为本地 hash stub |

### 10.4 日常入口（C3）

| # | 你要做的事 | 说明 |
| - | ---------- | ---- |
| U12 | Azure Entra 注册应用（Mail.Read 等） | `LAWMIND_GRAPH_CLIENT_ID=...`；见 `graph-oauth-placeholder.ts` |
| U13 | 选定电子签厂商并签合同 | `LAWMIND_ESIGN_PROVIDER` + API Key；见 `esign-placeholder.ts` |

### 10.5 Firm / 涉外（C4）

| # | 你要做的事 | 说明 |
| - | ---------- | ---- |
| U14 | Lexis Developer Portal 申请 API/沙箱；设置 `LAWMIND_AUTHORITY_PROVIDER=lexis` + endpoint/key | 适配器仍为占位（`providers/lexis/placeholder.ts`）；真客户端后续补 |
| U15 | SSO / DMS 商务与租户信息 | SharePoint 或 iManage |

### 10.6 明确不要做

- 不要把 Token 提交进 git / 聊天明文长期存放。  
- 不要在未签约时把爬虫公开网当默认权威。  
- 未完成 U1–U7 前，销售材料不要写「已接入北大法宝」。
