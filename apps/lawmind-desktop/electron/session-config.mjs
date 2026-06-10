/**
 * Electron session hardening: CSP headers for the renderer.
 */

/**
 * @param {import("electron").Session} electronSession
 */
export function installLawmindContentSecurityPolicy(electronSession) {
  const cspDirectives = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self' http://127.0.0.1:*",
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
