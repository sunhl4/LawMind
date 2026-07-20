/**
 * Counterpart mail watch list — empty = track all; otherwise filter by address.
 */

export type MailWatchContact = {
  /** Counterpart email (normalized lowercase). */
  email: string;
  /** Short name shown in UI / digest, e.g. 「对方法务张某」. */
  label: string;
  /** Optional longer note (role / why we track). */
  note?: string;
};

export function normalizeEmailAddress(raw: string): string {
  const t = raw.trim().toLowerCase();
  const angle = t.match(/<([^>]+@[^>]+)>/);
  if (angle?.[1]) {
    return angle[1].trim().toLowerCase();
  }
  return t;
}

export function extractEmailsFromAddressField(field: string): string[] {
  const raw = field.trim();
  if (!raw) {
    return [];
  }
  const found = new Set<string>();
  for (const m of raw.matchAll(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g)) {
    found.add(m[0].toLowerCase());
  }
  if (found.size === 0 && raw.includes("@")) {
    found.add(normalizeEmailAddress(raw));
  }
  return [...found];
}

export function sanitizeWatchContacts(raw: unknown): MailWatchContact[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const out: MailWatchContact[] = [];
  const seen = new Set<string>();
  for (const row of raw) {
    if (!row || typeof row !== "object") {
      continue;
    }
    const o = row as Partial<MailWatchContact>;
    const email = normalizeEmailAddress(String(o.email ?? ""));
    if (!email.includes("@") || seen.has(email)) {
      continue;
    }
    const label =
      String(o.label ?? "")
        .trim()
        .slice(0, 80) || email;
    const note =
      String(o.note ?? "")
        .trim()
        .slice(0, 200) || undefined;
    seen.add(email);
    out.push({ email, label, note });
    if (out.length >= 40) {
      break;
    }
  }
  return out;
}

/** Empty list → keep all. Non-empty → keep if from/to intersects watch list. */
export function messageMatchesWatchContacts(
  message: { from: string; to: string },
  contacts: MailWatchContact[],
): boolean {
  if (contacts.length === 0) {
    return true;
  }
  const watched = new Set(contacts.map((c) => c.email));
  const addrs = [
    ...extractEmailsFromAddressField(message.from),
    ...extractEmailsFromAddressField(message.to),
  ];
  return addrs.some((a) => watched.has(a));
}

export function describeWatchContacts(contacts: MailWatchContact[]): string {
  if (contacts.length === 0) {
    return "未限定对方：同步收件箱内全部往来。";
  }
  const lines = contacts.map((c) => {
    const note = c.note ? `（${c.note}）` : "";
    return `${c.label} <${c.email}>${note}`;
  });
  return `仅关注 ${contacts.length} 个对方：${lines.join("；")}`;
}

export function matchWatchContactLabel(
  addressField: string,
  contacts: MailWatchContact[],
): string | undefined {
  const addrs = extractEmailsFromAddressField(addressField);
  for (const a of addrs) {
    const hit = contacts.find((c) => c.email === a);
    if (hit) {
      return hit.label;
    }
  }
  return undefined;
}
