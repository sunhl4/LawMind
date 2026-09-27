import fs from "node:fs";
import path from "node:path";
import { loadMatter } from "../adapters/matter-storage/index.js";
import { partySidesFromCase } from "../cases/matter-profile.js";
import { hydrateMatterParties } from "../desk/matter-parties.js";
import { isUnderRoot, realpathOrResolve } from "./paths.js";
import type { HostMount } from "./types.js";

export type MatterParties = {
  clientId?: string;
  counterparty?: string;
  clientNames?: string[];
  counterpartyNames?: string[];
};

function packParties(clients: string[], counterparties: string[]): MatterParties {
  const clientId = clients[0];
  const counterparty = counterparties[0];
  return {
    ...(clientId ? { clientId } : {}),
    ...(counterparty ? { counterparty } : {}),
    ...(clients.length > 1 ? { clientNames: clients } : {}),
    ...(counterparties.length > 1 ? { counterpartyNames: counterparties } : {}),
  };
}

function partyNameKey(value: string): string {
  return value.replace(/\s+/g, "").trim();
}

function sideNames(side: MatterParties, kind: "client" | "counterparty"): string[] {
  const primary = kind === "client" ? side.clientId : side.counterparty;
  const extra = kind === "client" ? side.clientNames : side.counterpartyNames;
  return [
    ...new Set(
      [primary, ...(extra ?? [])]
        .filter((value): value is string => Boolean(value?.trim()))
        .map(partyNameKey)
        .filter((value) => value.length > 0),
    ),
  ];
}

export function readMatterParties(workspaceDir: string, matterId: string): MatterParties {
  const id = matterId.trim();
  if (!id) {
    return {};
  }
  try {
    const rec = loadMatter(workspaceDir, id);
    if (rec) {
      const hydrated = hydrateMatterParties(rec);
      const clients = [
        ...new Set(
          [rec.clientId, ...hydrated.filter((row) => row.role === "client").map((row) => row.name)]
            .map((name) => name?.trim() ?? "")
            .filter((name) => name.length > 0),
        ),
      ];
      const counterparties = [
        ...new Set(
          [
            rec.counterparty,
            ...hydrated.filter((row) => row.role === "counterparty").map((row) => row.name),
          ]
            .map((name) => name?.trim() ?? "")
            .filter((name) => name.length > 0),
        ),
      ];
      if (clients.length > 0 || counterparties.length > 0) {
        return packParties(clients, counterparties);
      }
    }
  } catch {
    /* CASE fallback below */
  }
  try {
    const raw = fs.readFileSync(path.join(workspaceDir, "cases", id, "CASE.md"), "utf8");
    const sides = partySidesFromCase(raw);
    return packParties(sides.clients, sides.counterparties);
  } catch {
    return {};
  }
}

export function partiesConflict(a: MatterParties, b: MatterParties): boolean {
  const aClients = sideNames(a, "client");
  const aCounterparties = sideNames(a, "counterparty");
  const bClients = sideNames(b, "client");
  const bCounterparties = sideNames(b, "counterparty");
  if (aClients.some((name) => bCounterparties.includes(name))) {
    return true;
  }
  if (aCounterparties.some((name) => bClients.includes(name))) {
    return true;
  }
  return false;
}

export function mattersConflict(
  workspaceDir: string,
  leftMatterId: string,
  rightMatterId: string,
): boolean {
  const left = leftMatterId.trim();
  const right = rightMatterId.trim();
  if (!left || !right || left === right) {
    return false;
  }
  return partiesConflict(
    readMatterParties(workspaceDir, left),
    readMatterParties(workspaceDir, right),
  );
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
