/**
 * Matter-scoped parties: role + 送达, not a firm CRM.
 * Identity names are the same strings ethics wall / conflict scan already use.
 */

export const MATTER_PARTIES_CAP = 8;

export const MATTER_PARTY_ROLES = ["client", "counterparty", "agent", "counsel", "other"] as const;
export type MatterPartyRole = (typeof MATTER_PARTY_ROLES)[number];

export const MATTER_PARTY_SERVICE_METHODS = ["mail", "electronic", "in_person", "unknown"] as const;
export type MatterPartyServiceMethod = (typeof MATTER_PARTY_SERVICE_METHODS)[number];

export type MatterParty = {
  partyId: string;
  name: string;
  role: MatterPartyRole;
  standing?: string;
  serviceAddress?: string;
  serviceMethod?: MatterPartyServiceMethod;
};

export const MATTER_PARTY_ROLE_ZH: Record<MatterPartyRole, string> = {
  client: "委托人",
  counterparty: "对方",
  agent: "代收人",
  counsel: "对方代理",
  other: "其他",
};

export const MATTER_PARTY_SERVICE_ZH: Record<MatterPartyServiceMethod, string> = {
  mail: "邮寄",
  electronic: "电子送达",
  in_person: "当面",
  unknown: "未标明",
};

function isRole(value: string): value is MatterPartyRole {
  return (MATTER_PARTY_ROLES as readonly string[]).includes(value);
}

function isServiceMethod(value: string): value is MatterPartyServiceMethod {
  return (MATTER_PARTY_SERVICE_METHODS as readonly string[]).includes(value);
}

function allocatePartyId(seen: Set<string>, role: MatterPartyRole): string {
  const preferred = `p-${role}`;
  if (!seen.has(preferred)) {
    return preferred;
  }
  for (let i = 2; i < 24; i += 1) {
    const id = `p-${role}-${i}`;
    if (!seen.has(id)) {
      return id;
    }
  }
  let n = 1;
  while (seen.has(`p-${n}`)) {
    n += 1;
  }
  return `p-${n}`;
}

export function normalizeMatterParties(input: readonly MatterParty[]): MatterParty[] {
  const seen = new Set<string>();
  const out: MatterParty[] = [];
  for (const raw of input) {
    if (out.length >= MATTER_PARTIES_CAP) {
      break;
    }
    const name = raw.name?.trim().slice(0, 120) ?? "";
    if (!name) {
      continue;
    }
    const role = isRole(raw.role) ? raw.role : "other";
    let partyId = raw.partyId?.trim().slice(0, 64) ?? "";
    if (!partyId || seen.has(partyId)) {
      partyId = allocatePartyId(seen, role);
    }
    seen.add(partyId);
    const standing = raw.standing?.trim().slice(0, 40) || undefined;
    const serviceAddress = raw.serviceAddress?.trim().slice(0, 200) || undefined;
    const serviceMethod =
      raw.serviceMethod && isServiceMethod(raw.serviceMethod)
        ? raw.serviceMethod
        : serviceAddress
          ? "unknown"
          : undefined;
    out.push({
      partyId,
      name,
      role,
      ...(standing ? { standing } : {}),
      ...(serviceAddress ? { serviceAddress } : {}),
      ...(serviceMethod ? { serviceMethod } : {}),
    });
  }
  return out;
}

export function hydrateMatterParties(input: {
  parties?: MatterParty[];
  clientId?: string;
  counterparty?: string;
}): MatterParty[] {
  if (input.parties && input.parties.length > 0) {
    return normalizeMatterParties(input.parties);
  }
  return normalizeMatterParties([
    ...(input.clientId?.trim()
      ? [{ partyId: "p-client", name: input.clientId.trim(), role: "client" as const }]
      : []),
    ...(input.counterparty?.trim()
      ? [
          {
            partyId: "p-counterparty",
            name: input.counterparty.trim(),
            role: "counterparty" as const,
          },
        ]
      : []),
  ]);
}

export function deriveMatterIdentity(parties: readonly MatterParty[]): {
  clientId?: string;
  counterparty?: string;
} {
  const client = parties.find((row) => row.role === "client");
  const counterparty = parties.find((row) => row.role === "counterparty");
  return {
    ...(client?.name ? { clientId: client.name } : {}),
    ...(counterparty?.name ? { counterparty: counterparty.name } : {}),
  };
}

function upsertRoleName(
  parties: MatterParty[],
  role: "client" | "counterparty",
  name: string | undefined,
): MatterParty[] {
  const idx = parties.findIndex((row) => row.role === role);
  if (!name) {
    if (idx < 0) {
      return parties;
    }
    return parties.filter((_, i) => i !== idx);
  }
  if (idx >= 0) {
    const next = [...parties];
    next[idx] = { ...next[idx], name };
    return next;
  }
  return [...parties, { partyId: `p-${role}`, name, role }];
}

/** When desk still sends clientId/counterparty strings, keep extra roles (代收人) intact. */
export function syncLegacyIdentityIntoParties(
  existing: MatterParty[] | undefined,
  clientId: string | undefined,
  counterparty: string | undefined,
): MatterParty[] | undefined {
  const next = upsertRoleName(
    upsertRoleName(existing ? [...existing] : [], "client", clientId),
    "counterparty",
    counterparty,
  );
  const normalized = normalizeMatterParties(next);
  return normalized.length > 0 ? normalized : undefined;
}

export function matterPartyEditorDrafts(parties: readonly MatterParty[]): MatterParty[] {
  const rows = [...parties];
  if (!rows.some((row) => row.role === "client")) {
    rows.unshift({ partyId: "p-client", name: "", role: "client" });
  }
  if (!rows.some((row) => row.role === "counterparty")) {
    const afterClient = rows.findIndex((row) => row.role === "client");
    rows.splice(afterClient + 1, 0, { partyId: "p-counterparty", name: "", role: "counterparty" });
  }
  return rows;
}

export function formatPartyServiceLine(party: MatterParty): string | undefined {
  const method =
    party.serviceMethod && party.serviceMethod !== "unknown"
      ? MATTER_PARTY_SERVICE_ZH[party.serviceMethod]
      : undefined;
  const line = [method, party.serviceAddress?.trim()].filter(Boolean).join(" · ");
  return line || undefined;
}

export function matterPartyIdentityNames(input: {
  parties?: MatterParty[];
  clientId?: string;
  counterparty?: string;
}): string[] {
  const names = hydrateMatterParties(input).map((row) => row.name);
  return [...new Set(names)];
}
