/**
 * Recover from renderer load failures / process crashes without quitting the app.
 */
import { BrowserWindow, app } from "electron";

/**
 * @param {import("electron").BrowserWindow} win
 * @param {(w: import("electron").BrowserWindow, hash?: string) => Promise<void>} reload
 */
export function installRendererRecovery(win, reload) {
  if (!win || win.isDestroyed()) {
    return;
  }
  const contents = win.webContents;
  let failRetries = 0;
  let goneRetries = 0;
  const maxRetries = 3;

  contents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (!isMainFrame || win.isDestroyed()) {
      return;
    }
    // -3 = ERR_ABORTED (often navigation cancel); ignore.
    if (errorCode === -3) {
      return;
    }
    console.warn(
      `[LawMind] did-fail-load code=${errorCode} ${errorDescription} url=${validatedURL} retry=${failRetries}`,
    );
    if (failRetries >= maxRetries) {
      void contents.loadURL(
        `data:text/html;charset=utf-8,${encodeURIComponent(
          `<!doctype html><meta charset="utf-8"><title>LawMind</title>
<body style="font-family:system-ui;padding:40px;background:#f7f6f3;color:#1a1a1a">
<h1>LawMind 未能打开界面</h1>
<p>${String(errorDescription || "加载失败")}（${errorCode}）</p>
<p>请关闭后重新打开应用，或检查开发服务是否在跑。</p>
</body>`,
        )}`,
      );
      return;
    }
    failRetries += 1;
    const delayMs = 400 * failRetries;
    setTimeout(() => {
      if (!win.isDestroyed()) {
        void reload(win).catch((err) => {
          console.warn("[LawMind] reload after did-fail-load:", err);
        });
      }
    }, delayMs);
  });

  contents.on("did-finish-load", () => {
    failRetries = 0;
  });

  contents.on("render-process-gone", (_event, details) => {
    console.warn(`[LawMind] render-process-gone reason=${details?.reason} exit=${details?.exitCode}`);
    if (win.isDestroyed()) {
      return;
    }
    if (goneRetries >= maxRetries) {
      return;
    }
    goneRetries += 1;
    setTimeout(() => {
      if (!win.isDestroyed()) {
        void reload(win).catch((err) => {
          console.warn("[LawMind] reload after render-process-gone:", err);
        });
      }
    }, 500 * goneRetries);
  });
}

/**
 * Keep a single recovery install per window; used by main + activate.
 * @param {() => Promise<void>} createWindow
 */
export function installAppRendererProcessGoneHandler(createWindow) {
  app.on("render-process-gone", (_event, webContents, details) => {
    console.warn(
      `[LawMind] app render-process-gone reason=${details?.reason} exit=${details?.exitCode}`,
    );
    const win = BrowserWindow.fromWebContents(webContents);
    if (win && !win.isDestroyed()) {
      return;
    }
    // Orphaned process — open a fresh window if none left.
    if (BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed()).length === 0) {
      void createWindow().catch((err) => {
        console.warn("[LawMind] recreate window after render-process-gone:", err);
      });
    }
  });
}
