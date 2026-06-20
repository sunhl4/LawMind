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
    "font-src 'self'",
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
