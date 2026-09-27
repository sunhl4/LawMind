/**
 * 案件云地址与令牌。不进 lawmind.policy.json（策略文件拒绝这两项）。
 * 令牌只在本机，权限 0600。
 */

import fs from "node:fs";
import path from "node:path";

export type CloudLink = {
  endpoint: string;
  token: string;
};

function linkPath(workspaceDir: string): string {
  return path.join(path.resolve(workspaceDir), "lawmind", "cloud-link.json");
}

export function readCloudLink(workspaceDir: string): CloudLink | null {
  const file = linkPath(workspaceDir);
  try {
    if (!fs.existsSync(file)) {
      return null;
    }
    const raw = JSON.parse(fs.readFileSync(file, "utf8")) as {
      endpoint?: unknown;
      token?: unknown;
    };
    const endpoint = typeof raw.endpoint === "string" ? raw.endpoint.trim() : "";
    const token = typeof raw.token === "string" ? raw.token.trim() : "";
    if (!endpoint || !token) {
      return null;
    }
    return { endpoint, token };
  } catch {
    return null;
  }
}

export function writeCloudLink(workspaceDir: string, link: CloudLink): void {
  const endpoint = link.endpoint.trim().replace(/\/+$/, "");
  const token = link.token.trim();
  if (!endpoint || !token) {
    throw new Error("案件云地址和令牌都不能空");
  }
  const file = linkPath(workspaceDir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify({ endpoint, token }, null, 2)}\n`, { mode: 0o600 });
  fs.chmodSync(file, 0o600);
}
