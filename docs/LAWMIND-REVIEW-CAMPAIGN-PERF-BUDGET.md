# 审查专案组性能预算（G2）

Solo / Firm / Private 在 `edition.ts` 均默认 **`reviewCampaignParallel=true`**（本地启发式并行时间戳，非 LLM 真并行）。仍可按 playbook `executionMode: "serial"` 或调用方 `preferParallel: false` 走串行启发式。

## 目标（样例合同 ≤ 40KB 正文）

| 指标       | 串行启发式        | parallel 闸门开（默认）    |
| ---------- | ----------------- | -------------------------- |
| 墙钟时间   | ≤ 2s              | ≤ 2s（启发式）             |
| 角色数     | ≥ 4（标准剧本 5） | 同左                       |
| 持久化写盘 | 1 次完成态 JSON   | 同左                       |
| LLM 调用   | 0（MVP 启发式）   | 0（真并行 LLM 见 backlog） |

## 实现约束

- `src/lawmind/review-campaign/serial-runner.ts`：每角色独立启发式，禁止跨角色网络 I/O。
- 文书台 Sticky 仅展示聚合 Score；重跑单角色不重跑全场。
- 超预算时：UI 显示阶段进度；设置「更快模式」可跳过低权重角色（见专案组面板）。

## 验收

- 单元：`safety-score` / `parallel-gate` 可复现 Score。
- e2e：`e2e/review-campaign.spec.ts` 跑通主路径。
