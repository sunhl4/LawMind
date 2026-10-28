/**
 * Matter-scoped parties: role + 送达, not a firm CRM.
 * Identity names are the same strings ethics wall / conflict scan already use.
 */

/**
 * 当事人上限。共同诉讼（多被告/多第三人）常超 8 人，旧值 8 会把第 9 人起静默丢弃。
 * 上限只防病态输入，不应当成为"填不全当事人"的原因。
 */
export const MATTER_PARTIES_CAP = 32;

export class MatterPartiesCapError extends Error {
  readonly code = "matter_parties_cap";

  constructor(
    readonly cap: number,
    readonly submitted: number,
  ) {
    super(`matter_parties_cap:${cap}`);
    this.name = "MatterPartiesCapError";
  }
}

export function namedPartyCount(input: readonly { name?: string }[]): number {
  return input.reduce((count, row) => count + (row.name?.trim() ? 1 : 0), 0);
}

export const MATTER_PARTY_ROLES = ["client", "counterparty", "agent", "counsel", "other"] as const;
export type MatterPartyRole = (typeof MATTER_PARTY_ROLES)[number];

export const MATTER_PARTY_SERVICE_METHODS = ["mail", "electronic", "in_person", "unknown"] as const;
export type MatterPartyServiceMethod = (typeof MATTER_PARTY_SERVICE_METHODS)[number];

export const MATTER_PARTY_CONTACT_KINDS = ["email", "phone", "wecom"] as const;
export type MatterPartyContactKind = (typeof MATTER_PARTY_CONTACT_KINDS)[number];

export const MATTER_PARTY_CONTACT_SOURCES = ["lawyer", "intake_confirmed", "document"] as const;
export type MatterPartyContactSource = (typeof MATTER_PARTY_CONTACT_SOURCES)[number];

export const MATTER_PARTY_CONSENT_STATES = ["granted", "denied", "unknown"] as const;
export type MatterPartyConsentState = (typeof MATTER_PARTY_CONSENT_STATES)[number];

/** 同意状态要能回答「谁在什么时候给的」；缺字段按 unknown，不按默认同意。 */
export type MatterPartyConsent = {
  state: MatterPartyConsentState;
  at?: string;
  source?: MatterPartyContactSource;
};

export type MatterPartyConsentPurpose = "recording" | "archive";

/**
 * 收件判案只把 verified=true 当强键：律师亲手登记，或在「待归档」里确认过。
 * 从材料里抽出的号码（source=document）只算弱线索。
 *
 * 身份同一性看 `kind + account + (externalId 优先于展示值)`：
 * 同一个邮箱挂在不同收案账户下是两条身份，不合并；同一个企微 external userid
 * 在同一账户下才是同一条。
 */
export type MatterPartyContact = {
  kind: MatterPartyContactKind;
  value: string;
  /** 渠道账户：收案邮箱地址、企微企业/应用、电话线路。 */
  account?: string;
  /** 渠道侧 id（企微 external userid 等）。 */
  externalId?: string;
  verified?: boolean;
  source?: MatterPartyContactSource;
  addedAt?: string;
  /** 录音同意（电话/会议）。 */
  recordingConsent?: MatterPartyConsent;
  /** 会话存档同意（企微等）。 */
  archiveConsent?: MatterPartyConsent;
};

export const MATTER_PARTY_CONTACTS_CAP = 8;

export type MatterParty = {
  partyId: string;
  name: string;
  role: MatterPartyRole;
  standing?: string;
  serviceAddress?: string;
  serviceMethod?: MatterPartyServiceMethod;
  contacts?: MatterPartyContact[];
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

function isContactKind(value: string): value is MatterPartyContactKind {
  return (MATTER_PARTY_CONTACT_KINDS as readonly string[]).includes(value);
}

function isContactSource(value: string): value is MatterPartyContactSource {
  return (MATTER_PARTY_CONTACT_SOURCES as readonly string[]).includes(value);
}

/** 比对用的联系方式。邮箱小写；手机号去掉分隔符和 +86；不合格返回 undefined。 */
export function normalizeContactValue(
  kind: MatterPartyContactKind,
  raw: string,
): string | undefined {
  const value = raw.normalize("NFKC").trim();
  if (kind === "email") {
    const email = value.toLowerCase();
    return email.length <= 254 && /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/.test(email)
      ? email
      : undefined;
  }
  if (kind === "phone") {
    const compact = value.replace(/[\s\-().]/g, "");
    const mainland = /^(?:\+?86|0086)(1\d{10})$/.exec(compact);
    const phone = mainland?.[1] ?? compact;
    return /^\+?\d{5,20}$/.test(phone) ? phone : undefined;
  }
  return /^[\w.@-]{1,128}$/.test(value) ? value : undefined;
}

export function normalizeContactAccount(raw: string | undefined): string | undefined {
  const value = raw?.normalize("NFKC").trim().toLowerCase();
  return value && value.length <= 80 ? value : undefined;
}

export function normalizeContactExternalId(raw: string | undefined): string | undefined {
  const value = raw?.normalize("NFKC").trim();
  return value && value.length <= 128 ? value : undefined;
}

/**
 * 身份键：kind + account +（externalId 优先于展示值）。
 * 同值跨账户是两条身份；同一账户下同一 externalId 才是同一条。
 */
export function contactIdentityKey(
  contact: Pick<MatterPartyContact, "kind" | "value" | "account" | "externalId">,
): string {
  const account = normalizeContactAccount(contact.account) ?? "";
  const externalId = normalizeContactExternalId(contact.externalId);
  const ref =
    externalId !== undefined
      ? `id:${externalId}`
      : (normalizeContactValue(contact.kind, contact.value) ??
        contact.value.normalize("NFKC").trim().toLowerCase());
  return `${contact.kind}|${account}|${ref}`;
}

function normalizeConsent(raw: MatterPartyConsent | undefined): MatterPartyConsent | undefined {
  if (!raw || !(MATTER_PARTY_CONSENT_STATES as readonly string[]).includes(raw.state)) {
    return undefined;
  }
  const at = raw.at?.trim();
  return {
    state: raw.state,
    ...(at ? { at } : {}),
    ...(raw.source && isContactSource(raw.source) ? { source: raw.source } : {}),
  };
}

/** 同一条身份被两次登记时，同意状态取更保守的一侧：拒绝 > 同意 > 未知。 */
function mergeConsent(
  existing: MatterPartyConsent | undefined,
  incoming: MatterPartyConsent | undefined,
): MatterPartyConsent | undefined {
  if (!existing) {
    return incoming;
  }
  if (!incoming) {
    return existing;
  }
  if (existing.state === "denied" || incoming.state === "denied") {
    return existing.state === "denied" ? existing : incoming;
  }
  if (existing.state === "granted" || incoming.state === "granted") {
    return existing.state === "granted" ? existing : incoming;
  }
  return existing;
}

/** 没有登记过就按 unknown：不把「没记录」当成同意。 */
export function contactConsentState(
  contact: MatterPartyContact,
  purpose: MatterPartyConsentPurpose,
): MatterPartyConsentState {
  const consent = purpose === "recording" ? contact.recordingConsent : contact.archiveConsent;
  return consent?.state ?? "unknown";
}

export function normalizeMatterPartyContacts(
  input: readonly MatterPartyContact[] | undefined,
): MatterPartyContact[] {
  if (!input) {
    return [];
  }
  const out: MatterPartyContact[] = [];
  for (const raw of input) {
    if (!raw || typeof raw.value !== "string" || !isContactKind(raw.kind)) {
      continue;
    }
    const value = normalizeContactValue(raw.kind, raw.value);
    if (!value) {
      continue;
    }
    const account = normalizeContactAccount(raw.account);
    const externalId = normalizeContactExternalId(raw.externalId);
    const recordingConsent = normalizeConsent(raw.recordingConsent);
    const archiveConsent = normalizeConsent(raw.archiveConsent);
    const contact: MatterPartyContact = {
      kind: raw.kind,
      value,
      ...(account ? { account } : {}),
      ...(externalId ? { externalId } : {}),
      ...(raw.verified === true ? { verified: true } : {}),
      ...(raw.source && isContactSource(raw.source) ? { source: raw.source } : {}),
      ...(raw.addedAt?.trim() ? { addedAt: raw.addedAt.trim() } : {}),
      ...(recordingConsent ? { recordingConsent } : {}),
      ...(archiveConsent ? { archiveConsent } : {}),
    };
    const key = contactIdentityKey(contact);
    const dup = out.find((row) => contactIdentityKey(row) === key);
    if (dup) {
      if (contact.verified === true) {
        dup.verified = true;
      }
      if (!dup.source && contact.source) {
        dup.source = contact.source;
      }
      const recording = mergeConsent(dup.recordingConsent, contact.recordingConsent);
      if (recording) {
        dup.recordingConsent = recording;
      }
      const archive = mergeConsent(dup.archiveConsent, contact.archiveConsent);
      if (archive) {
        dup.archiveConsent = archive;
      }
      continue;
    }
    if (out.length >= MATTER_PARTY_CONTACTS_CAP) {
      continue;
    }
    out.push(contact);
  }
  return out;
}

/** 同一身份键登记在多个当事人名下时返回出来，供编辑器提示；不静默合并当事人。 */
export function duplicateContactIdentities(
  parties: readonly MatterParty[],
): Array<{ key: string; partyIds: string[] }> {
  const byKey = new Map<string, Set<string>>();
  for (const party of parties) {
    for (const contact of party.contacts ?? []) {
      const key = contactIdentityKey(contact);
      const ids = byKey.get(key) ?? new Set<string>();
      ids.add(party.partyId);
      byKey.set(key, ids);
    }
  }
  return [...byKey.entries()]
    .filter(([, ids]) => ids.size > 1)
    .map(([key, ids]) => ({ key, partyIds: [...ids].toSorted() }))
    .toSorted((a, b) => a.key.localeCompare(b.key));
}

/** 当事人编辑器回传时不带 contacts：按 partyId 沿用原有联系方式。显式给 [] 才是清空。 */
export function carryPartyContacts(
  input: readonly MatterParty[],
  existing: readonly MatterParty[] | undefined,
): MatterParty[] {
  return input.map((row) => {
    if (row.contacts !== undefined) {
      return row;
    }
    const prior = existing?.find((p) => p.partyId === row.partyId)?.contacts;
    return prior && prior.length > 0 ? { ...row, contacts: prior } : row;
  });
}

/** 把联系方式记到某个当事人名下；已存在则补上 verified。 */
export function upsertPartyContact(
  parties: readonly MatterParty[],
  partyId: string,
  contact: MatterPartyContact,
): MatterParty[] | undefined {
  const idx = parties.findIndex((row) => row.partyId === partyId);
  if (idx < 0) {
    return undefined;
  }
  const next = [...parties];
  const party = next[idx];
  next[idx] = {
    ...party,
    contacts: normalizeMatterPartyContacts([...(party.contacts ?? []), contact]),
  };
  return next;
}

/** 从全部当事人（或指定当事人）名下删掉这一条联系方式。给了 account 时只删同一账户。 */
export function removePartyContact(
  parties: readonly MatterParty[],
  kind: MatterPartyContactKind,
  rawValue: string,
  partyId?: string,
  account?: string,
): MatterParty[] {
  const value = normalizeContactValue(kind, rawValue);
  const accountKey = normalizeContactAccount(account);
  if (!value) {
    return [...parties];
  }
  return parties.map((row) => {
    if ((partyId && row.partyId !== partyId) || !row.contacts) {
      return row;
    }
    const contacts = row.contacts.filter(
      (c) =>
        !(
          c.kind === kind &&
          c.value === value &&
          // 没登记账户的旧数据按同一账户处理；不同账户的同值不删。
          (!accountKey || !c.account || c.account === accountKey)
        ),
    );
    if (contacts.length === row.contacts.length) {
      return row;
    }
    const next: MatterParty = { ...row, contacts };
    if (contacts.length === 0) {
      delete next.contacts;
    }
    return next;
  });
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
    const contacts = normalizeMatterPartyContacts(raw.contacts);
    out.push({
      partyId,
      name,
      role,
      ...(standing ? { standing } : {}),
      ...(serviceAddress ? { serviceAddress } : {}),
      ...(serviceMethod ? { serviceMethod } : {}),
      ...(contacts.length > 0 ? { contacts } : {}),
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

const PARTY_ORG_SUFFIXES = [
  "股份有限公司",
  "有限责任公司",
  "有限公司",
  "集团公司",
  "公司",
] as const;

/** 比对用的名字。去掉空白和末尾组织形式，不改律师看见的原名。 */
export function partyNameKey(name: string): string {
  let core = name
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s\u3000]+/g, "");
  for (const suffix of PARTY_ORG_SUFFIXES) {
    if (core.endsWith(suffix) && core.length - suffix.length >= 2) {
      core = core.slice(0, -suffix.length);
      break;
    }
  }
  return core;
}

/** 同一当事人：键相等才算对上。短名包含在长名里不算。 */
export function samePartyName(a: string, b: string): boolean {
  const left = partyNameKey(a);
  const right = partyNameKey(b);
  return left.length >= 2 && left === right;
}

export function matterPartyIdentityNames(input: {
  parties?: MatterParty[];
  clientId?: string;
  counterparty?: string;
}): string[] {
  const names = hydrateMatterParties(input).map((row) => row.name);
  return [...new Set(names)];
}
