---
id: spreadsheet-analysis
name: 表格分析
version: "1"
description: 先分析表格，再计算/出图/落表；数字必须带来源列
source: lawmind-builtin
tags: spreadsheet, chart, calculate
tools: analyze_spreadsheet, write_spreadsheet, render_chart, calculate
---

# Skill · 表格分析

钉选或指定 `.xlsx` 后，按可复核步骤处理，不要把整表倒成 TSV 聊天。

## 顺序

1. **先 `analyze_spreadsheet`**：看列名、类型、空值与数值列统计。
2. 需要算术时用 **`calculate`**（公式与输入必须带回，便于入卷）。LPR 分段利率由律师提供，不假装实时牌价。
3. 需要图时用 **`render_chart`**，并在助手正文用 ` ```lm-chart ` 围栏原样贴回完整 spec。
4. 需要给律师一张表时用 **`write_spreadsheet`** 写入 `artifacts/`。

## 纪律

- 每个数字写明来源列或计算公式。
- 不要开放通用终端或任意脚本；受控脚本是另开的 `run_analysis`（默认关闭）。
- 不改 Word 改稿/交付管线。
