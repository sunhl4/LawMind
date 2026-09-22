import fs from "node:fs";
import path from "node:path";
import { loadMatter } from "../adapters/matter-storage/index.js";
import { parseMatterCaseProfileFields } from "../cases/matter-profile.js";
import { deriveMatterIdentity, hydrateMatterParties } from "../desk/matter-parties.js";
import { isUnderRoot, realpathOrResolve } from "./paths.js";
import type { HostMount } from "./types.js";

export type MatterParties = { clientId?: string; counterparty?: string };

export function readMatterParties(workspaceDir: string, matterId: string): MatterParties {
  const id = matterId.trim();
  if (!id) {
    return {};
  }
  try {
    const rec = loadMatter(workspaceDir, id);
    if (rec) {
      const derived = deriveMatterIdentity(hydrateMatterParties(rec));
      const clientId = rec.clientId?.trim() || derived.clientId;
      const counterparty = rec.counterparty?.trim() || derived.counterparty;
      if (clientId || counterparty) {
        return { clientId, counterparty };
      }
    }
  } catch {
    /* CASE fallback below */
  }
  try {
    const raw = fs.readFileSync(path.join(workspaceDir, "cases", id, "CASE.md"), "utf8");
    const parsed = parseMatterCaseProfileFields(raw);
    return {
      clientId: parsed.clientIdFromCase?.trim() || undefined,
      counterparty: parsed.counterparty?.trim() || undefined,
    };
  } catch {
    return {};
  }
}

export function partiesConflict(a: MatterParties, b: MatterParties): boolean {
  if (a.clientId && b.counterparty && a.clientId === b.counterparty) {
    return true;
  }
  if (a.counterparty && b.clientId && a.counterparty === b.clientId) {
    return true;
  }
  return false;
}

export function mountBoundToOtherMatter(mount: HostMount, sessionMatterId?: string): boolean {
  const bound = mount.matterId?.trim();
  const current = sessionMatterId?.trim();
  if (!bound || !current) {
    return false;
  }
  return bound !== current;
}

export function activeMountsForSession(opts: {
  mounts: HostMount[];
  workspaceDir: string;
  sessionMatterId?: string;
  allowCrossMatterMounts: boolean;
  mode: "matter" | "mounts" | "locate" | "command";
}): {
  active: HostMount[];
  blocked: Array<{ mount: HostMount; reason: "cross_matter" | "ethical_wall" | "matter_mode" }>;
} {
  const blocked: Array<{
    mount: HostMount;
    reason: "cross_matter" | "ethical_wall" | "matter_mode";
  }> = [];
  if (opts.mode === "matter") {
    return {
      active: [],
      blocked: opts.mounts.map((mount) => ({ mount, reason: "matter_mode" as const })),
    };
  }

  const currentParties = opts.sessionMatterId
    ? readMatterParties(opts.workspaceDir, opts.sessionMatterId)
    : {};

  const active: HostMount[] = [];
  const acceptedParties: MatterParties[] =
    currentParties.clientId || currentParties.counterparty ? [currentParties] : [];

  for (const mount of opts.mounts) {
    if (mountBoundToOtherMatter(mount, opts.sessionMatterId)) {
      if (!opts.allowCrossMatterMounts) {
        blocked.push({ mount, reason: "cross_matter" });
        continue;
      }
    }
    const boundId = mount.matterId?.trim();
    const mountParties = boundId ? readMatterParties(opts.workspaceDir, boundId) : {};
    if (
      (mountParties.clientId || mountParties.counterparty) &&
      acceptedParties.some((p) => partiesConflict(p, mountParties))
    ) {
      blocked.push({ mount, reason: "ethical_wall" });
      continue;
    }
    active.push(mount);
    if (mountParties.clientId || mountParties.counterparty) {
      acceptedParties.push(mountParties);
    }
  }
  return { active, blocked };
}

export function workspaceOtherMatterDenied(
  workspaceDir: string,
  absPath: string,
  sessionMatterId?: string,
): boolean {
  const current = sessionMatterId?.trim();
  if (!current) {
    return false;
  }
  const casesRoot = realpathOrResolve(path.join(workspaceDir, "cases"));
  const abs = realpathOrResolve(absPath);
  if (!isUnderRoot(casesRoot, abs)) {
    return false;
  }
  const rel = path.relative(casesRoot, abs).replace(/\\/g, "/");
  const otherId = rel.split("/")[0] ?? "";
  return Boolean(otherId && otherId !== current && otherId !== "..");
}
