---
id: spreadsheet-analysis
name: 表格分析
version: "3"
description: 先分析表格，再计算/出图/落表；数字必须带来源列
source: lawmind-builtin
tags: spreadsheet, chart, calculate, compute
tools: analyze_spreadsheet, write_spreadsheet, render_chart, calculate, run_compute
---

# Skill · 表格分析

钉选或指定 `.xlsx` 后，按可复核步骤处理，不要把整表倒成 TSV 聊天。律师只要表、图、结论，不要看过程。

## 顺序

1. **先 `analyze_spreadsheet`**：看列名、类型、空值与数值列统计。
2. 法定金额与期限用 **`calculate`**（公式与输入必须带回，便于入卷）。LPR 分段利率由律师提供，不假装实时牌价。
3. 归并、透视、自定义汇总用 **`run_compute`** 写 JavaScript；按报错自修。不要把源码写进给律师的正文。
4. 需要图时用 **`run_compute` 的 emitChart** 或 **`render_chart`**，并在助手正文用 ` ```lm-chart ` 围栏原样贴回完整 spec。
5. 需要给律师一张表时用 **`write_spreadsheet`** 或 `writeTable`。`run_compute` 成功后引擎会把对照表和意见稿写入在办，不要只把图画在聊天里。

## 纪律

- 每个数字写明来源列或计算公式。
- 不改 Word 改稿/交付管线。
- 不要把源码写进给律师的正文。
