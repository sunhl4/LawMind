# LawMind 文档摄入能力（PDF / 图片 / Word / Excel）

本文说明**当前代码路径**下助手能如何读取本地材料，便于排障与选型（`analyze_document` vs `read_project_file`）。

平台重构阶段统一契约见 `docs/lawmind/LAWMIND-PLATFORM-CONTRACTS.md` 与 `src/lawmind/platform/contracts.ts`（`IngestResult` / `IngestErrorCode` / `IngestStage`）。

## 结论速览

| 格式                                                | 工作区 `analyze_document`                                                                                                                      | 项目目录 `read_project_file`   |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| `.pdf`                                              | 先 `pdf-parse` 文本层；空则 OCR（最多前 5 页）；仍空且 `LAWMIND_DOC_READ_MODE=ocr_then_vision` 时用视觉模型                                    | 同左；正文片段上限约 500k 字符 |
| `.docx`                                             | 解压 `word/document.xml` 抽取纯文本（无版式）                                                                                                  | 同左                           |
| `.xlsx`                                             | **支持**：SheetJS 将各工作表转为 **TSV 纯文本**（无公式求值、无图表对象）；最多前 **32** 张表、每表解析约前 **5000** 行（见 `legal-tools.ts`） | 同左                           |
| `.doc` / `.xls` / `.ppt`                            | **不支持**（旧二进制）                                                                                                                         | **不支持**                     |
| `.pptx`                                             | **不支持**抽取正文                                                                                                                             | **不支持**                     |
| `.png` `.jpg` `.jpeg` `.webp` `.bmp` `.tif` `.tiff` | Tesseract OCR（`LAWMIND_OCR_LANGS`，默认 `chi_sim+eng`）；无字且允许视觉兜底时走视觉                                                           | 同左                           |
| `.md` `.txt` 等                                     | UTF-8 直读（有长度截断）                                                                                                                       | 直读；过大或含 `\0` 会拒绝     |

## 环境变量

- **`LAWMIND_OCR_LANGS`**：Tesseract 语言包，默认 `chi_sim+eng`。
- **`LAWMIND_DOC_READ_MODE`**：默认 `ocr_only`。设为 **`ocr_then_vision`** 且已配置通用视觉端点（与 Agent 相同的 `LAWMIND_AGENT_*` / `QWEN_*` 等）时，图片与 PDF 在 OCR 为空后可走视觉兜底（`sourceType`：`image_vision` / `pdf_vision`）。

## 工具分工（执行任务时怎么用）

1. **材料在工作区树内**（`workspace/` 下相对路径）：用 **`analyze_document`**，`file_path` 为相对工作区路径。
2. **材料在律师另选的「项目目录」**（桌面关联文件夹）：用 **`read_project_file`**，`relative_path` 相对项目根；未关联项目时该工具不可用。
3. **`search_workspace`**：会检索工作区记忆文件，并对项目目录做**有界、仅常见纯文本扩展名**的扫描；**不会**自动打开 PDF/Word/Excel/图片，需用上面两个工具显式读文件。

## 体积与页数上限（实现常量）

- PDF / DOCX / XLSX / 单张图片：约 **20MB**（见 `legal-tools.ts` 中 `MAX_*_READ_BYTES`）。
- PDF OCR / 视觉：最多前 **`MAX_PDF_OCR_PAGES`（5）** 页。
- `analyze_document` 对 PDF/图片/DOCX/XLSX 返回内容默认截断预览（如 8000 字符）；`read_project_file` 允许更大片段。

## 依赖

- `pdf-parse`（PDF 文本与截屏）
- `tesseract.js`（OCR）
- `jszip` + 自研 XML 文本抽取（`.docx`，非 `mammoth`）
- **`xlsx`（SheetJS）**：`.xlsx` 表格 → TSV 文本（仅解析，不执行宏）

## 相关代码

- `src/lawmind/agent/tools/legal-tools.ts` — 解析实现与工具定义
- `src/lawmind/agent/index.test.ts` — PDF / DOCX / XLSX 工作区与项目路径单测
