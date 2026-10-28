/**
 * 本案当事人卡片 / 卷宗编辑。角色与送达挂在这一案上，不是律所通讯录。
 */
import { type ReactNode } from "react";
import {
  duplicateContactIdentities,
  formatPartyServiceLine,
  MATTER_PARTIES_CAP,
  MATTER_PARTY_CONTACTS_CAP,
  MATTER_PARTY_CONSENT_STATES,
  MATTER_PARTY_CONTACT_KINDS,
  MATTER_PARTY_ROLE_ZH,
  MATTER_PARTY_ROLES,
  MATTER_PARTY_SERVICE_METHODS,
  MATTER_PARTY_SERVICE_ZH,
  normalizeContactValue,
  normalizeMatterPartyContacts,
  type MatterParty,
  type MatterPartyConsentPurpose,
  type MatterPartyConsentState,
  type MatterPartyContact,
  type MatterPartyContactKind,
  type MatterPartyRole,
  type MatterPartyServiceMethod,
} from "../../../../src/lawmind/desk/matter-parties.ts";

type EditorProps = {
  value: MatterParty[];
  disabled?: boolean;
  onChange: (next: MatterParty[]) => void;
};

const CONTACT_KIND_ZH: Record<MatterPartyContactKind, string> = {
  email: "邮箱",
  phone: "电话",
  wecom: "企业微信",
};

const CONTACT_ACCOUNT_PLACEHOLDER: Record<MatterPartyContactKind, string> = {
  email: "收案邮箱（可留空）",
  phone: "线路（可留空）",
  wecom: "企业 / 应用（可留空）",
};

const CONSENT_STATE_ZH: Record<MatterPartyConsentState, string> = {
  granted: "已同意",
  denied: "已拒绝",
  unknown: "未记录",
};

/**
 * 录音 / 会话存档同意。选「未记录」就清掉这条记录，不用一个假的 unknown 对象充数；
 * 律师在这里改的同意一律记 `source: "lawyer"` 与时间，便于回看是谁给的。
 */
function setContactConsent(
  list: MatterParty[],
  partyId: string,
  index: number,
  purpose: MatterPartyConsentPurpose,
  state: MatterPartyConsentState,
): MatterParty[] {
  const key: "recordingConsent" | "archiveConsent" =
    purpose === "recording" ? "recordingConsent" : "archiveConsent";
  return patchContact(list, partyId, index, {
    [key]:
      state === "unknown"
        ? undefined
        : { state, source: "lawyer" as const, at: new Date().toISOString() },
  });
}

/** 保存时会按存储层规则被丢掉的非空行：先提示，不静默吞掉律师填的值。 */
function describeInvalidContacts(parties: MatterParty[]): string[] {
  const out: string[] = [];
  for (const party of parties) {
    (party.contacts ?? []).forEach((contact, index) => {
      if (!contact.value.trim() || normalizeContactValue(contact.kind, contact.value)) {
        return;
      }
      out.push(`${party.name || party.partyId} 第 ${index + 1} 条`);
    });
  }
  return out;
}

function patchParty(list: MatterParty[], partyId: string, patch: Partial<MatterParty>): MatterParty[] {
  return list.map((row) => (row.partyId === partyId ? { ...row, ...patch } : row));
}

function patchContact(
  list: MatterParty[],
  partyId: string,
  index: number,
  patch: Partial<MatterPartyContact>,
): MatterParty[] {
  // 用 `in` 而不是 !== undefined：把账户或 externalId 清空同样会改变身份键。
  const identityChanged =
    "value" in patch || "account" in patch || "kind" in patch || "externalId" in patch;
  return list.map((row) =>
    row.partyId === partyId
      ? {
          ...row,
          contacts: (row.contacts ?? []).map((contact, i) =>
            i === index
              ? {
                  ...contact,
                  ...patch,
                  // 改了地址就是一条新身份：来源归律师、旧的「已核实」不再算数。
                  ...(identityChanged ? { source: "lawyer" as const, verified: undefined } : {}),
                }
              : contact,
          ),
        }
      : row,
  );
}

function addContact(list: MatterParty[], partyId: string): MatterParty[] {
  return list.map((row) => {
    if (row.partyId !== partyId) {
      return row;
    }
    const contacts = row.contacts ?? [];
    if (contacts.length >= MATTER_PARTY_CONTACTS_CAP) {
      return row;
    }
    return {
      ...row,
      contacts: [
        ...contacts,
        {
          kind: "email" as const,
          value: "",
          source: "lawyer" as const,
          addedAt: new Date().toISOString(),
        },
      ],
    };
  });
}

function removeContact(list: MatterParty[], partyId: string, index: number): MatterParty[] {
  return list.map((row) =>
    row.partyId === partyId
      ? { ...row, contacts: (row.contacts ?? []).filter((_, i) => i !== index) }
      : row,
  );
}

/**
 * 同一身份登记在多个当事人名下时给出可读提示。
 * 空行（还没填值）先被正常化丢掉，不参与比对，避免刚点「添加」就报警。
 */
function describeContactDuplicates(parties: MatterParty[]): string[] {
  const normalized = parties.map((party) => ({
    ...party,
    contacts: normalizeMatterPartyContacts(party.contacts),
  }));
  return duplicateContactIdentities(normalized).map((duplicate) =>
    duplicate.partyIds
      .map((partyId) => normalized.find((party) => party.partyId === partyId)?.name || partyId)
      .join(" / "),
  );
}

function ContactConsentField({
  partyLabel,
  purpose,
  consent,
  disabled,
  onChange,
}: {
  partyLabel: string;
  purpose: MatterPartyConsentPurpose;
  consent: MatterPartyContact["recordingConsent"];
  disabled?: boolean;
  onChange: (state: MatterPartyConsentState) => void;
}): ReactNode {
  const label = purpose === "recording" ? "录音同意" : "会话存档同意";
  return (
    <label className="lm-party-contact-field">
      {label}
      <select
        className="lm-input"
        aria-label={`${partyLabel} ${label}`}
        value={consent?.state ?? "unknown"}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value as MatterPartyConsentState)}
      >
        {MATTER_PARTY_CONSENT_STATES.map((state) => (
          <option key={state} value={state}>
            {CONSENT_STATE_ZH[state]}
          </option>
        ))}
      </select>
    </label>
  );
}

export function LawmindMatterPartyCards({
  parties,
}: {
  parties: MatterParty[];
}): ReactNode {
  if (parties.length === 0) {
    return <p className="lm-meta">还没有当事人。在卷宗里补委托人和对方，冲突扫描用同一名称。</p>;
  }
  return (
    <ul className="lm-party-cards">
      {parties.map((party) => {
        const service = formatPartyServiceLine(party);
        return (
          <li key={party.partyId} className="lm-party-card" data-testid="lm-lawyer-matter-party-card">
            <span className="lm-party-card-role">{MATTER_PARTY_ROLE_ZH[party.role]}</span>
            <strong>{party.name}</strong>
            {party.standing ? <span className="lm-lawyer-today-meta">{party.standing}</span> : null}
            {service ? <span className="lm-lawyer-today-meta">送达 {service}</span> : null}
            {(party.contacts ?? []).map((contact, index) => {
              const consent = [
                contact.recordingConsent && contact.recordingConsent.state !== "unknown"
                  ? `录音：${CONSENT_STATE_ZH[contact.recordingConsent.state]}`
                  : "",
                contact.archiveConsent && contact.archiveConsent.state !== "unknown"
                  ? `存档：${CONSENT_STATE_ZH[contact.archiveConsent.state]}`
                  : "",
              ].filter(Boolean);
              return (
                <span key={`${contact.kind}:${index}`} className="lm-lawyer-today-meta">
                  {CONTACT_KIND_ZH[contact.kind]} {contact.value}
                  {contact.verified ? "（已核实）" : ""}
                  {consent.length > 0 ? `（${consent.join("，")}）` : ""}
                </span>
              );
            })}
          </li>
        );
      })}
    </ul>
  );
}

export function LawmindMatterPartiesEditor({ value, disabled, onChange }: EditorProps): ReactNode {
  const duplicateWarnings = describeContactDuplicates(value);
  const invalidContacts = describeInvalidContacts(value);
  const addParty = (role: MatterPartyRole) => {
    if (value.length >= MATTER_PARTIES_CAP) {
      return;
    }
    const used = new Set(value.map((row) => row.partyId));
    let partyId = `p-${role}`;
    let n = 2;
    while (used.has(partyId)) {
      partyId = `p-${role}-${n}`;
      n += 1;
    }
    onChange([...value, { partyId, name: "", role }]);
  };

  return (
    <div className="lm-party-editor" data-testid="lm-lawyer-matter-parties-editor">
      <p className="lm-meta">名称与伦理墙、冲突扫描共用。送达只写这一案要用的地址，不做通讯录。</p>
      {duplicateWarnings.map((names, index) => (
        <p key={`${names}:${index}`} className="lm-party-editor-warning" role="status">
          同一联系方式登记在多个当事人名下：{names}。同一邮箱、电话或企微只能属于一个当事人，请合并或删掉多余的一条。
        </p>
      ))}
      {invalidContacts.length > 0 ? (
        <p className="lm-party-editor-warning" role="status">
          {invalidContacts.join("、")} 的格式无法识别，保存时会被忽略：邮箱要有 @ 和域名，电话只留数字与 +。
        </p>
      ) : null}
      {value.map((party) => (
        <div key={party.partyId} className="lm-party-editor-row">
          <label>
            角色
            <select
              className="lm-input"
              value={party.role}
              disabled={disabled}
              onChange={(e) =>
                onChange(patchParty(value, party.partyId, { role: e.target.value as MatterPartyRole }))
              }
            >
              {MATTER_PARTY_ROLES.map((role) => (
                <option key={role} value={role}>
                  {MATTER_PARTY_ROLE_ZH[role]}
                </option>
              ))}
            </select>
          </label>
          <label>
            名称
            <input
              className="lm-input"
              value={party.name}
              disabled={disabled}
              onChange={(e) => onChange(patchParty(value, party.partyId, { name: e.target.value }))}
            />
          </label>
          <label>
            诉讼地位
            <input
              className="lm-input"
              value={party.standing ?? ""}
              disabled={disabled}
              placeholder="原告 / 被告"
              onChange={(e) => onChange(patchParty(value, party.partyId, { standing: e.target.value }))}
            />
          </label>
          <label>
            送达方式
            <select
              className="lm-input"
              value={party.serviceMethod ?? ""}
              disabled={disabled}
              onChange={(e) =>
                onChange(
                  patchParty(value, party.partyId, {
                    serviceMethod: (e.target.value || undefined) as MatterPartyServiceMethod | undefined,
                  }),
                )
              }
            >
              <option value="">未标明</option>
              {MATTER_PARTY_SERVICE_METHODS.filter((method) => method !== "unknown").map((method) => (
                <option key={method} value={method}>
                  {MATTER_PARTY_SERVICE_ZH[method]}
                </option>
              ))}
            </select>
          </label>
          <label className="lm-party-editor-address">
            送达地址
            <input
              className="lm-input"
              value={party.serviceAddress ?? ""}
              disabled={disabled}
              placeholder="住所、电子邮箱或送达代收人"
              onChange={(e) =>
                onChange(patchParty(value, party.partyId, { serviceAddress: e.target.value }))
              }
            />
          </label>
          <div className="lm-party-contacts" data-testid="lm-party-contacts">
            <div className="lm-party-contacts-head">
              <span className="lm-party-contacts-title">联系方式</span>
              <button
                type="button"
                className="lm-btn lm-btn-ghost lm-btn-sm"
                disabled={disabled || (party.contacts?.length ?? 0) >= MATTER_PARTY_CONTACTS_CAP}
                onClick={() => onChange(addContact(value, party.partyId))}
              >
                添加联系方式
              </button>
            </div>
            {(party.contacts ?? []).length === 0 ? (
              <p className="lm-meta">
                还没有联系方式。归档时勾选「记住发件人」会自动登记邮箱；也可以在这里补。
              </p>
            ) : (
              (party.contacts ?? []).map((contact, index) => (
                <div className="lm-party-contact-row" key={`${contact.kind}:${index}`}>
                  <select
                    className="lm-input"
                    aria-label={`${party.name || party.partyId} 联系方式类型`}
                    value={contact.kind}
                    disabled={disabled}
                    onChange={(e) =>
                      onChange(
                        patchContact(value, party.partyId, index, {
                          kind: e.target.value as MatterPartyContactKind,
                        }),
                      )
                    }
                  >
                    {MATTER_PARTY_CONTACT_KINDS.map((kind) => (
                      <option key={kind} value={kind}>
                        {CONTACT_KIND_ZH[kind]}
                      </option>
                    ))}
                  </select>
                  <input
                    className="lm-input"
                    aria-label={`${party.name || party.partyId} 联系方式`}
                    value={contact.value}
                    disabled={disabled}
                    placeholder={contact.kind === "email" ? "name@example.com" : "号码或渠道标识"}
                    onChange={(e) =>
                      onChange(patchContact(value, party.partyId, index, { value: e.target.value }))
                    }
                  />
                  <input
                    className="lm-input"
                    aria-label={`${party.name || party.partyId} 联系方式所属账户`}
                    value={contact.account ?? ""}
                    disabled={disabled}
                    placeholder={CONTACT_ACCOUNT_PLACEHOLDER[contact.kind]}
                    onChange={(e) =>
                      onChange(
                        patchContact(value, party.partyId, index, {
                          account: e.target.value || undefined,
                        }),
                      )
                    }
                  />
                  <label className="lm-party-contact-verified">
                    <input
                      type="checkbox"
                      checked={contact.verified === true}
                      disabled={disabled}
                      onChange={(e) =>
                        onChange(
                          patchContact(value, party.partyId, index, {
                            verified: e.target.checked || undefined,
                          }),
                        )
                      }
                    />
                    已核实
                  </label>
                  <button
                    type="button"
                    className="lm-btn lm-btn-ghost lm-btn-sm"
                    disabled={disabled}
                    onClick={() => onChange(removeContact(value, party.partyId, index))}
                  >
                    删除
                  </button>
                  {contact.kind === "phone" || contact.kind === "wecom" ? (
                    <div className="lm-party-contact-meta">
                      {contact.kind === "wecom" ? (
                        <label className="lm-party-contact-field">
                          企微 externalId
                          <input
                            className="lm-input"
                            aria-label={`${party.name || party.partyId} 企微 externalId`}
                            value={contact.externalId ?? ""}
                            disabled={disabled}
                            placeholder="可留空"
                            onChange={(e) =>
                              onChange(
                                patchContact(value, party.partyId, index, {
                                  externalId: e.target.value || undefined,
                                }),
                              )
                            }
                          />
                        </label>
                      ) : null}
                      <ContactConsentField
                        partyLabel={party.name || party.partyId}
                        purpose={contact.kind === "phone" ? "recording" : "archive"}
                        consent={
                          contact.kind === "phone"
                            ? contact.recordingConsent
                            : contact.archiveConsent
                        }
                        disabled={disabled}
                        onChange={(state) =>
                          onChange(
                            setContactConsent(
                              value,
                              party.partyId,
                              index,
                              contact.kind === "phone" ? "recording" : "archive",
                              state,
                            ),
                          )
                        }
                      />
                    </div>
                  ) : null}
                </div>
              ))
            )}
            {(party.contacts?.length ?? 0) >= MATTER_PARTY_CONTACTS_CAP ? (
              <p className="lm-meta">每个当事人最多 {MATTER_PARTY_CONTACTS_CAP} 条联系方式。</p>
            ) : null}
          </div>
          {party.role !== "client" && party.role !== "counterparty" ? (
            <button
              type="button"
              className="lm-btn lm-btn-ghost lm-btn-sm"
              disabled={disabled}
              onClick={() => onChange(value.filter((row) => row.partyId !== party.partyId))}
            >
              移除
            </button>
          ) : null}
        </div>
      ))}
      {value.length >= MATTER_PARTIES_CAP ? (
        <p className="lm-meta">已到 {MATTER_PARTIES_CAP} 人上限。再添加前请先移除一行。</p>
      ) : (
        <div className="lm-lawyer-inline-actions">
          <button type="button" className="lm-btn lm-btn-ghost lm-btn-sm" disabled={disabled} onClick={() => addParty("agent")}>
            添加代收人
          </button>
          <button
            type="button"
            className="lm-btn lm-btn-ghost lm-btn-sm"
            disabled={disabled}
            onClick={() => addParty("counsel")}
          >
            添加对方代理
          </button>
        </div>
      )}
    </div>
  );
}
