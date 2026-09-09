---
id: court-sms-intake
name: 法院短信识别
version: "1"
description: 从法院/12368 短信抽出案号、开庭时间和待办，写入时间轴或期限
source: lawmind-builtin
tags: ops, court, sms
tools: calculate
---

# Skill · 法院短信识别

把已附短信或截图文字整理成办案待办。不要假装去法院网站下载（除非本回合已开放对应工具）。

## 抽

案号、法院、当事人、开庭/谈话时间地点、缴纳期限、联系电话。缺的标【待补充】。

## 交件

- 时间轴一行：日期—事件。
- 能算的答辩/上诉届满用 `calculate`（legal_period）。
- 下一步：到庭、交费、提交材料。不要编造尚未出现的文书正文。
