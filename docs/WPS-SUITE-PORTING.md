# MeWork 内置 WPS 套件 · 移植规格书（目标：deepseekharness 底座的公司内部 agent）

> 日期：2026-10-27  
> 目的：把本参考仓库里与 MeWork 内置 WPS/文档套件有关的**全部可移植规格**整理成一份独立文档。按照本文档，另一个基于 **deepseekharness 底座**（DeepSeek 系 OpenAI 兼容工具调用 harness）的 agent 项目可以集成、复刻同一套「WPS 全家桶」能力：Word/Excel/PPT/PDF 的读、写、改、审、比、转、交付，以及对本机 WPS 的打开/集成；外加 MeWork 的项目扩展三件套（**时间线 / 大事记 / 思维导图**，§3.9 / §4.15）——这三张 schema 与法律无关，通用 agent 可直接复用。  
> 读者：合作 agent 项目的实现者。不要求先读参考仓库的其它文档；每条结论都标注了出处（参考仓库的文件路径，或对应文档章节）。

---

## 0. 先说清三个名词与一条边界

| 名词                     | 在本文档里的含义                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **MeWork**               | 幂律智能的法律垂直 Agentic AI 桌面产品（Electron，0.3.20 已被本仓库 REA 拆解）。它的"WPS 套件"**不是** WPS 加载项——客户端里没有 WPS 插件路线；它是一套 agent 自带的文档工具链：工作区文件六件套、`ConvertDocToDocx`、`CompareFiles`、`ValidateFileReferences`、证据锚 lineRef、分析表、`present` 交付。规格出处：`docs/LAWMIND-MEWORK-CODE-REVIEW.md`（实机拆包）、`docs/LAWMIND-MEWORK-REA-GAP.md`（补证）、`docs/LAWMIND-MEWORK-COMPETITOR-REVIEW.md`（公开口径）。 |
| **参考实现（本仓库）**   | 一个现成 agent 的开源实现仓库，即本文档的出处。在 MeWork 规格之外**自建了一整套参考实现**（officecli 修订轨、ExcelJS/Excel 表格预览、pptx 视觉预览、PDF 导出、证据锚闸门、WPS 打开、Word/WPS 加载项等）。移植时可以直接照规格重写，也可以把被标注"可直接移植"的模块**原封搬走**（均为该仓库自有代码，无竞品代码）。                                                                                                                                                   |
| **deepseekharness 底座** | 合作项目的 agent 载体：DeepSeek 系模型（OpenAI 兼容 function calling）。关键约束见 `docs/LAWMIND-DEEPSEEK-STACK-REVIEW.md` §4：**无状态端点不支持"续跑只发增量"**；前缀缓存是块粒度（约 64 token）的；能拿的是「前缀逐字节稳定 + 工具表指纹不变 + fixed/cached 观测」三条纪律。                                                                                                                                                                                       |

**合法吸收边界**（照抄 `docs/LAWMIND-REA-TARGET-MAP.md` §2 的硬规则）：MeWork 侧只吸收**行为规格**（可观察交互、文件格式、校验规则），不搬它的代码、提示词、专有文案；本仓库的实现是自有代码，**原封照搬不受此约束**。

**现状校准**（免得照错误认知开工）：

- MeWork 桌面 0.3.20 没有任何 Word/WPS 加载项；参考实现的 Word/WPS 加载项**存在但标注为半成品**，WPS 侧从未真机验收（见 §5.2）。
- 参考仓库的产品在 2026-10-27 已把「Word/WPS 加载项」**退出目标范围**（`docs/LAWMIND-REA-TARGET-MAP.md` §0.1）：审阅在应用内完成，「用本机应用打开」只作异常格式逃生口。这是参考仓库的产品边界，**不是**你们项目的边界——你们的目标就是把 WPS 全家桶做成能力，所以本档把「实现但已降级」的集成规格也完整保留，供你们按需取用，并如实标注其验收状态。
- 本仓库不提交任何 MeWork 解包源码；下文 MeWork 规格均来自上述 4 份文档的规格级摘要。

### 0.1 一个必读说明：路径与标识符里的品牌前缀

本文叙事里不再出现参考仓库的产品名；但**代码路径、文件名、环境变量是原样字符串**（"原封照搬"时要靠它们定位复制哪些文件），所以下文仍保留参考仓库内的真实路径，例如 `src/…`、`apps/…` 下的目录名。照搬时的统一改法（全库批量替换即可）：

| 参考仓库里的写法                                                                                                                                                        | 是什么                                                  | 移植到新 agent 时                                  |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- | -------------------------------------------------- |
| `src/<产品名>/…`、`apps/<产品名>-desktop/…`、`docs/<产品名>/…`，以及各类文件/组件名（如参考仓库内的 `LawmindWordRevisionSurface.tsx`、`lawmind-chat-markdown-math.ts`） | 仓库目录/文件路径与标识符（引擎、桌面壳、手册文档三处） | 按你们的仓库结构与命名规范改写，逻辑不变           |
| `LAWMIND_OFFICECLI` / `LAWMIND_RESOURCES_PATH` / `LAWMIND_REPO_ROOT` / `LAWMIND_OCR_BUDGET_MS` / `LAWMIND_OCR_DATA_DIR`                                                 | 环境变量                                                | 重命名成你们的前缀                                 |
| `LAWMIND_PROMPT_DYNAMIC_BOUNDARY`                                                                                                                                       | 系统提示静态/动态边界哨兵（§2.2）                       | 重命名，哨兵串本身也可自定义                       |
| `window.LAWMIND_ADDIN`                                                                                                                                                  | 加载项任务窗格的全局宿主标记（§5.2）                    | 重命名                                             |
| `word/<产品名>-disposition.xml`（参考仓库内为 `word/lawmind-disposition.xml`）                                                                                          | docx 包内私有 part，存"接受/拒绝"落态（§4.11）          | 重命名；注意兼容——读到旧名按"全部未处理"对待，别崩 |
| `lawmind:open-with-wps`                                                                                                                                                 | 桌面 IPC 通道名（§5.1）                                 | 按你们规范自定义                                   |
| 修订作者默认名（参考仓库内为字符串常量 `"LawMind"`）                                                                                                                    | officecli `--prop revision.author=` 的默认值（§4.2）    | 换成你们的产品名                                   |

一句话：**行为规格 100% 可照抄；带产品名的路径/变量/通道按上表做一次机械改名即可。**

---

## 1. 能力全景图（WPS 套件分七层）

| 层              | 能力                                                           | MeWork 有                 | 参考实现（本仓库）                                                                                                          | 移植难度                          |
| --------------- | -------------------------------------------------------------- | ------------------------- | --------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| L0 文件基座     | 工作区读写、路径围栏、内容指纹、版本                           | ✅ 工作区六件套           | `src/lawmind/runtime/workspace-path.ts`、`workspace-io-fence.ts`、`file-version.ts`、`atomic-write.ts`                      | 低                                |
| L1 读取/摄取    | docx 抽文、xlsx 结构化、pdf 文本/OCR/视觉、图片 OCR、.doc 读取 | ✅（云端协助）            | `src/lawmind/agent/tools/legal/ingest-helpers.ts`、`xlsx-workbook.ts`、`mail/read-word-binary.ts`                           | 低                                |
| L2 分析         | 表格列分析、分析表+依据列、沙箱计算、只读比对                  | ✅ 分析表                 | `spreadsheet-tools.ts`、`deliverables/review-table.ts`、`run-compute-tool.ts`、`compare-documents.ts`                       | 中                                |
| L3 生成/落盘    | docx 渲染（版式）、xlsx 写入、pptx 结构化生成、声明式图表      | ✅（docx 查看器强）       | `artifacts/render-docx.ts`、`render-pptx.ts`、`xlsx-workbook.ts` 写入、`chart-tool.ts`                                      | 中                                |
| L3.5 结构化交付 | 项目三件套（时间线 / 大事记 / 思维导图）JSON + SVG             | ✅（项目扩展）            | `deliverables/matter-artifact*.ts`、`drafts/matter-artifact-regen.ts`、`agent/tools/legal/matter-artifact-tool.ts`（§4.15） | 中（schema 与行业无关，推荐照搬） |
| L4 编辑/审阅    | 最短改动、w:ins/w:del 修订轨、格式修复、格式体检、术语自适应   | △（有 docx/pdf 标注引擎） | `drafts/minimal-edit-script.ts` + B1–B5 全链（§4.2）、`document-format-audit.ts`                                            | **高**（核心价值）                |
| L5 证据锚/闸门  | lineRef（L/P/S!）、quote 校验、PASSED 才出稿、定位回跳         | ✅✅（强规格）            | `drafts/evidence-locator.ts`、`evidence-anchor.ts`、`evidence-support.ts`                                                   | 中                                |
| L6 交付         | docx→pdf、.doc→.docx、命名/落点、待发信                        | ✅ present                | `docx-export-pdf.ts`、`convert-with-word.ts`、`default-output-location.ts`                                                  | 低                                |
| L7 宿主集成     | WPS 打开、Word/WPS 加载项、桌面内文档预览面                    | ✅ 桌面查看器             | `electron/safe-shell-command.mjs`、`resources/word-addin/`、renderer/file/*                                                 | 中（预览面高）                    |

读法：**L0/L1/L6 拿现成模式即可；L4/L5 是这套套件与"普通 agent 写文件"拉开差距的地方，必须做到同样的硬约束；L3.5 是与行业无关的现成模块，整块照搬；L7 按你们产品形态决定做多少。**

---

## 2. 底盘差异：三类决定，写在动工之前

### 2.1 循环位置决定架构形状

MeWork 是「云循环 + 本地工具执行」：每轮云端采样一次，本地工具跑完再发 `frontend-tool-continue`；它把 `CompareFiles`、`ConvertDocToDocx`、`ValidateFileReferences` 做成"读在本地、算在云、写回本地"。

deepseekharness 是自持循环，实现时**必须把这三个"云端算"全部本地化**：

| MeWork 形态                                                  | 你们必须做的替换                               | 本仓库参考                                                                                          |
| ------------------------------------------------------------ | ---------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `CompareFiles`（本地读 → 云端算 diff/OCR → 写 `.comp.json`） | 本地文本提取 + 本地 diff（行级起步，词级可选） | `src/lawmind/agent/tools/legal/compare-documents.ts`（4000 行上限、40 个差异样本、单行 200 字截断） |
| `ConvertDocToDocx`（云端转换）                               | 本机 Word 另存（.doc→.docx）+ 兜底 LibreOffice | `src/lawmind/mail/convert-with-word.ts`（§4.7）                                                     |
| `ValidateFileReferences`（前端壳上调云端）                   | 本地校验：指纹 + lineRef 解析 + quote 对读     | `src/lawmind/drafts/evidence-anchor.ts`（§4.8）                                                     |

### 2.2 DeepSeek 缓存纪律（决定这类重上下文 agent 的成本）

本仓库 `docs/LAWMIND-DEEPSEEK-STACK-REVIEW.md` 已给出结论，**照抄两条纪律、加一个观测**：

1. **前缀逐字节稳定**：系统提示用静态前缀 + 动态边界（本仓库做法：`src/lawmind/agent/system-prompt.ts` 的 `LAWMIND_PROMPT_DYNAMIC_BOUNDARY`，静态段冻结，只替换边界之后）。
2. **工具表指纹不变**：工具表一变，整段前缀缓存从改动块开始失效。不要按轮增删工具；要加就用隐藏 transcript 增量说明（本仓库 `src/lawmind/agent/tool-disclosure-delta.ts` 的做法）。
3. **fixed/cached 观测**：首轮把系统提示 + 工具 schema 的 token 单独记为"固定税"；usage 里的 `prompt_cache_hit_tokens` / `prompt_tokens_details.cached_tokens` 两代字段名都要读。没有这三个数，优化只能靠感觉。

**不要照抄** MeWork 的「续跑只发两条消息」：那是云端按消息链重建上下文才成立的做法，DeepSeek 无状态端点上没有实现路径（DEEPSEEK-STACK-REVIEW §4.2）。

### 2.3 数据边界

MeWork/你们都是"终端员工文件不出机器"的口径。可本地复刻清单：文档解析、diff、修订轨、表格、图表、PDF 导出——全部无需云。需要云/外部程序的只有：OCR（本地 tesseract.js 可兜底，视觉模型可选）、`.doc→.docx` 的 Word 另存路径（用员工本机已装的 Word/WPS，不随应用分发）。**不要**把文档内容默认上传到任何模型侧服务；进模型的只有用户指令 + 显式选定的材料文本。

---

## 3. MeWork 侧规格（REA 吸收清单 · 行为级）

下面这些是 MeWork 桌面端**可观察到的行为规格**，是这套套件的原始蓝本。每条都标了出处文档。

### 3.1 文件基座（工具执行面的安全壳）

| 规格             | 内容                                                                                                                                    | 出处                    |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| 工作区工具六件套 | `write_workspace_file` / `read_workspace_file` / 移动/删除/列目录/搜索，均以 `purpose`（一句中文动宾短语，给用户看）为第一参数          | MEWORK-CODE-REVIEW §2.4 |
| 路径围栏         | `validateRelPath` 拒空/控制字符/绝对路径/`..` 段；词法折叠保留前导 `..`；逐段 lstat 拒 symlink；TOCTOU 用 `O_NOFOLLOW` + fstat 指纹复核 | 同上附录 F.2            |
| 写入带归因与冲突 | PUT 带回执 + `{actor, plugin}` 归因；重复创建返回 412                                                                                   | 同上附录 F.4            |
| 后台命令         | 立即回 `task_id`；kill 分 `killed`（带 `user_kill`）/`lost`；每会话 2 个、墙钟 600 秒                                                   | 同上 F.1                |
| 子进程环境       | env 默认拒绝白名单、不继承 `process.env`、`NODE_OPTIONS` 刻意不放                                                                       | 同上 F.2                |

### 3.2 转换与查看器

- **`ConvertDocToDocx`**：与 `CompareFiles` 同族，读本地、云端转换、写回本地。本地化替代见 §4.7。
- **文档查看器定位算法**（把 lineRef + quote 点回原文）：NFKC 归一化 + 中文标点映射 + 去空白 + 小写，比对后**回映射原文区间**；段内命中两次直接报 `citation text is ambiguous in document`，**不猜**。这是本套件"可信点回跳"的核心算法（MEWORK-CODE-REVIEW §F.4 引用三层）。

### 3.3 比对（CompareFiles）

- 参数：`source_path`、`target_path`、`output_path`（**必须 `.comp.json`**）、`ocr_mode`。
- 产物：`.comp.json` 双栏打开，词级五态（相等/改/删/增/移动），双向滚动联动（跨页批注锚），失败单条跳过并留痕（`[mw3] rejected`）。
- 本地化：把"云端算 diff"换成 `§4.11` 的行级 diff（先上线），词级五态做法好（后续增强）。

### 3.4 证据锚 lineRef

六类目标（`docs/LAWMIND-MEWORK-REA-GAP.md` §3.1）：

| 形态                             | 含义                                                    |
| -------------------------------- | ------------------------------------------------------- |
| `L{n}`                           | DOCX 第 n 段（可带 `$fileField`、`#dataItem/ins` 拼接） |
| `P{n}`                           | PDF 第 n 页                                             |
| `S{sheet}!A1` / `S{sheet}!A1:B2` | Excel 单元格 / 区域                                     |
| `#id/ins`、`{field}`             | 业务数据项 / 字段（MeWork Powerbase 语言；你们不需要）  |

- 引用写法：`@@目标|原文quote@@`，或隐形哨兵 `\uE000<私有token>\uE001`（sentinel 方案的要点：token 与渲染可分离，流式期间渐进匹配）。
- 回跳：带 `lineRef + quote` 请求"打开并定位"；**无精确形态时降级成"打开原文件"**，不假定位。

### 3.5 出稿闸门（ValidateFileReferences）

这是 MeWork 工程完整度最高、也最该照抄的行为（同上 §3.2）：

- 请求 schema v2：`{schemaVersion, requestId, outcome, sources[{path, contentSha256}], references[{id, filePath, lineRef, text}]}`；协议名 `mework-file-references v1`。
- 语义：`PASSED` 才允许生成终稿；`FAILED` 修正重试；`INCOMPLETE` **不算通过**；工具结果里必须有能让模型自查的 issue 列表。
- 上限：128 来源、8MB payload、100MB 单文件、120 秒；服务端不兼容时文案是"请升级 agent"，不静默降级。
- 对模型可见的工具白名单里它是特殊项（和"交付"同级），说明**这是一等工具，不是内部校验器**——把它做成显式工具，模型才会主动停下核对。

### 3.6 分析表（尽职调查批量提取）

- 落盘约定：`analysis_tables/{tableId}.ana.json`（settled schema）、`{tableId}.row.{recordId}.json`、`{tableId}.source.{rowId}.json`；源行 `lines[].ref = L{n}` 与正文对齐、带 `contentSha256`。
- 列类型：`text | number | date | single_select`。
- 改列 prompt/类型 → 清空该列结果；共享列改删有连带确认。
- 导出：每个分析列后跟 `{{name}}_依据` / `_sources`；行格式 `{{lineRef}}：{{summary}}`。

### 3.7 交付

- `present(path)`：产物进画布，返回 `{mode:"deliver", deliveredPaths, failed, preview}`；打开失败要给"文件不存在或尚未同步"这类人话。
- 分享前做**引用闭包校验**（"依赖的源文件 X 不存在，无法完整分享"）——对应你们的交付包完整性检查。

### 3.8 明确不吸收

Powerbase"万物数据项"、飞书主路径、云端系统提示/路由/计费、其云端编排（SpawnSubagent 等）——与本地 agent 无关或不可见。理由见 `docs/LAWMIND-MEWORK-REA-GAP.md` §5。

### 3.9 项目扩展三件套（时间线 / 大事记 / 思维导图）

MeWork 把三张结构化成果物做成"项目扩展"：每张 = 项目根目录一个 JSON 文件 + 一个再生技能（`docs/LAWMIND-MEWORK-REA-GAP.md` §3.4）。三张的 schema 与法律捆绑不深（字段全是通用词汇），是整套能力里**能直接搬到任何行业**的部分：

| 扩展 id      | 技能名            | 根目录文件                     | 定位（MeWork 空态文案）                |
| ------------ | ----------------- | ------------------------------ | -------------------------------------- |
| `timeline`   | `case-timeline`   | `project.case-timeline.json`   | 按时间梳理事件，串联关键节点与来源     |
| `mindmap`    | `case-mindmap`    | `project.case-mindmap.json`    | 展开事项脉络，呈现问题、观点与关联关系 |
| `chronology` | `case-chronology` | `project.case-chronology.json` | 逐项整理重要事实，记录时间、人物与依据 |

**再生纪律**（MeWork 的项目扩展 prompt 模板——整句吸收为产品规则；你们的"新建"与"再生成"都应使用同一句话）：

> 请使用 `{{skill}}` 技能，根据当前项目资料整理`{{name}}`，保存到项目工作目录根目录的 \`{{file}}\`，并交付该文件。如果文件已经存在，请先读取，再按本次要求更新，不另建同类文件；资料不足时先向我确认，不编造内容。

这里抽出的三条可执行纪律：**先读再更新**；**不另建同类文件**（文件名固定，避免同名产物漂移）；**资料不足先确认、不编造**。条目内的出处形态回到 §3.4 的 lineRef（`L{n}` / `P{n}` / `S{n}!A1` + quote）。

**多件一起建**：MeWork 新建项目时允许勾选多件扩展一次生成；做法是"共用上下文、逐项交付"——一条总指令 + 每件一条再生指令（参考实现 §4.15 的批量 prompt 同构）。

---

## 4. 参考实现地图（逐模块）

> 每节格式：**是什么 → 放在哪 → 接口/常量 → 测试 → 移植方式**。路径全部相对本仓库根。"可直接移植"= 本仓库自有代码、纯函数或低耦合，拿走改 import 即可。

### 4.1 officecli 二进制（文档引擎底座）

- **是什么**：Apache-2.0 的 OfficeCLI（GitHub `iOfficeAI/OfficeCLI`，镜像 `https://d.officecli.ai`），随包分发，负责 docx 修订轨写入与 pptx 视觉操作。这解决了"Node.js 生态没有可靠的 docx 变更写入器"这个根问题——照抄这个选型。
- **在哪**：`scripts/vendor-officecli.mjs`（vendoring 脚本：`node scripts/vendor-officecli.mjs [--version 1.0.149] [--arch x64] [--bin path] [--postinstall] [--clean]`，打包进 `apps/lawmind-desktop/resources/officecli/<platform-arch>/officecli(.exe)`，LICENSE+NOTICE 复制在二进制旁）；运行时解析在 `src/lawmind/artifacts/officecli-bin.ts`（顺序：显式参数 → `LAWMIND_OFFICECLI` → `LAWMIND_RESOURCES_PATH` → `LAWMIND_REPO_ROOT` → cwd）。当前 pin **1.0.149**。
- **实际用到的子命令**（全部本仓库验证过）：

| 子命令                                                                                                | 用途                                                   |
| ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `set <file> /body --find … --replace … --prop revision.author=…`                                      | docx 修订轨插入/替换（正则 find 用官方 `r"..."` 前缀） |
| `view <file> stats --json`                                                                            | pptx 页数                                              |
| `view <file> screenshot --page N -o out.png --screenshot-width W --screenshot-height H --render html` | pptx 单页截图（1280×720 默认）                         |
| `query <file> shape --json`                                                                           | 枚举可编辑 shape（`/slide[i]` 路径、文本、坐标）       |
| `set <file> /slide[i]/… --prop text=…` + `save` + `close`                                             | pptx 文本回写                                          |

- **执行壳**：`src/lawmind/platform/safe-command.ts`（`runSafeCommand` + `buildMinimalChildEnv`：超时、stdout/stderr 字节上限、参数数组化、最小子进程 env）。docx 导出超时 120s / stdout 256KB；pptx 预览超时 180s / stdout 4MB。
- **测试**：`src/lawmind/agent/tools/legal/pptx-officecli.test.ts`、`apps/lawmind-desktop/electron/officecli-runtime*`。
- **移植方式**：直接照搬选型 + vendoring 脚本；二进制走你们的发布渠道分发。

### 4.2 Word 修订轨全链（套件的灵魂）

一句话：**在一份已有内容的 docx 上，只改该改的地方，并把改动做成 Word/WPS 标准修订轨（w:ins/w:del），人工接受/拒绝。**

#### 最短改动算法（可直接移植，纯函数）

`src/lawmind/drafts/minimal-edit-script.ts`：

| 常量                                                        | 值             | 含义                                                                     |
| ----------------------------------------------------------- | -------------- | ------------------------------------------------------------------------ |
| `MINIMAL_ANCHOR_CHARS`                                      | 4              | ≥4 字的公共片段才算"没动的字"（3 字以下视为巧合）                        |
| `MINIMAL_EDIT_MAX_UNCHANGED_RUN`                            | 6              | **逐字规则**：一处改动内部夹 ≥6 个连续未改文字 = 未最小化，会被自动拆    |
| `ANCHOR_MAX_CHARS` / `ANCHOR_MAX_OCCURRENCES` / `MAX_SPANS` | 120 / 16 / 400 | 锚点上限；超过 400 段就合并成一段（正确性不降，只保留较少上下文）        |
| `INSERT_ANCHOR_CHARS`                                       | 6              | 纯插入改写成"插入点之后 6 字锚点整体替换"（Word 插件没有"删除"操作时用） |

核心函数 `computeMinimalEditSpans(before, after)`：反复找最长公共片段（锚点）从两侧摘掉后递归；两条可证明性质——每处改动内部不含 ≥4 字未改片段；**回放结果逐字等于 after**。配套审计 `auditMinimalEditSpans`。测试含 **200 组随机对照**（性质测试）+ 单测：`minimal-edit-script.test.ts`。

⚠️ 与长度无关是后来想明白的设计：整句替换（无共同片段）本身合法；罪名是"改动里夹了多少没改的字"。

#### 五道边界（B1–B5）

| 边界             | 位置（本仓库）                                           | 干什么                                                                                                                                                     |
| ---------------- | -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B1 模型输入      | `drafts/apply-surgical-edits.ts`                         | 收 `edits[{find, replace, note?}]` 即重算最短改动；同一 find 命中多处且未声明 `occurrences:"all"` → **整条跳过**                                           |
| B2 hunk 生成     | `drafts/redline-proposal.ts` → `drafts/surgical-diff.ts` | 修订提案（`RedlineHunk`：hunkId/before/after/status/pending…`granularity:"surgical"\|"section"`、`spanStart/spanEnd`；基线 + 排他锁 `.redline.json.lock`） |
| B3 文件落盘      | `artifacts/render-docx-tracked.ts`                       | 把计划写成 officecli find/replace **ops**，从右到左依次落                                                                                                  |
| B4 Word/WPS 插件 | `integrations/word-addin/review-requests.ts`             | 插件就地落改（仅最短锚点；find>60 字不落）                                                                                                                 |
| B5 成品复核      | `drafts/tracked-xml-qa.ts`                               | **唯一看落盘文件**的一道：读回 XML 数 w:ins/w:del                                                                                                          |

三条落盘硬规则（B3，`render-docx-tracked.ts` 的 `resolveOfficeCliFindReplaceOps`）：

1. **从右到左**：officecli 歧义锚用 lookbehind，从右往左落才能保证左侧原文未被破坏。直线代码：`ops.toSorted((a, b) => (b.spanStart ?? 0) - (a.spanStart ?? 0))`。
2. **歧义整处跳过**：多处命中且无法区分 → 该 hunk 整处跳过并记 `multi_match_skipped:<前40字>`，**整处回滚**；回滚失败则整次导出不可交付。禁止"改第一处"。
3. **只读副本先 chmod**：Finder 拷来的 0444 文件 busy 会让 officecli "0 处 applied" 且不报错——落改前 `chmod 0644`，复制副本前再堵一次（此前失败过的运行可能留下只读同名文件）。

B5 成品复核（`drafts/tracked-xml-qa.ts` + `tracked-format-gate.ts` + `xml-qa-auto-retry.ts`）：

| 检查                                                | 门槛                                                                                                                                                       | 失败错误码                                     |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| XML 里确有修订                                      | `MIN_TRACKED_RENDER_HUNKS = 1`（空修订不许导出）                                                                                                           | 导出前的 hunk 门 `redline hunks=N，至少需要 1` |
| 成对"整句删+整句增"                                 | `XML_PAIR_MIN_SIDE_CHARS=12`、`XML_PAIR_MIN_UNCHANGED_RUN=8`、`XML_PAIR_MIN_SHARED_RATIO=0.6`（门槛比内存里的 6 严：officecli 可能把一处替换切成多个片段） | `xml_qa_non_minimal_edits`                     |
| 修订 run 直接格式对齐邻接原稿 run（字体/字号/加粗） | 导出前先 `repairTrackedDocxFormat`（donor：先配对 w:del run，再最近普通 run，绝不跨修订簇借格式），再复核                                                  | `xml_qa_format_mismatch`                       |
| 有 w:ins/w:del                                      | —                                                                                                                                                          | `xml_qa_no_tracks`（自动收窄重试一次）         |

其余要点：

- **三级兜底，都如实标 `degraded`**：officecli 落不上 → 直写 XML `w:del`/`w:ins`（`drafts/docx-visible-revisions.ts`）→ 再不行落"无修订轨副本"。兜底产物不能当"红线已落盘"交付。
- **回执清单**：`.<taskId>.redline-manifest.json` 写在工作区 `cache/redline-manifests/`（不进交付目录），含 `{applied, attempted, ambiguous, lastError}`、`applyStatus`、`openWord:false`。
- **引擎永远不 shell-open Word**（`openWord:false` 是硬决定）；修订作者默认写参考仓库的品牌名（一个字符串常量，照搬时换成你们的产品名/员工名），可按设置换（`--prop revision.author=`，`policy/word-revision-author.ts`）。
- **跨文书一致改**：`drafts/cross-document-edits.ts`——先全批预检，任一份有歧义/超门 → 整批停、零写入；报错自带补救指令（"确为统一替换请对该条显式传 occurrences:'all' 后整批重来"）；找不到锚不算错。
- 输出三条路径：有上传原合同 `contract_file`（拷副本落改，原件一个字节不动，产物 `原名_日期_01.docx`）、退化 `rendered_draft`、普通渲染 `render-docx.ts`（`rejected` 状态拒绝渲染）。

**验收/测试**：`render-docx-tracked.test.ts`、`tracked-xml-qa.test.ts`、`tracked-format-gate*`、`surgical-*` 全家、`cross-document-edits`。

### 4.3 docx 渲染与版式

- `src/lawmind/artifacts/render-docx.ts`（结构化模板渲染）+ `docx-legal-typography.ts` / `docx-thesis-styles.ts`（段距、目录、行网格、三线表）+ `docx-thesis-figures.ts`。
- 模板变体（内置，不收上传模板）：`word/legal-memo-default`、`word/contract-default`、`word/demand-letter-default`、`word/research-report-default`（学位论文正文版式）。
- 文件命名与落点：`artifacts/matter-word-delivery.ts`——`标题_YYYYMMDD_01`，先剥旧日期戳（`_\d{8}(?:_\d{2})?(?:_\d{6})?$`）、词干 ≤160 字、序号 ≤99、**不用任务哈希当文件名**。落点顺序（`artifacts/default-output-location.ts`，第一个匹配赢）：律师点名的白名单文件夹（Desktop/Downloads/Documents，**不是**全盘写）→ 显式路径 → 源文件旁边 → `cases/<matterId>/artifacts/` → 项目目录 → 工作区 `artifacts/`。永不覆盖源文件。

### 4.4 xlsx 读写与桌面预览（可直接移植）

`src/lawmind/agent/tools/legal/xlsx-workbook.ts`（ExcelJS 封装）+ `xlsx-preview.ts`（样式读取）：

| 常量                                              | 值        |
| ------------------------------------------------- | --------- |
| `MAX_XLSX_READ_BYTES`                             | 20MB      |
| `MAX_XLSX_SHEETS` / `MAX_XLSX_ROWS_PER_SHEET`     | 32 / 5000 |
| `MAX_XLSX_PREVIEW_ROWS` / `MAX_XLSX_PREVIEW_COLS` | 8 / 64    |
| `MAX_XLSX_WRITE_CELLS`                            | 80,000    |

- **给 agent 的读取**：`loadXlsxWorkbook`（值级，无公式求值）、`loadXlsxAsTsv`（analyze 路径）。列类型推断 `number/date/text`（date 识别 `YYYY-MM-DD` 与 `YYYY/M/D`）。
- **给桌面的预览**：`LoadedXlsxPreview`——逐 sheet 返回 cells（含 rs/cs 合并）、样式（bg/color/bold/字体/hAlign/vAlign/wrap/border）、**列宽像素**、行高像素；SpreadsheetML 主题色解析（`SPREADSHEET_THEME_TO_SCHEME`）。桌面 `XlsxFileView.tsx` 渲染。
- 工具：`analyze_spreadsheet`（列名/类型/行数/空值/数值列 min-max-sum-avg/preview，`spreadsheet-tools.ts`）与 `write_spreadsheet`（首行=列名，未指定路径走 §4.3 的落点规则，sheet 名 ≤31 字）。
- **分析表 xlsx 导出**（`src/lawmind/deliverables/review-table.ts`）：每个分析列后插 `{{列名}}_依据` 列，行格式 `lineRef：summary`（`reviewTableToXlsxRows` / `cellProvenance`），另有逐格出处独立 sheet（`reviewTableProvenanceXlsxRows`），与 MeWork `{{name}}_依据` 同构。

### 4.5 pptx 生成 / 视觉预览 / 改写

- **生成**：`src/lawmind/artifacts/render-pptx.ts`（pptxgenjs ^4.0.1，MIT）——结构化布局（agenda/bullets/two-column/matrix/checklist），不是整页文本框；来自交付物类型 `ppt.*`；命名 `标题_YYYYMMDD_01.pptx`。
- **视觉预览**：`src/lawmind/agent/tools/legal/pptx-officecli.ts`——`view stats --json`（页数）→ `query shape --json`（可编辑 shape，`/slide[i]` 格式；上限 `MAX_SLIDES=80`、`MAX_EDITABLE_SHAPES=200`）→ 供"按页截图 + 每个 shape 可改"。截图 `renderPptxSlideScreenshot`（默认 1280×720，`--render html`）；缓存 `sha1(abs\0mtime) 前 24 位`，落 `cache/pptx-preview/<key>/slide-N.png`。
- **文本回写**：`applyPptxTextEdits`——逐条 `set <abs> <shapePath> --prop text=<t>`（text ≤8000 字符，CRLF 归一），随后 `save` + `close`（失败不 block）。失败即抛错，不静默跳过。
- 旧文本抽取路径 `pptx-preview.ts` 仍在，但视觉路径是现在的产品面。

### 4.6 PDF

- **docx→PDF**：`src/lawmind/drafts/docx-export-pdf.ts`——LibreOffice `soffice --headless --nologo --nolockcheck --convert-to pdf --outdir <tmp>`（候选 `soffice`/`libreoffice`/`/Applications/LibreOffice.app/Contents/MacOS/soffice`），走 `RESOURCE_LEASE_SOFFICE` 资源租约（`src/lawmind/runtime/turn-admission.ts`，防多任务并发抢转换器）、120 秒超时；产物拷到源文件同目录同名 `.pdf`，三重校验（存在/非空）。**没有 soffice 时如实失败，不出"只有正文"的替身。**
- **PDF 页锚**：`evidence-locator` 支持 `P{n}`（§4.8）；渲染端 `PdfFileView.tsx`。
- **摄取**：`ingest-helpers.ts`——`pdf-parse` 文本层 → 空则本地 OCR（前 12 页）→ 仍空且配了视觉端点再走视觉；`LAWMIND_OCR_BUDGET_MS` 默认 90s，三环**共用一份预算**、任一环报错不断下一环（详见 `docs/lawmind/LAWMIND-DOCUMENT-INGEST.md`）。

### 4.7 .doc 旧格式（读正文不依赖 LibreOffice；转 .docx 用它兜底）

- **读正文**：`src/lawmind/mail/read-word-binary.ts`——进程内 OLE 复合文档解析（FIB + piece table），顺带读出修订的作者/时间/删插。快、无依赖。
- **出 .docx**：`src/lawmind/mail/convert-with-word.ts`——让**员工本机已装的 Word 另存**，保真（页眉/页脚/表格/图片/编号/已有修订全带过来）。关键技巧：Word for macOS 是沙盒应用，把文件**暂存进 Word 自家容器**（`~/Library/Containers/com.microsoft.Word/Data/Documents`，老布局退 `tmp`）再 AppleScript 打开，**授权框不会弹**；`display alerts to alerts none` 压住修复框；**不调 `activate`**（不抢焦点）；按名字倒序关文档，绝不 close by index；三重校验（ZIP 头 + `word/document.xml` + 非空）。
- 兜底：LibreOffice headless；两个引擎都没有 → **硬失败**，明确告知需要 Word 或 LibreOffice。
- 读不出时错误码 `doc_needs_docx`（`mail/doc-revision-gate.ts`；多为加密/Word 6/95/损坏）。
- 明确不做：已在 WPS 里打开便利另存的作业队列（要求员工装加载项且开着 WPS，批处理反复被打断）——本仓库已删掉这条路线，新 agent 也不要走它。
- **颜色注意**：`w:ins/w:del` 只存 author/date，无颜色字段；WPS/Word 打开时按作者名分配调色板（显示层行为，不是转换丢字段）。

### 4.8 证据锚 + 出稿闸门（对 MeWork §3.4/3.5 的实现，可直接移植）

- `src/lawmind/drafts/evidence-locator.ts`（无 I/O 纯函数）：lineRef 五类形态互相解析/格式化（`L{n}`、`L{n}-L{m}`、`P{n}`、`S{n}!A1`、`S{n}!A1:B2`）；`splitPathAndLocator` 处理 `path#lineRef`。
- `src/lawmind/drafts/evidence-anchor.ts`（对 MeWork `ValidateFileReferences` 的同构实现，规格吸收、不拷代码）：

```ts
validateFileReferences({
  rootDir,
  sourceFiles: [{ path, contentSha256 }],   // 小写 hex sha256
  references: [{ id, filePath, lineRef, text }], // text = 原文 quote
}) -> { status, summary: { total, passed, failed, incomplete }, issues }
```

（MeWork 侧同型的服务端点是 `/api/v1/desktop/validate-file-references`、协议名 `mework-file-references v1`、schema v2——见 `docs/LAWMIND-MEWORK-CODE-REVIEW.md` §F.4；它当时由前端壳调云端执行，本地化替代就是本函数。）

- 状态机：`FAILED`（缺指纹 / lineRef 解析不了 / 文件不在 / 指纹不一致 / quote 不符）→ 修复重试；`INCOMPLETE`（缺 quote / `P{n}`、`S!` 等富解析器未接 / 非纯文本）→ **不算通过**。全部通过且无 issue 才 `PASSED`。
- 配套：`fileReferencesBlockExport()`——非 PASSED 就**挡正式导出**；`checkEvidenceSupport`（`drafts/evidence-support.ts`）做路径围栏 + 文件版本（`runtime/file-version.ts` 的 `size:mtimeMs:sha256`）+ 行区间 quote 对读。
- 交接：`drafts/citation-file-refs.ts` 把 research snapshot 的 `path + sourceVersion + pin + #L` 收集进锚点。

### 4.9 沙箱计算与图表

- `run_compute`（`src/lawmind/agent/tools/legal/run-compute-tool.ts`：source ≤80,000 字符；高安全模式禁用）：受控沙箱里跑 JS，可用 API 是**白名单**：`listFiles(dir,{recursive})`、`readText(path)`、`readTable(xlsx)`、`readCsv`、`readJson`、`stats`、`writeTable(xlsx)`、`writeText(path,内容)`、`emitChart`；无 require/fs/fetch。这是"批量整理 200 份材料"的正确入口（不要让 agent 逐文件调工具）。
- `render_chart`（`chart-tool.ts` + `chart-spec.ts` + `chart-svg.ts`）：声明式 JSON spec（`title/type/categories/series` + 可选 `unit/source/notes`；type 支持 `bar/line/pie/stacked_bar`）；落 `artifacts/charts/<id>.json`；**助手正文必须用 `lm-chart` 围栏把 spec JSON 原样贴回**（用一对三反引号标记 + 语言名 `lm-chart`），让用户复核的是语义规格而不是像素图——这条产品纪律值得整段照抄。

### 4.10 只读比对

`compare-documents.ts`：`file_a/file_b`（相对路径）→ 行级 diff；`MAX_COMPARE_LINES=4000`、`MAX_HUNK_SAMPLES=40`、单行截断 200 字；返回 `{identical, added, removed, hunks, truncated}`。原则：**只读对比不一手改稿**（要改走 apply_surgical_edits）。

### 4.11 桌面内 Word 审阅面（应用内"像 Word 打开"）

`src/lawmind/drafts/word-surface.ts` + `word-revision/*` + `artifacts/render-docx-tracked-multi-author*`，桌面 UI `apps/lawmind-desktop/src/renderer/file/LawmindWordRevisionSurface.tsx`：

- 解析实际 docx 的 `w:ins/w:del/move/rPr`，按作者上色（Word 的调色板循环：**文件不存颜色**，第一个作者红、下一个蓝、循环）。
- 律师动作的语义：对**自己署名**的修订，接受 = 折叠痕迹但文件里仍是修订轨（另存审阅稿重新打开仍能看到这条修订）；拒绝 = 从正文和导出拿掉；落态写进 `word/lawmind-disposition.xml`（**不写回 w:ins/w:del**）。
- 保存直接写回正在打开的那份文件；"另存审阅稿"是拷副本。
- 他人的修订只读（展示、不接受拒绝）；默认只显示一行「作者 · 删除/插入/格式」。

### 4.12 格式体检与修复（Word 格式灰域）

`src/lawmind/drafts/document-format-audit.ts`（L1 只读体检）+ `format-fix.ts` / `format-audit-tool.ts` / `format-fix-tool.ts` + 桌面 `WordFormatAuditPanel.tsx`：

- 三种口径（顺序不能混）：`from-scratch`（按国标起草）/ `imported`（外来件，以文件自身主流格式为准，不套模板）/ `retemplate`（用户明确要求整体重排）。
- 规则基线：GB/T 9704-2012 草案（`GB_T_9704_NOTICE_ZH` 位置注释：**【待律师确认】**——你们可换成贵司的公文/合同模板基线但保留"规则表可替换"结构）。
- 关键常量：A4 版心 margin 37/26/35/28mm、正文仿宋 16pt（3号）、行距 28 磅（允许 26.5–30）、首行缩进 2 字、标题小标宋 22pt 居中、一级标题黑体/二级楷体/三级仿宋。
- 原则：**不检查的项写进 `unchecked`，不假装通过**。

### 4.13 文件工作台工具（改位不内容）

`workspace-file-ops-tool.ts` + `workspace-file-ops.ts`（`apply_file_ops`）：工作区内搬移/改名/复制 **不改内容、不删除**，可撤销（`desk-writes.jsonl` 台账 + `revert_desk_write` 兜底）。对应 MeWork"替员工整理电脑文件"的场景。

### 4.14 前端 Markdown/文件面

- `lawmind-chat-markdown-math.ts`：公式行内 `\(...\)` / 块 `\[...\]` 渲染（做工程师/业务文档时同样用得上）。
- `file-tab-layout.ts` / `preview-registry.tsx`：中栏按 kind 分发到 Doc/Pdf/Xlsx/Pptx/Eml/Zip/Image 预览面板；公共动作是「在对话中引用 / 在访达中显示（Finder/资源管理器）/ 用本机应用打开（WPS）」。

### 4.15 案件/项目三件套（时间线 / 大事记 / 思维导图）— 对 §3.9 的实现，推荐整块照搬

三件套 schema **与行业无关**：把"案件"换成"项目 / 工作卷"就是一张通用 agent 的结构化交付物；kind 语义词（`issue/fact/party/evidence`）只是默认标签，建议你们映射成自己的分类。模块分工：

| 模块       | 文件（本仓库）                                                         | 干什么                                                                                     |
| ---------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| 纯模型     | `src/lawmind/deliverables/matter-artifact-model.ts`                    | 类型、宽容归一化、按年分组、**确定性脑图布局**（无 node/fs 依赖，渲染层可直接 import）     |
| 磁盘读写   | `src/lawmind/deliverables/matter-artifact.ts`                          | 读三件套 + upsert/replace 写入（同目录 tmp + rename 原子写）                               |
| 再生纪律   | `src/lawmind/drafts/matter-artifact-regen.ts`                          | 三件套常量、单件再生 prompt、批量 prompt                                                   |
| agent 工具 | `src/lawmind/agent/tools/legal/matter-artifact-tool.ts`                | `matter_artifact_update`（写入工具，见下）                                                 |
| 只读接口   | `apps/lawmind-desktop/server/lawmind-server-route-matter-artifacts.ts` | `GET /api/matters/:id/artifacts`；**桌面不提供编辑接口——避免第二个真相源**（代码注释原话） |
| 渲染       | `apps/lawmind-desktop/src/renderer/LawmindMatterArtifactPanel.tsx`     | 时间线用 DOM（`lm-timeline*`）、思维导图纯 SVG                                             |

**JSON schema**（`schemaVersion: 1`，`kind` 即 skill id；真相源是项目可见根目录 `cases/<matterId>/project.case-*.json`，桌面与 agent 读的是**同一份文件**）：

- `case-timeline`：`{ events: [{ id?, date, title, summary?, kind?（fact|procedure|dispute|evidence|other）, evidence: [{filePath, lineRef?, quote?}] }] }`
- `case-chronology`：`{ entries: [{ id?, date, fact, people?: string[], evidence: […] }] }`
- `case-mindmap`：`{ root: { id?, label, kind?（issue|fact|party|evidence|other）, children: [递归] } }`，**最多 6 层**（超限截断并记 issue）

每条 `evidence` 与 §4.8 证据锚同语法（`filePath + L/P/S lineRef + quote`）；没有出处的条目在桌面标「待补出处」，模型收到的回执会明说"有 N 项没有出处，请补充 evidence 后再次 upsert"——**这是把 §3.4 证据锚贯彻到三件套的关键机制**。

**日期归一化**（`normalizeMatterDate`，可直接移植）：认 `2026-03-01`、`2026/3/1`、`2026年3月1日`、`2026-03`、`2026年3月`、`2026年` 六类写法；产出 `{sortKey: "20260301", displayDate}`；认不出返回 null → 该条记 issue 后跳过，**不猜**。月/日超 12/31 也算识别失败。

**写入纪律**（`writeMatterArtifact`，含 B5 式硬约束，注释里写明了来源）：

1. **空载荷拒绝落盘**——宁可保留旧文件，也不用空表覆盖已整理好的成果；
2. **默认 `upsert`**——条目合并键 = id（缺省 `日期|标题` / `日期|事实`），律师看过的锚不会被无锚版本冲掉；`replace`（整份覆盖）要显式传，只用于律师明确要求重做；
3. **原子写**——同目录 tmp + rename，避免半截 JSON 被读；
4. **宽容归一化**——坏条目逐条记 `{path, reasonZh}` 后丢弃，不让一处脏数据拖垮整张图。

**思维导图布局**（`layoutMatterMindmap`，纯函数、确定性——同输入同坐标，可做快照测试）：左→右分层；列宽取该层最宽节点（估宽：CJK 记 2 单位、ASCII 记 1 单位，节点宽 clamp 在 72–220px）；y 由先序遍历确定、父节点垂直居中于子节点。常量：节点高 30、行距 10、列距 32。渲染不引 mermaid 全谱，SVG 只画不排。

**工具契约**（`matter_artifact_update`，照搬时改名）：`matter_id`（缺省绑当前案件）+ `kind`（三选一）+ `mode`（默认 upsert）+ `title?` + 数据（`events` / `entries` / `root`）；`requiresApproval: false`（写入走留痕，与套件的写类口径一致）；返回 `itemCount / anchoredCount / unanchoredCount / changed / yearFrom / yearTo / issues`，外加人话 `lawyerMessage`。

**测试锚点**：`matter-artifact.test.ts`、`matter-artifact-regen.test.ts`、`matter-artifact-tool.test.ts`（与实现同目录）。

---

## 5. WPS 宿主集成（现状 + 规格 + 移植建议）

### 5.1 用本机 WPS 打开文件

- 主进程 `apps/lawmind-desktop/electron/safe-shell-command.mjs`：`safeOpenWithWps(absPath, workspaceDir)`——命令白名单（macOS `open` / win `explorer`/`start` / Linux `xdg-open`）、绝对路径校验拒 `..`、参数数组化；WPS 固定 **`com.kingsoft.wpsoffice.mac`**（`/usr/bin/open -b <bundle-id> -- <abs>`）；仅 macOS；失败直接报"请先安装 WPS，再用它打开这份文件"，**不改走系统默认应用**；每次调用写审计事件 `open_with_wps`（`workspace/audit/<yyyy-mm-dd>.jsonl`，含 exitCode/durationMs/error）。
- 渲染层 `apps/lawmind-desktop/src/renderer/canvas/host-actions.ts` 的 `openDeliverableInWps(relPath, preferredRoot)`：先试 `workspace` 再试本机 `project` 根（顺序可按用户入口翻转）；路径先过 `wpsDeliverablePath` 白名单（定义在 `src/lawmind/sources/lawyer-chat-link.ts`）；IPC 名 `lawmind:open-with-wps`。
- ⚠️ 参考仓库的产品现在只在"异常格式"允许走这条路（§0 现状校准）。你们既然把 WPS 当目标宿主，保留并放宽为正式入口即可——但审计、路径守卫、失败人话文案这三件要照搬。
- Windows 没有对应 `safeOpenWithWps`：要支持 WPS for Windows，需另写（建议：注册表定位安装路径 + `explorer.exe <path>` 或 `start /b <path>`，同样走白名单 + 审计）。

### 5.2 Word / WPS 加载项（半成品，含全部已知坑）

架构（`docs/lawmind/LAWMIND-WORD-ADDIN.md` + `src/lawmind/integrations/word-addin/*` + `apps/lawmind-desktop/server/lawmind-server-route-word-addin.ts`）值得整个照抄——它是一套**独立于 Chat UI 的"在编辑器里就地改"协议**：

1. 任务窗格由本机回环服务渲染（`/word-addin/taskpane.html|taskpane.js|taskpane.css|config.js|manifest.xml`）；数据面 `/api/word-addin/*`，**只走回环 + Bearer**（凭据从同源 `config.js` 拿，CSP 不允许内联脚本）。
2. 流程：窗格输入框「按本所标准审这份」→ `POST /api/word-addin/reviews` → 桌面端**自动取件开跑**（同一套 apply_surgical_edits → render_tracked_draft）→ 回填锚点 → 律师点「写入这一处 / 写入并加批注」→ **Word/WPS 里落成原生修订轨**。
3. 状态机 7 态：`queued/running/ready/failed/stale/superseded`（旧 `needs_matter` 已弃）；取件时按**内容指纹**判 stale（>2MiB 取头 128KiB + 尾 64KiB + 字节数）；同文件同指令 10 分钟窗口去重（**绝不折 running**，模型钱已花）；孤儿 30 分钟转 `failed`（失败原因映射成人话）。
4. 侧载：Word mac `~/Library/Containers/com.microsoft.Word/Data/Documents/wef/`；WPS mac `~/Library/Containers/com.kingsoft.wpsoffice.mac/Data/.kingsoft/wps/jsaddons/`（同一次登记写 `publish.xml`）。WPS 端 ribbon 在 `resources/word-addin/wps/main.js`（`Application.CreateTaskPane`），`wps/host.js` 在 taskpane.js 之前标 `window.LAWMIND_ADDIN.host = "wps"`，让页面**不走 Word.run**、落修订走 WPS 自己的修订接口。
5. **验收状态（诚实档案）**：Word 侧有假 Word 驱动的回归（`apps/lawmind-desktop/src/renderer/word-addin-taskpane.test.ts`：Word.js 队列式 API 的 load/sync 顺序、多处命中不落改），但**本机真机 Word/WPS 验收、Windows 登记路径、可公证安装包都没完成**——照抄管线，用你们自己的测试环境验收后才能算交付。

真机踩坑实录（每一条都贵）：

| 坑                        | 结论                                                                                                                                                                                  |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `localhost` ≠ `127.0.0.1` | Office/WPS 宿主用 `localhost` 时先试 `::1`；回环服务**必须 IPv4+IPv6 双绑**                                                                                                           |
| 凭据不能内联              | `<script>` 内联被 CSP `script-src` 拦 → 401；凭据走同源 `config.js`（`'self'` 放行），且须先于 `taskpane.js` 加载                                                                     |
| 端口漂移                  | 侧载清单把端口**钉死**；端口变化唯一可自证的信号是服务端日志里有没有 `GET /word-addin/taskpane.html` 的来访记录——清单填好 ≠ 链路通                                                    |
| Word.js 是队列式 API      | 属性/集合先 `load()` + `context.sync()` 才能读；落改固定顺序：读修订轨设置 → sync → 开修订轨 → sync → 逐锚点 search/load/sync → **恢复律师原有修订轨设置** → sync（恢复这步最容易漏） |
| 锚点唯一性                | 同锚点多处命中→ 不落改，如实回报；Word.js 无"删除"语境的纯插入用 6 字锚点整体替换表达（§4.2 INSERT_ANCHOR_CHARS）                                                                     |
| http vs https             | 微软宿主要求受信来源；若宿主内置 webview 拒 `http://localhost`，上 `https://localhost` + 本机证书（本仓库未做，采集到真机证据后再定）                                                 |

### 5.3 给你们项目的建议

- **L0–L6 全做**（§1 表格），这是"agent 能干 WPS 活"的主体。
- **L7 做「用 WPS 打开」+ 桌面内预览面**；Word/WPS 加载项放二期，先签真机验收清单（打开加载项→审查→写入是修订而非无痕替换→接受/拒绝），别复刻参考实现"半成品上讲成品话"的教训。
- WPS 特有：页数统计与单页截图走 officecli，不需要 WPS SDK；`S{sheet}!A1` 定位、`P{n}` 页锚在 WPS 打开的文件上与 MS Office 行为一致（都是 OOXML），风险主要在 `.doc`/`.xls` 旧二进制（见 §4.7 的 WPS 另存路径被本仓库放弃的记录——用「Word 另存 + soffice 兜底」更稳）。

---

## 6. deepseekharness 落地路线

### 6.1 推荐工具表（WPS 套件部分）

约定：**每个工具第一个参数是 `purpose`**（一句中文动宾短语，给审查/放行人看——MeWork 的 auto 档所有 `run_command` 都带着 purpose 走云端审查并给人话理由，实测能撑住；见 `docs/LAWMIND-MEWORK-CODE-REVIEW.md` §2.3/§4.1）。只读幂等工具可并行；写类单独排队。

| 工具名                                      | 参数要点                                                                                 | 来源实现                                                                                  | 风险                                  |
| ------------------------------------------- | ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------- |
| `analyze_document`                          | `file_path`（相对工作区）                                                                | `legal-tools.ts` + `ingest-helpers.ts`                                                    | 只读                                  |
| `analyze_spreadsheet` / `write_spreadsheet` | path、sheet / rows 首行列名                                                              | `xlsx-workbook.ts` + `spreadsheet-tools.ts`                                               | 读 / 写                               |
| `read_project_file` / `write_document`      | 路径 / 相对路径+内容                                                                     | `runtime/workspace-io-fence.ts`                                                           | 读 / 写                               |
| `apply_surgical_edits`                      | `task_id`、`edits[{find,replace,note?,occurrences?}]`                                    | §4.2 B1–B5 全链                                                                           | 写（审计）                            |
| `render_tracked_draft`                      | `task_id`、可选 `contract_file`                                                          | `artifacts/render-docx-tracked.ts`                                                        | 写                                    |
| `export_pdf`                                | source docx                                                                              | `docx-export-pdf.ts`                                                                      | 写                                    |
| `compare_documents`                         | file_a、file_b                                                                           | §4.10                                                                                     | 只读                                  |
| `render_chart`                              | spec JSON                                                                                | `chart-tool.ts`                                                                           | 写                                    |
| `run_compute`                               | source（JS 白名单）、purpose                                                             | `run-compute-tool.ts` + `analysis-sandbox.ts`                                             | 写（沙箱）                            |
| `validate_file_references`                  | sources + references（§3.5 schema）                                                      | `evidence-anchor.ts`                                                                      | 只读，**一等工具**                    |
| `present` / deliver                         | 产物路径清单                                                                             | `deliverable-chat-links.ts`、`named-deliverable.ts`                                       | 交付                                  |
| `matter_artifact_update`                    | `kind`（timeline/chronology/mindmap 三选一）、`mode`（默认 upsert）、events/entries/root | `deliverables/matter-artifact*.ts` + `agent/tools/legal/matter-artifact-tool.ts`（§4.15） | 写（留痕；upsert 不覆盖律师改过的锚） |
| `open_in_wps`                               | 相对路径 + root                                                                          | §5.1                                                                                      | 外部程序（审计）                      |
| `apply_file_ops`                            | 移动/改名/复制计划                                                                       | `workspace-file-ops-tool.ts`                                                              | 写（可撤销）                          |

**工具表指纹纪律**：上表全部常驻（或按会话固定子集），不要按轮增删；"加载项/宿主类"工具放进与本人权限绑定的一次性披露，而不是每轮变化。

### 6.2 请求体纪律（DeepSeek 特化）

- 可复现是审计口径不是体验承诺（DEEPSEEK-STACK-REVIEW §5.4）：会话级打开 `reproducible` 时 temperature 0 + 固定 seed（上游支持时）+ 结构化输出约束；把采样参数、模型 id、工具表指纹写进审计 envelope。对外口径写清「同参数同输入」，不承诺跨模型版本一致。
- 缓存块粒度 ~64 token：改一个字 = 从那一块开始整段失效。写文档/改系统提示时按块评估。
- 首轮固定税单独观测（系统提示 + 工具 schema）；`fixed/cached/uncached` 三个数进日志。

### 6.3 分阶段验收

| 阶段 | 内容                                                                    | 验收（不做完不算数）                                                                                                                |
| ---- | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| P0   | 文件基座 + 路径围栏 + 指纹 + 审计                                       | 越权路径全拒；TOCTOU 测试（symlink 替换）通过                                                                                       |
| P1   | 摄取（docx/pdf/xlsx/图片 OCR/**.doc** 读）                              | 模型拿到的正文与肉眼一致；20MB/5000 行/32 表上限如约截断并**明示**                                                                  |
| P2   | xlsx/pptx/pdf 预览 + `analyze_*` + `write_spreadsheet` + `render_chart` | 桌面预览与 ExcelJS 值一致；写表 >80k 单元格被拒                                                                                     |
| P3   | docx 修订轨全链（§4.2；含 `compare_documents`）                         | 合同数十处改动：**回放=原文**、B5 复核 0 告警、歧义 0 落改、degraded 不冒充                                                         |
| P4   | 证据锚 + validate 闸门 + 定位回跳                                       | PASSED 才出稿；指纹漂移被检出；`P{n}`/`S!` 未接前**如实 INCOMPLETE**                                                                |
| P4.5 | 三件套（时间线 / 大事记 / 思维导图）                                    | 再生纪律生效（先读再更新、不另建、空载荷拒）；无出处条目如实标「待补出处」；`layoutMatterMindmap` 快照不变；6 层截断 + issue 单返回 |
| P5   | 交付（pdf/.doc→docx/命名/待发信）                                       | 无 soffice/无 Word 时硬失败 + 人话文案；双格式文件名稳定可复现                                                                      |
| P6   | 宿主（open_in_wps + 可选加载项）                                        | 打开交给 WPS 有审计；加载项真机验收后才对外说                                                                                       |

### 6.4 安全与合规模块（直接抄清单）

- 路径围栏 + TOCTOU：`runtime/workspace-path.ts` / `workspace-io-fence.ts`
- 最小子进程 env + 命令白名单：`platform/safe-command.ts`（引擎侧）+ Electron 侧 `electron/safe-shell-command.mjs`；**负清单教训**（MeWork 拆包发现的反例，写进你们的安全基线）：loopback = 本机用户 ≠ 可信，`/localfs` 无鉴权是事故温床
- 资源租约：`runtime/turn-admission.ts`（`RESOURCE_LEASE_SOFFICE` / `RESOURCE_LEASE_WORD`），防多任务并发互抢转换器
- 审计事件：`src/lawmind/audit/index.ts`（HMAC 链 + root anchor 在 `audit/hash-chain.ts`、`root-anchor.ts`——你们做公司合规台账正好用）
- 本机访问负清单：`host-access/deny-list.ts`
- 外发门（如需给 agent 加/改文件，公司台机例外面）：`platform/outbound-approval-binding.ts` 思路——**审批绑定内容哈希**，任何改动使批准失效

### 6.5 测试策略

1. **性质测试**：最小改动算法 200 组随机（before/after → 回放=after + 审计 0 违规）。
2. **B5 复核型测试**：不信任内存里的计划，读回落盘 XML 断言。所有"写 PowerPoint/Word 的链路"都要这道。
3. **MeWork 同构的卡带测试**（agent 行为）：`validate` 不 PASSED 不出稿、续跑后 tools 指纹不变、purpose 缺失被拒。
4. **真机验收**：Word/WPS 各一台（最好 mac+win 双平台），P3/P6 的每条验收过一遍手指的人机交互。

### 6.6 已知坑汇总（移植最容易翻车的 12 条）

1. 从右到左落修订不是可选项（§4.2）。
2. 歧义锚永远整处跳过，**禁止"改第一处"**。
3. 0444 只读文件会让 officecli "0 处 applied"且不报错——先 chmod。
4. 红线落盘必须读回 XML 复核；内存里的计划 ≠ 落盘事实。
5. 修订 run 要继承邻接原稿的直接格式（WPS/Word 打开后字体突变=事故）。
6. `L{段}` 是 docx **段落号**，不是行号；`P{n}` 是 PDF **页**；`S{n}!A1` 是 A1 记法的单元格——三种语义别映射到同一个 "lineIndex"。
7. 富解析器（PDF 页、Excel 单元格）未接入前 `validateFileReferences` 必须给 `INCOMPLETE`，不许"看起来通过"。
8. `w:ins/w:del` 不存颜色；按作者分色是打开方的显示行为。
9. `.doc/.xls/.ppt` 旧二进制不做直接解析：明确报"请另存为 .docx/.xlsx"，`.doc` 走 Word 另存通路（§4.7）。
10. officecli 不能并发抢同一文件——转换器/写入租约要有。
11. 加载项/端口的所有"线路通没通"只能用服务端来访日志自证，别信 UI 报错文案。
12. 引擎永远不要 shell-open Word/WPS 弹窗——用户自己开（`openWord:false` 是刻意决定）。

---

## 7. 依赖与许可账本

| 依赖                  | 版本        | 许可                                  | 用途                     | 注意                                                         |
| --------------------- | ----------- | ------------------------------------- | ------------------------ | ------------------------------------------------------------ |
| OfficeCLI             | pin 1.0.149 | Apache-2.0（随包分发 LICENSE+NOTICE） | docx 修订写入、pptx 视觉 | pin 版本 + 每次升版过回归                                    |
| exceljs               | ^4.4.0      | MIT                                   | xlsx 读写                | 主进程动态 `import()`                                        |
| jszip                 | ^3.10.2     | MIT                                   | OOXML 解包               | docx 抽文用它（非 mammoth，保轻量）                          |
| pptxgenjs             | ^4.0.1      | MIT                                   | pptx 生成                | —                                                            |
| pdf-parse             | ^2.4.5      | MIT                                   | PDF 文本层               | OCR/视觉兜底在后面                                           |
| tesseract.js          | ^7.0.0      | Apache-2.0                            | 图 OCR                   | 语言包按需下载 + `LAWMIND_OCR_DATA_DIR` 可指定已训练包离线用 |
| LibreOffice (soffice) | 系统外装    | MPL-2.0                               | docx→PDF、**不随包分发** | 无系统安装=硬降级口径                                        |
| Microsoft Word/WPS    | 本机已有    | 商用（不分发）                        | .doc 另存 / 打开         | 沙盒容器暂存技巧见 §4.7                                      |

`package.json` 与 `apps/lawmind-desktop/package.json` 为准；上面列全部都在根依赖里。

---

## 8. 证据索引（哪些结论来自哪份文档）

| 本文小节                           | 来源文档（本仓库）                                                                                                                                                                                                                                            |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| §0 名词与边界、§3 全部 MeWork 规格 | `docs/LAWMIND-MEWORK-CODE-REVIEW.md`（实机拆包）、`docs/LAWMIND-MEWORK-REA-GAP.md`（规格补证）、`docs/LAWMIND-MEWORK-COMPETITOR-REVIEW.md`（公开口径）、`docs/LAWMIND-REA-TARGET-MAP.md`（吸收规则 + §0.1 产品边界）                                          |
| §2.2 DeepSeek 纪律                 | `docs/LAWMIND-DEEPSEEK-STACK-REVIEW.md`                                                                                                                                                                                                                       |
| §4 全部参考实现                    | 代码 + `docs/lawmind/manual/08-drafting-and-redline.md`（第 8 章，改稿红线全链）、`docs/lawmind/manual/23-tools-reference.md`（工具契约）、`docs/lawmind/LAWMIND-DOCUMENT-INGEST.md`（摄取矩阵）、`docs/lawmind/LAWMIND-WORD-ADDIN.md`（加载项现状与踩坑）    |
| §5.2 真机踩坑                      | `docs/lawmind/LAWMIND-WORD-ADDIN.md`（2026-09-20/21 实测记录）+ 代码注释里 2026-09-20 CSP 实测                                                                                                                                                                |
| §6.4 安全模块                      | `SECURITY.md`、`docs/lawmind/LAWMIND-HOST-ACCESS.md` + MeWork 拆包附录 F.2（负面对照）                                                                                                                                                                        |
| §3.9 / §4.15 三件套                | `docs/LAWMIND-MEWORK-REA-GAP.md` §3.4 + `src/lawmind/deliverables/matter-artifact-model.ts` / `deliverables/matter-artifact.ts`（写入纪律与布局注释）、`src/lawmind/drafts/matter-artifact-regen.ts`、`src/lawmind/agent/tools/legal/matter-artifact-tool.ts` |

---

## 附录 A · 模块 → 文件速查（本仓库）

**agent 工具（`src/lawmind/agent/tools/legal/`）**：`file-tools.ts`（analyze_document）、`ingest-helpers.ts`（docx/pdf/OCR/xlsx TSV）、`xlsx-workbook.ts`、`xlsx-preview.ts`、`spreadsheet-tools.ts`、`pptx-officecli.ts`、`pptx-preview.ts`、`chart-tool.ts`/`chart-svg.ts`/`chart-spec.ts`、`compare-documents.ts`、`run-compute-tool.ts`/`analysis-runner.ts`/`analysis-sandbox.ts`/`analysis-sandbox-child.ts`/`compute-deliverable.ts`、`format-audit-tool.ts`/`format-fix-tool.ts`、`workspace-file-ops-tool.ts`/`workspace-file-ops.ts`、`review-table-tool.ts`、`read-folder-documents-tool.ts`、`matter-artifact-tool.ts`（三件套写入，§4.15）；工具表治理在 `src/lawmind/agent/tool-name-sets.ts` + `tools/governance.ts`

**drafts（`src/lawmind/drafts/`）**：`minimal-edit-script.ts`、`apply-surgical-edits.ts`、`surgical-diff.ts`、`surgical-span-gate.ts`、`surgical-edit-gate.ts`、`redline-plan.ts`、`redline-proposal.ts`、`contract-edit-baseline.ts`、`contract-redline-craft.ts`、`cross-document-edits.ts`、`tracked-render-hunk-gate.ts`、`tracked-format-gate.ts`、`tracked-xml-qa.ts`、`xml-qa-auto-retry.ts`、`docx-visible-revisions.ts`、`docx-export-pdf.ts`、`docx-size.ts`、`format-fix.ts`、`document-format-audit.ts`、`terminology-adapt.ts`、`evidence-locator.ts`、`evidence-anchor.ts`、`evidence-support.ts`、`citation-file-refs.ts`、`provenance.ts`、`word-surface*.ts`（layout/outline/pieces/tracked）、`word-revision/{index,document,preservation,preservation-file,xml}.ts`、`word-xml-span.ts`

**artifacts（`src/lawmind/artifacts/`）**：`render-docx.ts`、`render-docx-tracked.ts`（多作者修订的落盘行为见 `render-docx-tracked-multi-author.test.ts`）、`render-pptx.ts`、`pptx-slide-layouts.ts`、`docx-legal-typography.ts`、`docx-thesis-styles.ts`、`docx-thesis-figures.ts`、`officecli-bin.ts`、`default-output-location.ts`、`matter-word-delivery.ts`、`word-revision-delivery.ts`

**mail（`src/lawmind/mail/`）**：`read-word-binary.ts`、`convert-with-word.ts`、`convert-to-docx.ts`、`doc-revision-gate.ts`、`mail-contract-formats.ts`

**platform / runtime（`src/lawmind/platform`、`runtime/`）**：`safe-command.ts`、`host-access/deny-list.ts`、`word-revision-instruction.ts`/`word-revision-core.ts`/`word-revision-checklist.ts`、`runtime/workspace-path.ts`、`workspace-io-fence.ts`、`file-version.ts`、`atomic-write.ts`、`turn-admission.ts`（租约）、`icloud-materialize.ts`（ensureLocalFile）、`lawyer-local-file.ts`

**integrations（`src/lawmind/integrations/word-addin/`）**：`review-requests.ts`、`auto-run.ts`、`attach-result.ts`、`addin-assets.ts`

**deliverables（`src/lawmind/deliverables/`）**：`review-table.ts`（xlsx 依据列导出）、`review-table-extract.ts`、`matter-artifact-model.ts` / `matter-artifact.ts` + `drafts/matter-artifact-regen.ts` + `agent/tools/legal/matter-artifact-tool.ts`（三件套：时间线 / 大事记 / 思维导图，见 §4.15）

**桌面（`apps/lawmind-desktop/`）**：`electron/safe-shell-command.mjs`（open-with-wps/系统打开）+ `electron/officecli-runtime.mjs`、`electron/ipc-handlers.mjs`、`electron/fs-bridge.mjs`、`server/lawmind-server-route-{word-surface,word-addin,format-audit,format-fix,fs}.ts`、`server/lawmind-server-word-addin-runner.ts`、`resources/word-addin/`（manifest、taskpane、`wps/{host.js,main.js,index.html}`）、`resources/officecli/`、`src/renderer/file/*`（`DocFileView/XlsxFileView/PptxFileView/PdfFileView/ZipFileView/EmlFileView/MediaFileView/WordFormatAuditPanel/LawmindWordRevisionSurface/preview-registry/file-tab-layout`）、`src/renderer/canvas/host-actions.ts`（openDeliverableInWps）、`src/renderer/lawmind-open-contract-revision.ts`、`src/renderer/lawmind-active-word-file.ts`

**脚本**：`scripts/vendor-officecli.mjs`

## 附录 B · 移植核对清单（按勾选推进）

- [ ] officecli vendoring + `resolveOfficeCliBin` 四级解析 + 子进程最小 env
- [ ] 路径围栏 + 指纹 + 原子写 + 租约
- [ ] 摄取矩阵（docx/pdf OCR/xlsx/图片）+ 截断上限明示
- [ ] `analyze_spreadsheet` + `write_spreadsheet` + xlsx 桌面预览（样式/合并/列宽/主题色）
- [ ] `render_pptx` 结构化布局 + pptx 视觉预览 + shape 文本回写
- [ ] `render_chart` + `lm-chart` 围栏纪律
- [ ] `run_compute` 沙箱 + 白名单 API + 高安全禁用
- [ ] `compare_documents` 行级只读比对
- [ ] 最短改动算法（性质测试 200 组）+ `auditMinimalEditSpans`
- [ ] 完整 B1–B5：apply → plan → officecli ops（从右到左/歧义跳过/chmod）→ XML 复核（12/8/0.6）→ degraded 不冒充
- [ ] 术语自适应（引号定义/括号别名/角色词 27 个）+ 格式体检三口径
- [ ] 证据锚：`L/P/S!` 解析 + `validateFileReferences` 状态机 + 非导出拦截 + `@@目标|quote@@` 渲染 + 定位回跳（ambiguous 不猜）
- [ ] 交付：`标题_YYYYMMDD_01` 命名 + 六步落点 + `docx→pdf`（soffice 租约）+ `.doc` Word 容器另存三重校验
- [ ] 三件套（时间线 / 大事记 / 思维导图）：upsert 合并（id / `日期|标题`）+ 空载荷拒落 + 无锚条目标「待补出处」+ 6 层截断 + 确定性布局快照；再生成/新建共用同一句纪律 prompt（§3.9/§4.15）
- [ ] `open_in_wps`：bundle-id 固定 + 审计 + 路径白名单 + 失败人话
- [ ]（可选）Word/WPS 加载项：`config.js` 凭据 + IPv4/IPv6 双绑 + 状态机去重 / stale 指纹 / 孤儿清理 + 真机验收后上线
- [ ] 日志有三件套：`fixed / cached / uncached` token、工具表指纹、每次外发/写入的 purpose+arguments 摘要
- [ ] 审计链（HMAC + root anchor）可直接导出一页台账给合规
