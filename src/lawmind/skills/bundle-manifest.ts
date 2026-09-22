/**
 * 法律模板 / 技能包清单与 SHA-256 校验（本地信任根：不执行远程市场下载）。
 *
 * 清单放在 workspace 内，例如 `workspace/lawmind/bundles/my-firm.json`。
 */

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export type LawMindBundleEntryRole = "template" | "skill" | "doc";

export type LawMindBundleManifest = {
  schemaVersion: 1;
  bundleId: string;
  version: string;
  generatedAt: string;
  entries: Array<{
    /** 相对 workspace 根的路径，禁止含 .. */
    path: string;
    sha256: string;
    role: LawMindBundleEntryRole;
  }>;
};

function isSafeRel(p: string): boolean {
  const n = p.replace(/\\/g, "/").trim();
  return n.length > 0 && !n.includes("..") && !path.isAbsolute(n);
}

export function parseLawMindBundleManifest(raw: unknown): LawMindBundleManifest | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const o = raw as Record<string, unknown>;
  if (o.schemaVersion !== 1 || typeof o.bundleId !== "string" || typeof o.version !== "string") {
    return null;
  }
  if (typeof o.generatedAt !== "string" || !Array.isArray(o.entries)) {
    return null;
  }
  const entries: LawMindBundleManifest["entries"] = [];
  for (const e of o.entries) {
    if (!e || typeof e !== "object") {
      return null;
    }
    const row = e as Record<string, unknown>;
    if (
      typeof row.path !== "string" ||
      typeof row.sha256 !== "string" ||
      typeof row.role !== "string"
    ) {
      return null;
    }
    if (!["template", "skill", "doc"].includes(row.role)) {
      return null;
    }
    entries.push({
      path: row.path,
      sha256: row.sha256.toLowerCase(),
      role: row.role as LawMindBundleEntryRole,
    });
  }
  return {
    schemaVersion: 1,
    bundleId: o.bundleId,
    version: o.version,
    generatedAt: o.generatedAt,
    entries,
  };
}

function sha256File(abs: string): string {
  const buf = fs.readFileSync(abs);
  return createHash("sha256").update(buf).digest("hex");
}

/**
 * 校验清单内每项路径落在 workspace 下且哈希一致。
 */
export function verifyLawMindBundleManifest(
  workspaceDir: string,
  manifest: LawMindBundleManifest,
): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  const root = path.resolve(workspaceDir);
  for (const ent of manifest.entries) {
    if (!isSafeRel(ent.path)) {
      errors.push(`unsafe path: ${ent.path}`);
      continue;
    }
    const abs = path.resolve(root, ent.path);
    if (abs !== root && !abs.startsWith(root + path.sep)) {
      errors.push(`escapes workspace: ${ent.path}`);
      continue;
    }
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
      errors.push(`missing file: ${ent.path}`);
      continue;
    }
    const hash = sha256File(abs);
    if (hash !== ent.sha256.toLowerCase()) {
      errors.push(`sha256 mismatch: ${ent.path} (expected ${ent.sha256}, got ${hash})`);
    }
  }
  return { ok: errors.length === 0, errors };
}
