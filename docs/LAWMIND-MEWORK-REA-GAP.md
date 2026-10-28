# MeWork 未做能力 · REA/静态拆包补证（0.3.20）

> 日期：2026-10-26  
> 对象：本机已安装 MeWork.app 0.3.20 + 既有 asar 解包（工作机 `~/nv/MeWork.app`、`~/nv/mework-src`）  
> 方法：REA `inspect-desktop-application` + 渲染层/契约字符串与校验器静态读（**不**改包、**不**绕许可、**不**抄专有实现）  
> 目的：把竞品文里「LawMind 还没做」的项，分成 **桌面里真有规格可对齐** vs **公开演示/云端技能、客户端无对应面**，避免按营销文自研错东西。

与既有文档关系：工程骨架仍以 `docs/LAWMIND-MEWORK-CODE-REVIEW.md` 为准；产品场景排序仍以 `docs/LAWMIND-MEWORK-COMPETITOR-REVIEW.md` 为准。本文只补「还没做」项的证据分层。**下一个该拆谁、为什么、拆到什么程度**，见 [`docs/LAWMIND-REA-TARGET-MAP.md`](LAWMIND-REA-TARGET-MAP.md)。

---

## 0. 一句话

| 竞品文主张（应跟进）       | 桌面包证据                                                                                                       | LawMind 该怎么跟                                             |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| 时间戳级音频转写核对器     | **弱**：有 Fun-ASR 能力声明 + 会话语音输入 UI；未见「证据录音 → 句级定位播放 → 边听边改 → 回写正式转写稿」专用面 | 按律师痛点仍可立项，但不要假装 MeWork 桌面已有完整核对器可抄 |
| 资金流向穿透表             | **无**产品面字符串/插件；不像分析表那样落盘                                                                      | 做成自有 deliverable type，别等拆包蓝本                      |
| 材料冲突并列陈列           | **无**；包内 `kind:"conflict"` 是**保存 TOCTOU**，不是案情冲突                                                   | 同上，做 matter 视图规范即可                                 |
| 证据锚 + 出稿闸门          | **强**：`lineRef` 多形态 + `ValidateFileReferences`                                                              | **优先对齐**                                                 |
| 分析表 + xlsx 依据列       | **强**：`analysis_tables/*` schema + 导出 `{{name}}_依据`                                                        | **优先对齐**（你们 G.5 #4）                                  |
| 时间线 / 思维导图 / 大事记 | **强**：项目扩展三件套 + 再生 prompt 纪律                                                                        | **优先对齐**（你们 G.5 #1–3）                                |

---

## 1. REA 跑了什么

```bash
npx rea-agents@latest inspect-desktop-application "$MEWORK_APP" --json
# 确认 Electron 包布局；主体证据来自既有 asar 解包 renderer-dist
```

全树 `analyze-javascript-application` 对含 `node_modules` 的解包目录过重；有效结论来自 **renderer 产品 chunk 校验器与词典**（与先前人工深评同一路径，本轮按「未做项」重扫）。

---

## 2. 营销领先、客户端对不齐（不要按演示自研成「抄他们 UI」）

### 2.1 音频「播放-校对-回写」

客户端可见：

- 会话语音输入：录音 / 转写中 / 放弃转写 / 波形（`AudioContext` 失败则降级）。
- 合规与算法说明：Fun-ASR，支持说话人分离、句级时间戳；场景写的是「语音输入、会议或录音转写」。

客户端**未见**（全 renderer 产品 chunk 检索）：

- 「材料冲突 / 资金流向 / 边听边改 / 转写稿 / 逐帧」等专用产品文案或画布插件 id。

**结论**：竞品文 §六 #1 仍可能是律师真需求，但 0.3.20 桌面**没有**可对齐的核对器规格；若做，按 LawMind 自有交付物设计，云端 ASR 选型另议。

### 2.2 资金流向穿透表 / 材料冲突并列

产品 chunk 无稳定命中。包内 `kind:"conflict"` 出现在画布保存预检：文件指纹不一致 → `conflict`，与案情「材料冲突」无关。

**结论**：这两项按公开长文做产品，不按桌面逆向做蓝本。

---

## 3. 桌面里真有、LawMind 仍缺 —— 可直接当重建规格（合法吸收：规格与行为，不拷代码）

### 3.1 证据锚 `lineRef`（定位用）

客户端解析（逻辑形态，非源码照搬）：

| 形态                                 | 含义                                               |
| ------------------------------------ | -------------------------------------------------- |
| `L{n}`                               | DOCX 第 n 段（可带 `$fileField`、`#dataItem/ins`） |
| `P{n}`                               | PDF 第 n 页                                        |
| `S{sheet}!{A1}` / `S{sheet}!{A1:B2}` | Excel 单元格 / 区域                                |
| `#id/ins`、字段 id                   | Powerbase 数据项                                   |

内联引用还支持 `@@target|quote@@` 与私有 citation token。定位 UI：可点回原文件；部分类型不支持精确定位时降级「打开原文件」。

### 3.2 出稿闸门 `ValidateFileReferences`

工具契约要点（描述串已写明行为）：

- `mode`: `inline` | `file`
- `inline`：`sourceFiles[{path, contentSha256}]` + `references[{id, filePath, lineRef, text}]`
- **仅 `PASSED` 可生成最终结果**；`FAILED` 修正重试；`INCOMPLETE` 不算过
- 客户端工具表白名单里它与 `present`、技能发布等同属特殊项

注意：工具参数里 `lineRef` 正则偏窄（`^L[1-9]…$`），与客户端 `Do()` 的 P/S 形态不一致——对齐时以「多形态锚 + sha256 + quote」为准，不要死抄窄正则。

### 3.3 分析表（批量尽调）

落盘约定（路径形态）：

- `analysis_tables/{tableId}.ana.json`（或 v1 整表）
- `analysis_tables/{schemaId}.schema.json`
- `analysis_tables/{tableId}.row.{recordId}.json`
- `analysis_tables/{tableId}.source.{rowId}.json`（`kind: analysis-table-source`，`lines[].ref = L{n}` 与正文对齐，带 `contentSha256`）

列类型：`text` | `number` | `date` | `single_select`。  
导出：每分析列后跟 `{{name}}_依据` / `_sources`，行格式 `{{lineRef}}：{{summary}}`。  
改列 prompt/类型会清空该列结果；共享列改删有连带确认。

→ LawMind：matter 工作区结构化分析表 + 导出带依据列；复用即将升级的 citation/证据锚。

### 3.4 项目扩展：时间线 / 思维导图 / 大事记

配置三元组（侧栏扩展列表）：

| id           | skill             | 根目录文件                     |
| ------------ | ----------------- | ------------------------------ |
| `timeline`   | `case-timeline`   | `project.case-timeline.json`   |
| `mindmap`    | `case-mindmap`    | `project.case-mindmap.json`    |
| `chronology` | `case-chronology` | `project.case-chronology.json` |

再生纪律（prompt 模板，宜整句吸收为产品规则）：

> 请使用 `{{skill}}` 技能，根据当前项目资料整理`{{name}}`，保存到项目工作目录根目录的 `` `{{file}}` ``，并交付该文件。如果文件已经存在，请先读取，再按本次要求更新，不另建同类文件；资料不足时先向我确认，不编造内容。

空态文案：时间线「按时间梳理事件，串联关键节点与来源」；思维导图「展开事项脉络…」；大事记「逐项整理重要事实，记录时间、人物与依据」。

→ LawMind：matter 根目录同构 JSON + 轻量 SVG（勿引 mermaid 全谱）+ 把上述纪律写进交付物再生 helper（半天级，G.5 #3）。

### 3.5 `.mework` 目录分工（对照用）

可见用户内容：`uploads` / `screenshots` / `downloads`；隐藏：`skills` / `plugins` / `source-locations` / `docx` 派生等。与 A1 本地工作区叙事兼容——结构化产物应落在**案件根目录可见处**，便于审计链，而不是藏进点目录。

---

## 4. 建议排期（在竞品文 §六 上修正）

1. **证据锚 + Validate 同类闸门**（桌面有硬规格） — **API + 出稿接线**（2026-10-26）
   - `src/lawmind/drafts/evidence-locator.ts`：`L` / `P` / `S!` 解析
   - `src/lawmind/drafts/evidence-anchor.ts`：`validateFileReferences` → `PASSED` | `FAILED` | `INCOMPLETE`
   - `src/lawmind/drafts/citation-file-refs.ts`：从 research snapshot 的 path/`sourceVersion`/pin/`#L` 收集锚点
   - `verifyDraftCitationEvidence` → `fileReferences`；`citationViewBlocksExport` / `renderDraft` 非 PASSED 挡正式导出
   - **待接**：PDF/Excel 专用核对器；检索写入时默认落 `url#L` + `sourceVersion`（提高入闸覆盖率）
2. **分析表 + sources 导出列**（桌面有硬规格） — **已落地**（2026-10-26）
   - `reviewTableToXlsxRows` 默认在分析列后插入 `{{列名}}_依据`，文案 `lineRef：summary`
   - 兼容 `#line=` / `#page=`；`includeEvidenceColumns: false` 可关
   - 桌面 `GET /api/drafts/:id/table.xlsx` 已走该导出（主表 + 逐格出处双 sheet）
3. **事实时间线 / 大事记 JSON + 再生纪律**；思维导图用轻量 SVG — **已落地**（2026-10-26）
   - 再生纪律文案：`src/lawmind/drafts/matter-artifact-regen.ts`（三件套常量 + batch prompt）
   - 模型与落盘：`src/lawmind/deliverables/matter-artifact-model.ts`（纯模型：归一化/归纳/按年分组/布局）、`matter-artifact.ts`（`cases/<id>/project.case-*.json` 读盘）
   - 只读接口：`GET /api/matters/:id/artifacts`（`apps/lawmind-desktop/server/lawmind-server-route-matter-artifacts.ts`）
   - 写入工具：`matter_artifact_update`（`src/lawmind/agent/tools/legal/matter-artifact-tool.ts`）——默认 upsert、按 id 或「日期|标题」合并，空载荷拒绝，逐条带 `evidence`
   - 桌面渲染：`LawmindMatterArtifactPanel.tsx`，挂在案件「本案进展」之后；复用 `lm-lawyer-pane` / `lm-timeline*` / `lm-meta` / `lm-scroll`，SVG 只用 token，无新滚动条/白底硬框
   - 证据 chip 可点：走 `previewVolumeFile({path, line})`，`L3` 会定位到行
   - **待接**：PDF/Excel 精确页/单元格定位（当前 chip 打开原文件）；思维导图节点编辑
4. **冲突并列 / 资金流向**：按律师场景自研呈现，不指望 MeWork 桌面蓝本
5. **音频核对器**：需求保留；先做「转写结果带句级时间戳的可编辑表」，播放器第二期——不要宣称对标 MeWork 桌面已有完整闭环

工程向「最该看齐四件事」（续跑增量、cached 税、purpose 放行文案、引用锚）仍以代码深评正文为准；引用锚本轮补了闸门规格，出稿接线未完。

---

## 5. 不做清单

- 不把 MeWork 云端系统提示、模型路由、计费当可拆目标（桌面不可见）。
- 不移植其 Powerbase「万物数据项」与飞书主路径（与 A1 本地闭环冲突）。
- 不提交解包源码或专有 chunk 进本仓库；本文件只保留规格级摘要。
