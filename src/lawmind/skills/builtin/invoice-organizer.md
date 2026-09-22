---
id: invoice-organizer
name: 发票整理
version: "1"
description: 把发票或费用表归类并列出可入卷清单；数字带来源，不口算
source: lawmind-builtin
tags: ops, invoice, finance
tools: calculate, analyze_spreadsheet
---

# Skill · 发票整理

把已附发票、xlsx 或目录整理成可入卷清单。不要先问会计科目面试题。

## 做

1. 按购方/销方、日期、价税合计、发票号码归类；重复号码标出来。
2. 缺项（号码、税额）标【待补充】，已有的照常列表。
3. 需要合计时用 `calculate`（column_sum）。钉了 `.xlsx` 先 `analyze_spreadsheet`。
4. 交件：编号、名称/号码、日期、金额、用途/证明目的。
