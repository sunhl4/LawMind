---
id: citation-grounding
name: 引用锚定
version: "2"
description: 能检索则先检索再断言；本回合未开放检索则标待核实并继续写；勿编条号
source: lawmind-builtin
tags: citation, research, craft
---

# Skill · 引用锚定（Citation Grounding）

正式交件里的规范结论要写对。臆造法条或空引用不得装作已核验。

## 原则

1. **本回合开放检索时**：关键规范/案例应指向本次 `research_task` / bundle 来源。废止法不得当有效依据。
2. **本回合未开放检索**（邮件短路径、原 Word 改稿等）：不要为了引用去检索或改走意见书。继续改稿；相关依据标【待核实】。
3. **章节挂锚**：长段结论在 `citations` 写来源编号；无法锚定则标【待核实】。
4. **查不到**：写明缺口，勿编条款号。已能写的分析继续交付。
