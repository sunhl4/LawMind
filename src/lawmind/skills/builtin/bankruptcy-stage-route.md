---
id: bankruptcy-stage-route
name: 破产阶段路由
version: "1"
description: 按申请受理、债权申报、重整/清算写材料，不混用民事起诉模板
source: lawmind-builtin
tags: litigation, bankruptcy, routing
workflows: litigation
---

# Skill · 破产阶段路由

按材料推断：申请与受理 → 债权申报 → 债权人会议 → 重整 / 和解 / 清算。文首写阶段。缺管理人信息标【待补充】仍出稿。

## 不要混

- 债权申报表不要写成起诉状。
- 重整计划草案与清算分配方案分清。
- 期限（申报截止、表决）能算则用 `calculate` / 期限规则，缺起算日列公式。
