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
- [ ] **完整工作队列台**（`GET /api/queues` 写侧处置）：案件概览已只读聚合；独立队列控制台仍非 Solo 刚需

### 半暴露 API（2026-07-21 · UI 已接通）

| API / 能力                                      | 状态    | 说明                                                        |
| ----------------------------------------------- | ------- | ----------------------------------------------------------- |
| `GET /api/queues`                               | partial | 读侧仍经 matter detail；完整队列台见上                      |
| `POST /api/sessions/:id/compact`                | done    | 对话 compose token 条「整理上下文」；`distill`→「沉淀学习」 |
| `POST /api/sessions/:id/messages/mutate`        | done    | 气泡修改/删除（truncate / delete_pair）                     |
| `POST /api/sessions/:id/abort`                  | done    | Compose「停止」协作式中止轮次                               |
| `POST /api/memory/adoption/suggest`             | done    | 设置 → 记忆库「主动提出记忆建议」                           |
| `POST /api/learning/contract-revision/finalize` | done    | 设置 → 记忆库合同学习「高级 finalize」                      |
| `GET /api/integrations` 目录                    | done    | Doctor 外部集成列表（兼 health + `/api/integrations`）      |
| `GET /api/assistants/:id/profile-sections`      | done    | 设置 → 助手「画像分段预览」                                 |

---

https://docs.lawmind.ai/LAWMIND-PROJECT-MEMORY（工程记忆可与本索引交叉引用）
