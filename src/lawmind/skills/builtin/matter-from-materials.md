---
id: matter-from-materials
name: 从材料建事项
version: "4"
description: 扫描已给材料，抽出当事人案由并归位；对话写穿卷宗与期限
source: lawmind-builtin
tags: matter, intake, ops
tools: explore_folder, read_folder_documents, import_host_file, update_matter_profile, extract_legal_events, apply_legal_events, compile_intake_brief, apply_intake_brief, add_case_note
---

# Skill · 从材料建事项

把已附文件夹或附件整理成可办案卷结构。不要先做利益冲突问卷。

## 做

1. 列文件并读正文，按委托、证据、对方文书、我方文稿、财务归类（`read_folder_documents` 一次读完；或 `explore_folder` / `list_dir` 先看树）。
2. 抽出：当事人、案由/交易类型、关键日期、金额（标的额照原文写进 `update_matter_profile` 的 `claim_amount`）；保全/查封到期日按 `preservation` 期限写；需要归档用 `import_host_file`。
3. 诉讼默认目录：日程与期限、委托、证据、对方材料、我方文稿、裁判与笔录、交付。咨询可简化为客户材料 + 工作文件。知产争议加：权利证书、申请/登记文件、被控侵权材料。
4. **对话路径**：读到的案号/法院/当事人用 `update_matter_profile`；传票类 `apply_legal_events`；谈话类 `compile_intake_brief` → `apply_intake_brief`；争点用 `add_case_note`。缺的标【待补充】，不编字段。
5. 仅当前对话**未关联案件**时才可 `create_matter`；已有案件禁止另造一卷。
