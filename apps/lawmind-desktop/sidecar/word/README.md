# LawMind Word / WPS 侧车

本机 `lawmindd`（桌面或 `pnpm lawmind:daemon`）就是侧车要连的 HTTP。不经过 LawMind 云端。

1. 启动守护进程，并与桌面使用**同一工作区**：

   ```bash
   pnpm lawmind:daemon -- --workspace /path/to/workspace
   ```

   默认监听 `http://127.0.0.1:4312`。桌面 Electron 在 4312 空闲时也会优先占用该端口。
2. `GET /api/sidecar/status` 应返回 `ready: true`。工作区会写入 `lawmind/lawmindd.json`。
3. Word 或 WPS：侧载 `manifest.xml`（任务窗格地址指向 `/sidecar/word/taskpane.html`）。若端口不是 4312，从正在运行的守护进程下载 `/sidecar/word/manifest.xml`，其中的地址会改成实际端口。
4. 选中条款，点「审这份 / 写这封 / 查这个问题」。选区写入工作区 `inbox/sidecar-*.md`。
5. 打开 LawMind 桌面对话，顶栏会出现「填入对话」：写入动词提示并钉上该 inbox 文件。
