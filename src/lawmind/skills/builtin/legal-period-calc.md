---
id: legal-period-calc
name: 程序期限计算
version: "1"
description: 上诉、答辩、仲裁申请、再审、执行期间用规则引擎算届满日；不要口算
source: lawmind-builtin
tags: litigation, deadline, calculation
tools: calculate
---

# Skill · 程序期限计算

届满日必须调用 `calculate`，`op=legal_period`。模型只填起算日和期间种类。

## 种类

- `civil_appeal`：判决送达之次日起十五日
- `civil_answer`：起诉状副本送达之次日起十五日
- `labor_award_sue`：仲裁裁决送达之次日起十五日
- `labor_arbitration_apply`：知道权利被侵害之日起一年
- `civil_retrial`：生效后六个月
- `execution`：申请执行二年

## 交件

写清：起算事实、起算日、公式、届满日、【待核实】的中断/节假日顺延。缺起算日仍列出公式。
