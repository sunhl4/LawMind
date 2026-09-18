/**
 * 本案当事人卡片 / 卷宗编辑。角色与送达挂在这一案上，不是律所通讯录。
 */
import { type ReactNode } from "react";
import {
  formatPartyServiceLine,
  MATTER_PARTIES_CAP,
  MATTER_PARTY_ROLE_ZH,
  MATTER_PARTY_ROLES,
  MATTER_PARTY_SERVICE_METHODS,
  MATTER_PARTY_SERVICE_ZH,
  type MatterParty,
  type MatterPartyRole,
  type MatterPartyServiceMethod,
} from "../../../../src/lawmind/desk/matter-parties.ts";

type EditorProps = {
  value: MatterParty[];
  disabled?: boolean;
  onChange: (next: MatterParty[]) => void;
};

function patchParty(list: MatterParty[], partyId: string, patch: Partial<MatterParty>): MatterParty[] {
  return list.map((row) => (row.partyId === partyId ? { ...row, ...patch } : row));
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
          </li>
        );
      })}
    </ul>
  );
}

export function LawmindMatterPartiesEditor({ value, disabled, onChange }: EditorProps): ReactNode {
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
      {value.length < MATTER_PARTIES_CAP ? (
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
      ) : null}
    </div>
  );
}
