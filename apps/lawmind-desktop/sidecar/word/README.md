# LawMind Word / WPS 侧车

本机 LawMind 桌面跑着时，本地 API 就是 `lawmindd`。

1. 确认桌面已启动（默认 `http://127.0.0.1:4312`）。
2. 打开 `GET /api/sidecar/status` 应返回 `ready: true`。
3. Word 或 WPS：侧载 `manifest.xml`（任务窗格地址指向 `/sidecar/word/taskpane.html`）。
4. 选中条款，点「审这份 / 写这封 / 查这个问题」。选区写入工作区 `inbox/sidecar-*.md`。

侧车只把文字送到本机，不经过 LawMind 云端。
