/**
 * 判案 v1：来件 → 候选案件。
 *
 * 能否自动归档是确定性规则：恰好一个案件命中强键（线程 / 案号 / 案件编号 / 唯一已核验联系人），
 * 且没有第二个案件也命中强键。打分只用来给律师排候选，分再高也不放行自动归档。
 * 打分沿用 Fellegi–Sunter 记录链接的做法：每条线索记 log2(m/u)，按案件累加。
 */

import { normalizeContactAccount, partyNameKey } from "../desk/matter-parties.js";
import { intakeLookupRefs } from "./store.js";
import {
  STRONG_INTAKE_KEY_KINDS,
  type IntakeCandidate,
  type IntakeItem,
  type IntakeKey,
  type IntakeKeyKind,
  type IntakeResolution,
} from "./types.js";

export type IntakeMatterProfile = {
  matterId: string;
  title: string;
  /** 已归一化（见 normalizeCaseNoForMatch），长度不足 6 的已剔除。 */
  caseNos: string[];
  parties: Array<{ partyId: string; name: string }>;
  contacts: Array<{
    partyId: string;
    kind: "email" | "phone" | "wecom";
    value: string;
    verified: boolean;
    /** 登记这条联系方式时所属的渠道账户；缺省表示历史数据未区分账户。 */
    account?: string;
    /** 渠道侧 id（企微 external userid 等）。 */
    externalId?: string;
  }>;
};

export type IntakeMatterIndex = {
  /** 只含未结案的案件。 */
  matters: IntakeMatterProfile[];
  /** 规范化 Message-ID / 会话键 → 案件。 */
  threadRefs: Record<string, string>;
};

/**
 * m 是「来件确属该案时出现这条线索」的概率，u 是「不属于该案也出现」的概率。
 * 这里只取数量级：线程与案号几乎不会误中，当事人名字经常被顺带提到。
 */
export const INTAKE_KEY_WEIGHTS: Record<IntakeKeyKind, number> = {
  thread: 16,
  case_no: 14,
  matter_ref: 12,
  verified_contact: 10,
  contact: 4,
  party_name: 3,
};

const MAX_CANDIDATES = 8;
const MIN_CASE_NO_LENGTH = 6;

/** 案号比对形式：全角转半角，去空白，各式括号统一成 ()。 */
export function normalizeCaseNoForMatch(raw: string): string {
  return raw
    .normalize("NFKC")
    .replace(/[\s\u3000]+/g, "")
    .replace(/[〔［[【]/g, "(")
    .replace(/[〕］\]】]/g, ")");
}

/** 一个案件可能登记了一审、二审多个案号。 */
export function splitDocketCaseNos(raw: string | undefined): string[] {
  if (!raw) {
    return [];
  }
  return raw
    .split(/[、;；,，/\n]+/)
    .map(normalizeCaseNoForMatch)
    .filter((no) => no.length >= MIN_CASE_NO_LENGTH);
}

/** 标题里用【】或 [] 括起来的片段，律师约定写案件编号。 */
export function extractBracketRefs(subject: string): string[] {
  const out: string[] = [];
  for (const match of subject
    .normalize("NFKC")
    .matchAll(/[【[〔]\s*([^【】[\]〔〕]{2,128}?)\s*[】\]〕]/g)) {
    const token = match[1]?.trim();
    if (token) {
      out.push(token);
    }
  }
  return out;
}

function nameHaystack(raw: string): string {
  return raw
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s\u3000]+/g, "");
}

export function resolveIntakeItem(
  item: IntakeItem,
  index: IntakeMatterIndex,
  opts?: { hintMatterId?: string; now?: Date },
): IntakeResolution {
  const byId = new Map(index.matters.map((m) => [m.matterId, m]));
  const keysByMatter = new Map<string, IntakeKey[]>();
  const add = (key: IntakeKey) => {
    if (!byId.has(key.matterId)) {
      return;
    }
    const list = keysByMatter.get(key.matterId) ?? [];
    if (!list.some((k) => k.kind === key.kind)) {
      list.push({ ...key, detail: key.detail.slice(0, 200) });
    }
    keysByMatter.set(key.matterId, list);
  };

  for (const ref of intakeLookupRefs(item)) {
    const matterId = index.threadRefs[ref];
    if (matterId) {
      add({ kind: "thread", matterId, detail: "回复了本案已归档的往来邮件" });
    }
  }

  if (opts?.hintMatterId) {
    add({
      kind: "matter_ref",
      matterId: opts.hintMatterId,
      detail: `投递在案件文件夹「${opts.hintMatterId}」里`,
    });
  }
  for (const token of extractBracketRefs(item.subject ?? "")) {
    add({ kind: "matter_ref", matterId: token, detail: `标题标注了案件编号【${token}】` });
  }

  const caseHay = normalizeCaseNoForMatch(
    [item.subject ?? "", item.text, ...item.attachments.map((a) => a.name)].join("\n"),
  );
  for (const matter of index.matters) {
    const hit = matter.caseNos.find((no) => caseHay.includes(no));
    if (hit) {
      add({ kind: "case_no", matterId: matter.matterId, detail: `提到本案案号 ${hit}` });
    }
  }

  const address = item.from?.address?.toLowerCase();
  const itemAccount = normalizeContactAccount(item.source?.accountId);
  if (address) {
    const hits = index.matters.flatMap((m) =>
      m.contacts
        .filter(
          (c) =>
            c.kind === "email" &&
            c.value === address &&
            // 两侧都有账户且不同：同一个邮箱挂在不同收案账户下，不当作同一条身份。
            (!c.account || !itemAccount || c.account === itemAccount),
        )
        .map((c) => ({ matterId: m.matterId, verified: c.verified })),
    );
    const verifiedMatters = new Set(hits.filter((h) => h.verified).map((h) => h.matterId));
    for (const hit of hits) {
      const strong = hit.verified && verifiedMatters.size === 1 && item.dmarc !== "fail";
      const why = !hit.verified
        ? "未核验"
        : item.dmarc === "fail"
          ? "但发件域认证未通过"
          : "但同时登记在多个在办案件";
      add({
        kind: strong ? "verified_contact" : "contact",
        matterId: hit.matterId,
        detail: strong
          ? `发件人 ${address} 是本案已核验联系人`
          : `发件人 ${address} 登记在本案（${why}）`,
      });
    }
  }

  const nameHay = nameHaystack(`${item.subject ?? ""}\n${item.text}`);
  for (const matter of index.matters) {
    const hit = matter.parties.find((p) => {
      const key = partyNameKey(p.name);
      return key.length >= 2 && nameHay.includes(key);
    });
    if (hit) {
      add({ kind: "party_name", matterId: matter.matterId, detail: `提到当事人「${hit.name}」` });
    }
  }

  const candidates: IntakeCandidate[] = [...keysByMatter.entries()]
    .map(([matterId, keys]) => ({
      matterId,
      title: byId.get(matterId)?.title.slice(0, 200),
      score: keys.reduce((sum, k) => sum + INTAKE_KEY_WEIGHTS[k.kind], 0),
      strong: keys.some((k) => STRONG_INTAKE_KEY_KINDS.has(k.kind)),
      keys: keys.slice(0, 12),
    }))
    .toSorted(
      (a, b) =>
        Number(b.strong) - Number(a.strong) ||
        b.score - a.score ||
        a.matterId.localeCompare(b.matterId),
    )
    .slice(0, MAX_CANDIDATES);
  const strongCount = candidates.filter((c) => c.strong).length;
  // 线程头和发件人一样能伪造：发件域认证失败的来件一律交律师拍板。
  const autoAllowed = strongCount === 1 && item.dmarc !== "fail";
  return {
    decision: autoAllowed ? "auto_attach" : candidates.length > 0 ? "propose" : "unmatched",
    candidates,
    resolvedAt: (opts?.now ?? new Date()).toISOString(),
  };
}
