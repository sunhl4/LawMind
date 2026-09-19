/**
 * Electron session hardening: CSP headers for the renderer.
 */

/**
 * @param {import("electron").Session} electronSession
 * @param {{ dev?: boolean }} [opts]
 */
export function installLawmindContentSecurityPolicy(electronSession, opts = {}) {
  const dev = opts.dev === true;
  const cspDirectives = [
    "default-src 'self'",
    // Vite dev injects inline module scripts + uses eval for HMR; strict script-src breaks Electron white screen.
    dev
      ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
      : "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    // 渲染器会把小字体内联成 data:（Vite assetsInlineLimit 默认 4KB）。
    // img-src 已允许 data:，字体同样属于应用自带资源；不加 data: 会被 CSP 拦下，
    // 用户侧表现为字体静默回退 + 控制台报错。
    "font-src 'self' data:",
    dev
      ? "connect-src 'self' http://127.0.0.1:* ws://127.0.0.1:* ws://localhost:* http://localhost:*"
      : "connect-src 'self' http://127.0.0.1:*",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'self'",
  ];
  const cspHeader = cspDirectives.join("; ");
  electronSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [cspHeader],
      },
    });
  });
}
