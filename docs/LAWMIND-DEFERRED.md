# LawMind 暂缓 / 待办记录

本页为**短索引**。凡属「已识别、长期要回看」的问题，请优先写入并维护：

**→ [LAWMIND-FUTURE-ISSUES.md](./LAWMIND-FUTURE-ISSUES.md)（「未来问题」总册）**

持久化 / token / 扫盘专项审查：

**→ [LAWMIND-PERSISTENCE-SCALE-REVIEW.md](./LAWMIND-PERSISTENCE-SCALE-REVIEW.md)**

---

## 仍挂在本页的短项（未迁完时可留）

### 文档与发布

- [x] **LawMind 文档站 CI 构建**：`.github/workflows/lawmind-docs.yml`；nightly 纳入 `pnpm lawmind:verify`。
- [ ] **LawMind 文档站自动发布到托管**：见 [FUTURE-ISSUES §3](./LAWMIND-FUTURE-ISSUES.md)。

### 产品（可选增强）

- [ ] **智能体层级强制策略** → FUTURE-ISSUES §3
- [ ] **互审轮次与版本** → FUTURE-ISSUES §3

### 半暴露 API（2026-07-19 Wave D：标 deferred，暂不铺完整 UI）

下列能力引擎/HTTP 已有，桌面**不**作为一等入口；案件概览「工作队列」等若已展示读侧数据，仍属只读聚合，不等于完整队列台：

| API / 能力                                      | 状态     | 说明                                        |
| ----------------------------------------------- | -------- | ------------------------------------------- |
| `GET /api/queues`                               | deferred | 写侧 JSONL 存在；完整队列台未做             |
| `POST /api/sessions/:id/compact`                | deferred | 上下文预算条可读；无「整理上下文」按钮      |
| `POST /api/memory/adoption/suggest`             | deferred | 采纳/忽略 UI 在记忆库；无主动 suggest       |
| `POST /api/learning/contract-revision/finalize` | deferred | 列表/学习面板部分消费；finalize 无按钮      |
| `GET /api/integrations` 目录                    | deferred | 案件 documents 子路径可用；连接器目录页未做 |
| `GET /api/assistants/:id/profile-sections`      | deferred | 助手编辑未展示分段预览                      |

---

https://docs.lawmind.ai/LAWMIND-PROJECT-MEMORY（工程记忆可与本索引交叉引用）
