# LawMind 暂缓 / 待办记录

本页集中记录**已讨论但暂不实施**或**依赖外部决策**的事项，便于后续检索。实施时请从此处勾选或删除条目，并在对应 PR 中链接本文路径。

## 文档与发布

- [ ] **LawMind 文档站自动发布**：在 `apps/lawmind-docs`（VitePress）基础上，增加推送到 `main` 或 tag 时自动部署到 **GitHub Pages / Cloudflare Pages** 等工作流，并配置 `base`、自定义域名与缓存策略。本地验证命令：`pnpm lawmind:docs:build`，产出目录 `apps/lawmind-docs/docs/.vitepress/dist`。详见 [apps/lawmind-docs/README.md](../apps/lawmind-docs/README.md)。

## 产品（可选增强）

- [ ] **智能体层级强制策略**：当前已在档案中存储 `orgRole` / `reportsToAssistantId` 并注入 Prompt；若需在 `validateDelegation` 或 `lawmind.policy.json` 中**强制**「仅可向汇报对象委派」等规则，可在此处立项。
- [ ] **互审轮次与版本**：`request_review` 与 workflow `reviewBy` 为单轮；多轮互审、留痕与 UI 时间线可后续扩展。

---

https://docs.lawmind.ai/LAWMIND-PROJECT-MEMORY（工程记忆可与本索引交叉引用）
