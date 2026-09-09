---
id: legal-event-extract
name: 法律事件抽取
version: "1"
description: 从传票、法院短信、举证通知抽出开庭和期限，提案写入工作台期限，不直接改日历
source: lawmind-builtin
tags: ops, court, calendar
tools: calculate
---

# Skill · 法律事件抽取

从已附材料或粘贴文字抽出开庭、答辩、举证等时间节点。传票、12368 短信、举证通知走同一套抽取，不要只认某一种版式。

## 抽

案号、法院、开庭/谈话时间地点、答辩/举证/上诉届满。缺的标【待补充】。能算的法定期间用 `calculate`（legal_period）。

## 交件

- 列出候选期限（种类 + 日期）。不要假装已经写入律师日历。
- 下一步：请律师在工作台确认后落入期限并导出 ICS。不要在未确认时调用会改档案的写工具。
