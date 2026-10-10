# LawMind 中栏（文件预览 + Word 修订面）实施计划 · 执行版

> **状态**：计划已定（2026-10-09），待开工。本文档是**唯一执行依据**，面向零上下文接手的执行 agent。
> **产品背景**：LawMind 是律师本地桌面工作台（Electron，无 Web 产品 UI）。中栏 = 文件预览/编辑区，承载 Word 修订面（tracked changes 是核心交付物）。目标手感：律师改稿体验对齐 Microsoft Word；格式覆盖目标是「律师一天的文件流都能在中栏读」。
> **一句话**：Word 修订面补齐「每天都在用」的基本功；其余格式「预览面要宽、编辑面要窄」——编辑深度全部投在 docx 上。
> **行号约定**：文中行号是 2026-10-09 的代码快照，执行时以符号搜索为准，行号漂移不影响语义。

---

## 0. 执行者须知（先读，再动手）

1. **先读 `AGENTS.md` 与 `SECURITY.md`**。本计划所有工作遵守其中的提交纪律：不 `git add -A`/`git add .`/`git commit -a`，只显式路径 add；提交前 `git status` 发现不属于自己的文件不要一起提交；不对 `docs/**/*.md` 跑 `markdownlint-cli2 --fix` 全量 globs（要修单篇就显式传路径或 `--no-globs`）。
2. **测试门禁（每阶段必过）**：`pnpm test` 全绿 + `pnpm --filter lawmind-desktop typecheck` 绿。新代码全部 colocated `*.test.ts(x)`。协议变化（save/raw/compare/doc 转换）必须有 route 测试。
3. **验收走真机**：`Lawmind.app` 或 `pnpm lawmind:desktop`。**绝不用 Vite 页面（`http://127.0.0.1:5174`）当产品验收**。凡涉及「保存写回 docx」的改动，验收必须包含「用 Word/WPS 重新打开，核对修订轨与图片完整」。
4. **UI 纪律**：桌面控件只用 tokens + `styles/controls.css`，见 `docs/LAWMIND-DESKTOP-UI-CONTROLS.md`；滚动条用 `lm-scroll` 与 `--scroll-*` tokens，不自造。
5. **勾选与回报**：每完成一项把本文对应 `- [ ]` 改成 `- [x]` 并注明日期；阶段完成时在 §2 总览表标注。开工时将阶段清单镜像进 `GOALS.md` 新一期勾选区（仓库惯例）。
6. **不触发 cassette 门禁**：本计划不改 `turn-orchestrator*`、clarification gates、compact、steer、approval 管线。若执行中发现必须触碰，停下来先按 `AGENTS.md` 补 cassette 再继续。
7. **一个阶段一个分支/worktree**，阶段内可多个 commit；阶段结束必须达到 §2 的「完成定义」再收口，不留半成品。

---

## 1. 现状事实（2026-10-09 逐行核实）

### 1.1 格式路由

中栏入口是 `apps/lawmind-desktop/src/renderer/file/FileWorkbenchEditorPane.tsx`，当前是五层互斥分支：

| 格式                              | 现状                                                 | 证据                                                                 |
| --------------------------------- | ---------------------------------------------------- | -------------------------------------------------------------------- |
| `.canvas.tsx`                     | 画布预览/源码                                        | `FileWorkbenchEditorPane.tsx:71,209-318`                             |
| 文本类                            | `<textarea>` 纯文本编辑器，tab 体系                  | `FileWorkbenchEditorPane.tsx:319-327`                                |
| 图片                              | 内嵌预览 + 系统打开                                  | `FileWorkbenchEditorPane.tsx:335-387`                                |
| `.docx`                           | `LawmindWordRevisionSurface`（Word 修订面）          | `FileWorkbenchEditorPane.tsx:388-408`                                |
| `.doc/.xls/.xlsx/.ppt/.pptx/.pdf` | **挡板文案**：「不支持…请用本机 Office 或 WPS 打开」 | `FileWorkbenchEditorPane.tsx:409-473`、`file-workbench-fs.tsx:38-41` |

**关键结构问题**：docx/图片不在 tab 体系。`openFile` 对 Office 路径走 `setOfficeBlock(...) + setActiveTabId(null)`（`FileWorkbenchImpl.tsx:393-401`）；点文本 tab 又 `setOfficeBlock(null)`（`FileWorkbenchEditorPane.tsx:154-156`）。**同时只能开一份 Office 文档，无法两份合同对照。**

### 1.2 Word 修订面能力（已有，不要重建）

`LawmindWordRevisionSurface.tsx` + `word-surface-document-view.tsx` + `word-surface-engine.ts` + 引擎 `src/lawmind/drafts/word-revision/`：

- 纸张视图（页宽/边距/默认宋体）、by-author 修订色、四种标记模式（所有标记/简单标记/无标记/原始状态）、按审阅者过滤。
- 右侧修订栏（rail）：hunk 卡片 + tracked 卡片 + 批注卡片，卡片与正文位置对齐（`packRailCardTops`）。
- 接受/拒绝（单条/全部）、上一条/下一条、导出审阅稿（`/api/word-surface/export`）。
- 正文 contentEditable 直改：engine 模式（runs 模型）下 beforeinput 拦截、IME composition 处理、⌘Z 撤销、⌘X 剪切→粘贴成 move、⌘B/I/U 格式修订、选区删除线/批注菜单。
- 表格渲染（列宽/合并/竖排单元格），单元格文字可改（竖排只读）。
- 页眉/页脚/脚注**只读**渲染（`word-surface-document-view.tsx:139` `storyPaint` 写死 `plainEditable: false`）。
- 4s 轮询（mtime + proposalAt + codeStamp 三元组判 unchanged）。

### 1.3 已核实的硬伤（本计划要修的东西）

| #   | 问题                                                                                                                                                                                                               | 证据                                                                                                                 |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| H1  | **回车不能分段**。engine 模式 `insertParagraph` 被 `preventDefault` 后 `event.data` 为空、落入 `if (!text) return true` 空转；非 engine 模式放行浏览器默认 `<div>`，sync 时 `visibleResultText` 拼纯文本、换行丢失 | `LawmindWordRevisionSurface.tsx:631-657`、`word-surface-edit.ts:428-437`、`LawmindWordRevisionSurface.tsx:2166-2188` |
| H2  | **保存丢图（现存 bug）**。写回是整段重写：`replaceParagraphRunsInXml` 用 `serializeRuns` 重建段内 XML，含 `w:drawing` 的 run 被抹掉。律师在含图段落改一个字并保存，图就没了                                        | `src/lawmind/drafts/word-revision/xml.ts:61-78`                                                                      |
| H3  | 段写回按位置对齐：`rewriteParagraphs` 回调按下标取 `paragraphs[index]`，段数不一致即错位——新增段必须扩协议                                                                                                         | `src/lawmind/drafts/word-revision/xml.ts:61-78`、`document.ts:133-175`                                               |
| H4  | 段落 segment 只有 `text/revision/tracked` 三种，正文图片（盖章、签名、贴图）完全不渲染                                                                                                                             | `src/lawmind/drafts/word-surface.ts:72-96`                                                                           |
| H5  | 无分页/页码：单张连续 sheet（`pageStyle` 只取一页盒模型）                                                                                                                                                          | `word-surface-document-view.tsx:81-100`                                                                              |
| H6  | 格式修订只有 加粗/倾斜/下划线，无工具栏（仅 ⌘B/I/U）                                                                                                                                                               | `LawmindWordRevisionSurface.tsx:923-952`、`word-surface-engine.ts:215-224`                                           |
| H7  | 无查找替换、无大纲导航、无缩放、无状态栏                                                                                                                                                                           | —                                                                                                                    |
| H8  | 选区 mouseup 即弹菜单（误触源）；右键菜单只有 删除线/批注                                                                                                                                                          | `LawmindWordRevisionSurface.tsx:1784-1798,2019-2088`                                                                 |
| H9  | 引擎早就能读 PDF（pdf-parse+OCR+视觉兜底）与 xlsx（SheetJS→TSV）——agent 能读、律师中栏看不见                                                                                                                       | `docs/lawmind/LAWMIND-DOCUMENT-INGEST.md`                                                                            |
| H10 | 桌面端无 pdfjs/SheetJS 依赖；`@tanstack/react-virtual` 已在。文件读取走 `/api/fs/read`（JSON+base64），无流式/Range 端点，大 PDF/音视频不可用                                                                      | `apps/lawmind-desktop/package.json:33-42`、`apps/lawmind-desktop/server/lawmind-server-route-fs.ts:85`               |

### 1.4 既有测试资产（改动时对齐这些文件）

- renderer：`apps/lawmind-desktop/src/renderer/file/` 下 `LawmindWordRevisionSurface.test.tsx`、`word-surface-engine.test.ts`、`word-surface-edit.test.ts`、`word-surface-rail.test.ts`、`word-surface-synced-undo.test.ts`、`FileWorkbench*.test.tsx`。
- server：`apps/lawmind-desktop/server/lawmind-server-route-word-surface.test.ts`、`lawmind-server-route-fs.test.ts`。
- 引擎：`src/lawmind/drafts/word-revision/` 下 `xml.test.ts`、`compose.test.ts`、`comments.test.ts`、`disposition.test.ts`；`src/lawmind/drafts/` 下 `docx-visible-revisions.test.ts` 等。

---

## 2. 目标、非目标与阶段总览

### 2.1 目标

1. Word 修订面手感对齐 Word 日常改稿：分段、图片、分页、格式条、查找、大纲、右键。
2. 中栏阅读面覆盖律师一天文件流：PDF ≈ Word > Excel > 邮件 > 音视频 > 其他。
3. 所有打开的文件统一进 tab 模型，支持两份 Word 对照。
4. 每阶段独立可验收、可交付，不留半成品分支。

### 2.2 非目标（明确不做，防做歪）

- **不做 xlsx/pptx 正文编辑**（无原生修订模型；正确姿势是「中栏预览 + 让 agent 出一份新的」）。
- 不做 PDF 正文编辑（二期才考虑高亮/批注）。
- 不重写修订引擎；不引入 mammoth 等第二套 docx 解析器。
- 不为预览新建远程服务；一切走本机 server + 既有 auth 上下文。
- 段合并（段首 Backspace）、表格行删除、单元格合并/拆分：推迟，律师反馈强烈再立项。

### 2.3 阶段总览

| 阶段   | 产出                                                            | 依赖                            | 状态                                 |
| ------ | --------------------------------------------------------------- | ------------------------------- | ------------------------------------ |
| **P0** | preview registry + tab 统一（所有格式都是 tab，可双文档对照）   | —                               | ☑ 2026-10-09                         |
| **P1** | Word 手感硬伤：保存不丢图、回车分段、图片渲染、虚拟分页         | 建议 P0 先行                    | ☑ 2026-10-09                         |
| **P2** | PDF 预览（`/api/fs/raw` + Chromium PDF viewer）                 | P0                              | ☑ 2026-10-09（真机/e2e 待验）        |
| **P3** | Word 肌肉记忆：格式工具条、查找替换、大纲、右键菜单、表格行插入 | P1                              | ☑ 2026-10-09（字号/对齐仍可选）      |
| **P4** | 其余格式只读预览：xlsx、.doc、eml、音视频、zip                  | P0（音视频依赖 P2 的 raw 端点） | ☑ 2026-10-09（真机验收仍待）         |
| **P5** | 体验补齐：缩放、状态栏、文档比较、页眉页脚编辑、拼写、打印      | P1（文档比较可提前到 P3 后）    | ☑ 2026-10-09（拼写检查默认关，未做） |

**每阶段完成定义**：新增/改动全部有 colocated 测试 + `pnpm test` 绿 + `pnpm --filter lawmind-desktop typecheck` 绿 + 真机验收清单逐项过 + 本文勾选。

---

## 3. P0 · preview registry + tab 统一

### 3.1 设计

1. `file-workbench-types.ts`：`OpenFileTab` 增加判别字段
   `kind: "text" | "word" | "image" | "pdf" | "xlsx" | "media" | "fallback"`。
   `content/savedContent` 仅 `text` 使用；二进制 tab 不内联内容，渲染时按 kind 自取。
2. 新增 `apps/lawmind-desktop/src/renderer/file/preview-registry.tsx`：
   注册表 `kind → { match(relPath): boolean; component: ReactNode; headerActions }`。
   header 统一提供「加入对话引用 / 用本机应用打开 / 在访达中显示」。
3. `FileWorkbenchImpl.tsx` `openFile`：所有格式一律建 tab（`tabId = root:relPath` 不变）。
4. `FileWorkbenchEditorPane.tsx`：五层三元嵌套改为 registry 查表渲染；`LawmindWordRevisionSurface` 成为 `kind: "word"` 的注册项，props 不变；现有挡板组件降级为 `fallback` 注册项。
5. 迁移入口：`LAWMIND_SHOW_WORD_SURFACE_EVENT`、`app/main-body-deep-links.ts`、`lawmind-open-contract-revision.ts`、`lawmind-material-chosen.ts` 对 `officeBlock` 语义的依赖，逐点改为「打开/激活对应 tab」。

### 3.2 执行步骤（两个 commit，防爆）

- [x] **commit 1+2（同会话合并）**：加 `kind` 字段 + registry + 新路由渲染；删除 `officeBlock`/`imagePreview` 旧 state 与 prop drilling（`FileWorkbenchView` → `FileWorkbenchEditorPane`）。2026-10-09

### 3.3 测试

- [x] 新建 `FileWorkbenchEditorPane.test.tsx`：每种 kind 路由到对应组件；两个 docx 并存 tab；tab 切换不清另一份 Word 的编辑态。
- [x] 既有 `FileWorkbench*.test.tsx` 保持绿；`preview-kind.test.ts` 新增。
- [x] 已去掉「送审本合同」固定短路径；合同审查走对话引用 + 自然语言交办。

### 3.4 验收

- [ ] 同时打开两份合同，tab 来回切换，各自修订态与滚动位置不丢。（真机待验）
- [ ] 文本、图片、docx、未知二进制各开一遍，fallback 挡板仍正常。（真机待验）

---

## 4. P1 · Word 手感硬伤

### 4.1 保存不丢图（bugfix，先于一切）

**现状**：`replaceParagraphRunsInXml`（`src/lawmind/drafts/word-revision/xml.ts:61-78`）整段重建 inner XML，`w:drawing` 等富内容 run 被 `serializeRuns` 丢弃。

- [x] `src/lawmind/drafts/word-surface-layout.ts`：`WordLayoutRun` 增加 `preservedXml`——解析时遇到含 `w:drawing`/`pict`/`object`/`fldChar`/`instrText` 的 run，记录完整 `<w:r>…</w:r>`。
- [x] `serializeRuns` / flatten / coalesce：保留原子原样写回；编辑后仍不丢图。
- [x] 测试：`xml.test.ts` 加「盖章：+drawing+处」→ insert → replace 往返；drawing 仍在。
- [ ] 验收：含盖章页的合同，在中栏改同段文字 → ⌘S → Word/WPS 重新打开，图在、修订轨在。（真机待验）

### 4.2 回车分段（insertParagraph）

**协议扩展**（服务端与 renderer 同包发布，不留旧形）：

- [x] `saveSchema.paragraphs` 支持 `{ sourceIndex, runs, pPrInner }[]`（仍接受旧 `runs[][]`）。
- [x] `xml.ts` `rewriteParagraphsWithInserts`：`sourceIndex: null` 插入新 `w:p`；新段继承 `pPrInner`。
- [x] `saveParagraphRuns` 适配两种入参形状。

**renderer**：

- [x] `applyEngineBeforeInput`：处理 `insertParagraph`/`insertLineBreak` → `splitRunsAt` + `snapshotSplitParagraph`。
- [x] `snapshotWithRuns` / `snapshotSplitParagraph` 支持段数变化与块树插入（含表格单元格）。
- [x] 段首 Backspace 保持既有 delete 行为（不合并段）。
- [x] 非 engine：`gateWordSurfaceBeforeInput` 吞掉回车。

**测试**：

- [x] `word-surface-engine.test.ts`：拆段 + `sourceIndex: null`。
- [x] `xml.test.ts`：插入新 `w:p`。
- [x] route / disposition / surface 相关测试保持绿。
- [x] `LawmindWordRevisionSurface.test.tsx`：beforeinput insertParagraph 端到端。2026-10-09

**验收**：engine 文档回车 → 新段；⌘S 后 Word/WPS 核对（真机待验）。

### 4.3 图片渲染（依赖 4.1）

- [x] `hydrate-images.ts`：解析 drawing → rels → media → data URL（单张 ≤ 5MB、全文 ≤ 20MB）。
- [x] `WordSurfaceSegment` 增加 `image` kind；paint / paragraphFromRuns 输出图片段。
- [x] `word-surface-document-view.tsx`：渲染 `<img>` / 占位符。
- [x] `snapshotKey` 不含 `src`（只记尺寸与 hasSrc）。
- [x] 删除图片：V1 不支持（preserved 原子，引擎不提供删除入口）。
- [x] 测试：`hydrate-images.test.ts`。

### 4.4 虚拟分页

- [x] 纯渲染层：`word-surface-page-breaks.tsx` 按 A4 内容高插分页线 + 页码角标。
- [x] `useLayoutEffect` 按段 `offsetTop` 计算；不进引擎。
- [x] rail 卡片对齐：窗口缩放、工具条缩放、以及版心高度变化（分页线）时用 `ResizeObserver` 重跑 `packRailCardTops`。2026-10-09（真机观感仍待验）
- [x] 测试：`word-surface-page-breaks.test.ts`。

---

## 5. P2 · PDF 预览

- [x] **服务端 `/api/fs/raw`**：流式 + `Range`（206）+ mime 白名单（pdf/图片/音视频）。
- [x] **`PdfFileView`**：`fetchApi` 拉 raw → **pdf.js `PDFPageView`**（HiDPI 画布 + 文字层）。CSP 已放行 `worker-src 'self' blob:`；cmaps / standard_fonts 由 Vite 插件托管。
- [x] **Word 式拖选**：`pdf-text-drag-select.ts`（`caretRangeFromPoint` + 最近邻、rAF、Shift 延伸、CJK 双击、复制正规化）；`.endOfContent` 置 inert，避免与自建选区打架。
- [x] **虚拟化**：视口 ±2 页挂载，其余等高占位；最多预览前 80 页。
- [x] header 复用 `PreviewCommonActions`（引用 / 访达 / 本机打开）。
- [x] pdf tab 保持挂载（切换不丢滚动）。
- [x] 测试：`PdfFileView.test.ts`、`pdf-text-drag-select.test.ts`；fs route Range/415。
- [x] **律师手册**：第 24.14 节、第 38.16 节（Q121–Q124）、`INDEX.md`、律师快速指南。
- [ ] 扫描件 OCR 提示（可后续补文案）。
- [ ] 验收：真机打开判决书；e2e 冒烟。

---

## 6. P3 · Word 肌肉记忆

按价值排序，各自独立可交付：

- [x] **6.1 格式工具条（B/I/U 首批）**：工具条已露出加粗/倾斜/下划线（落修订轨）。字号/字体/对齐/行距仍待扩展引擎 format 取值。
- [x] **6.2 查找 ⌘F + 替换**：查找框 + 替换/全部替换（engine `replaceRange` 落修订轨）。2026-10-09
- [x] **6.3 大纲导航**：layout 抽 `w:outlineLvl`/`w:pStyle`/中文短标题 → `outlineLevel` + `snapshot.outline`；左侧大纲栏。2026-10-09
- [x] **6.4 右键菜单改造**：去掉 `onMouseUp` 误触；只在 `onContextMenu` 弹出；命中修订时加「接受/拒绝/查看修订卡」。
- [x] **6.5 表格行插入**：右键「在下方插入行」→ `/api/word-surface/table-row` 克隆空 `w:tr`（保留 tcPr）。2026-10-09

测试：查找单测已绿；layout outline 单测；右键相关 surface 测试已改 contextmenu；table-row xml 单测。

---

## 7. P4 · 其余格式只读预览

| 格式   | 方案                                                                                                                                                           | 依赖/备注                                           |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| xlsx   | 服务端 `/api/fs/xlsx-preview` + `/api/fs/xlsx-save` → Excel/WPS 式网格：列标/行号、样式/合并/底栏页签、**单元格编辑并写回**；header「保存 / 让助手处理这张表」 | 无功能区（条件格式/数据透视等仍走本机应用或 agent） |
| .doc   | 服务端探测 `soffice`：有则 `--convert-to docx` 到 `*.converted.docx` 副本并走 word 面；无则明确文案 + 用本机应用打开                                           | 转换动作要律师确认，不静默写副本                    |
| eml    | renderer 轻量 MIME 解析（headers/正文/附件清单）；附件可「收进本案」（复用 `import_host_file` 路径）                                                           | 引擎 `mail/imap-client.ts` 是在线邮箱路径，不复用   |
| 音视频 | `/api/fs/raw`（P2）+ fetch→blob + HTML5 `<audio>/<video>`                                                                                                      | 大文件整包拉入内存；后续可加带鉴权的 Range 直链     |
| zip    | 服务端 `jszip` 列内容树（root deps 已有），只读清单 + 「收进本案」入口                                                                                         | 不解压到磁盘                                        |

- [x] xlsx：registry + `XlsxFileView` + `/api/fs/xlsx-preview` route 测试。2026-10-09
- [x] 音视频：`MediaFileView` + EditorPane 路由测试。2026-10-09
- [x] eml：`EmlFileView` + `parseEmlPreview` 单测。2026-10-09
- [x] zip：`/api/fs/zip-listing` + `ZipFileView`。2026-10-09
- [x] .doc：确认后 `/api/fs/convert-doc` → `*.converted.docx`（Word/LibreOffice；误标 OOXML 直接拷贝）。2026-10-09
- [ ] 验收：真实脱敏材料各开一遍。

---

## 8. P5 · 体验补齐

- [x] **缩放**：工具条 zoom（50%–200%，±25）+「页宽」；Chromium `zoom` CSS 变量。2026-10-09
- [x] **状态栏**：字数 +「修订 n / m」+ 当前缩放。页码角标仍见虚拟分页。2026-10-09
- [x] **文档比较**：右键「与另一份比较…」→ 选工作区/项目内 docx → `/api/word-surface/compare` → 同目录 `*_比较稿.docx`（段对齐 + `materializeHunks` 落修订）→ 中栏打开。2026-10-09
- [x] **页眉/页脚/脚注编辑**：story 段带 `storyPart`/`sourceIndex`；统一 `data-paragraph-index`；save 按 part 分组写回 `header*/footer*/footnotes`。2026-10-09
- [x] **打印**：工具条「打印」→ `window.print()` + 打印样式隐藏栏/大纲/修订栏。2026-10-09
- [x] **导 PDF**：`POST /api/word-surface/export-pdf`（LibreOffice soffice → 同目录 `.pdf`）+ 工具条「导 PDF」。2026-10-09
- [ ] **拼写检查**（中文场景价值低，默认关）仍不做。

---

## 9. 风险与应对

| 风险                                          | 应对                                                                                                                                                 |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| contentEditable 与 React 重绘冲突             | 现有 `holdPagePaint`/`dirtyPlainRef`/`composingRef` 守卫体系是所有新交互的必经之路；新交互一律复用 `commitEngineRuns`/`scheduleSync`，不另开写入路径 |
| 整段重写丢 XML（书签、域、超链接同理会丢）    | 4.1 的「保留原 XML 原子」模式是前提；后续每支持一种富内容按同模式扩展。域代码（页码域、目录域）列入 4.1 测试 fixture                                 |
| 快照内联图片 base64 使 4s 轮询变大            | `snapshotKey` 不含 src；图片内容走 mtime 缓存。仍超阈值再拆 lazy 端点                                                                                |
| 双轨（engine runs vs 非 engine sync）维护成本 | 不收敛双轨（防做歪）；所有新编辑能力只进 engine 轨，非 engine 轨功能冻结                                                                             |
| pdfjs 打包进 Electron 产物路径问题            | P2 验收含 `pnpm lawmind:bundle:desktop-server` 后真机打开 PDF                                                                                        |

---

## 10. 建议开工顺序

1. **P0**（骨架）→ 2. **P1-1 保存不丢图**（bugfix，独立可交付）→ 3. **P1-2 回车分段** → 4. **P1-3 图片渲染** → 5. **P2 PDF** → 6. P1-4 分页 → 7. P3 工具条/查找/大纲 → 8. P4 格式铺开 → 9. P5（文档比较可插队在 P3 后）。
