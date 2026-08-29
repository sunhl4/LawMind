/**
 * Commercial BFF stub — always 501 until USER deploys a real proxy.
 * Run: node --import tsx apps/lawmind-commercial-bff/stub-server.ts
 */

import http from "node:http";
import { isCommercialBuild, isPlatformAuthorityProxyEnabled } from "../../src/lawmind/build-channel.js";

const port = Number(process.env.LAWMIND_COMMERCIAL_BFF_PORT ?? "8787");

const server = http.createServer((req, res) => {
  const body = {
    ok: false,
    code: "commercial_bff_not_implemented",
    buildChannel: isCommercialBuild() ? "commercial" : "oss",
    proxyEnabled: isPlatformAuthorityProxyEnabled(),
    message:
      "平台权威 BFF 仅为占位：请按 apps/lawmind-commercial-bff/README.md 部署真实代理并注入主密钥。",
    path: req.url,
  };
  res.writeHead(501, { "content-type": "application/json; charset=utf-8" });
  res.end(`${JSON.stringify(body, null, 2)}\n`);
});

server.listen(port, "127.0.0.1", () => {
  console.log(`[lawmind-commercial-bff-stub] http://127.0.0.1:${port} (501 placeholder)`);
});
