# 调研卷宗 / 学习简报 / 培训 PPT 交付物

> 生产级落地（2026-08 复审升级）：对接 ResearchBundle、大纲 HITL 门禁、深度研究执行器与结构化 PPT 版式。

## 交付物类型

| Type                | 默认输出 | 说明                                                                       |
| ------------------- | -------- | -------------------------------------------------------------------------- |
| `report.compliance` | DOCX     | 涉外合规卷宗（管辖矩阵由真实来源填充；placeholder 须在 strict 渲染前解决） |
| `report.learning`   | DOCX     | 学习型调研简报                                                             |
| `ppt.training`      | PPTX     | 培训课件（结构化版式：议程/双栏/矩阵/清单）                                |

既有 `report.general` / `report.esg` / `ppt/client-brief-*` 行为保持不变。

## 生产流水线（已接线）

1. **`deep_research` 工具** — 问题树 → 多适配器 retrieve（含 URL 卷宗适配器）→ 证据驱动大纲 → 持久化 `.research.json` + `.outline.json`
2. **`url_dossier` 工具** — 抓取 URL；可选 `task_id` **合并进 ResearchBundle**（非聊天旁路）
3. **大纲门禁** — `report.compliance` / `report.learning` / `ppt.training` 在大纲 `pending` 时只输出大纲草稿；澄清回答 `research_outline_confirm` 会写入「大纲已确认」
4. **脱敏硬门禁** — `ppt.training` 在 `buildDraft` 扫描指令 + CASE.md；阻断级 PII 未声明「已脱敏」则抛错
5. **PPT 版式** — `pptx-slide-layouts.ts`：agenda / bullets / twoColumn / matrix / checklist / quote（非单文本框）

## 关键模块

- `src/lawmind/retrieval/url-dossier-adapter.ts`
- `src/lawmind/research/execute-deep-research.ts`
- `src/lawmind/research/outline-store.ts`
- `src/lawmind/reasoning/research-draft-gates.ts`
- `src/lawmind/artifacts/pptx-slide-layouts.ts`

## Solo 默认路径（降门槛）

1. 对话空态 → **研究 / 培训快车道**（合规卷宗 / 调研简报 / 培训课件）一键交办；合规须填管辖区，交办文案含 `交付物类型代码：report.compliance`
2. 或「写材料」填表：intake 已按类型预填大纲/URL/脱敏门禁文案
3. 澄清卡片对 `research_outline_confirm`：**确认大纲 / 按修订确认 / 不同意重做**（无需背口令；自由聊天「继续」不批准）
4. 确认后按大纲写正文；不同意则按当前检索重建大纲再问一次
5. **质量保障**：`deep_research` 落盘 `tasks/<id>.json`；空证据/演示语料/401 走 `research_evidence_gate` 可续跑；禁止 `write_document` 写 `artifacts/*.md` 旁路；类型不得从合规串成 ESG

## 相关门禁

- `research_evidence_gate` — 大纲确认后扩写正文时证据必须可用
- `research_write_bypass_gate` — 禁止用 `write_document` 假交付
- `demo_corpus_gate` — 中高风险正文仍拒演示语料（大纲-only 可先出）

## 格式决策

- **默认报告**：DOCX
- **默认培训**：可编辑 PPTX（结构化版式）
- **Overleaf / LaTeX**：非默认
