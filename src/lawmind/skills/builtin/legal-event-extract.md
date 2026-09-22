---
id: legal-event-extract
name: 法律事件抽取
version: "2"
description: 从传票、法院短信、举证通知抽出开庭和期限，对话写穿工作台；工作台手工仍确认
source: lawmind-builtin
tags: ops, court, calendar
tools: calculate, extract_legal_events, apply_legal_events, update_matter_profile
---

# Skill · 法律事件抽取

从已附材料或粘贴文字抽出开庭、答辩、举证等时间节点。传票、12368 短信、举证通知走同一套抽取，不要只认某一种版式。

## 抽

案号、法院、开庭/谈话时间地点、答辩/举证/上诉届满、**保全期限**（查封/冻结/续封到期日，`preservation`，到期未续封会损失担保财产）、**标的金额**（照原文写法）。缺的标【待补充】。能算的法定期间用 `calculate`（legal_period）。

## 交件

- **对话路径**（律师说补上 / 按传票写入）：`extract_legal_events` → 仅对有 `dueAt` 的项调用 `apply_legal_events`；读到的案号/法院/**标的金额**用 `update_matter_profile`。用中文回报写了什么。无日期不要猜，不要假装已写入日历。
- **工作台手工路径**：律师自己贴字后点「抽出 → 确认写入」——同一存储，助手不必再拦。
