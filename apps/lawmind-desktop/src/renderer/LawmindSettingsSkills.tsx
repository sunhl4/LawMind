import { useCallback, useEffect, useState, type ReactNode } from "react";
import { apiGetJson, apiSendJson, errorMessage } from "./api-client";

type SkillRow = {
  id: string;
  name: string;
  version: string;
  description: string;
  enabled: boolean;
  signatureOk: boolean;
  signatureError?: string;
};

type CnPack = {
  id?: string;
  label?: string;
  workflowIds?: string[];
  notes?: string;
  description?: string;
};

type Props = {
  apiBase: string;
};

export function LawmindSettingsSkills(props: Props): ReactNode {
  const { apiBase } = props;
  const [skills, setSkills] = useState<SkillRow[] | null>(null);
  const [cnPack, setCnPack] = useState<CnPack | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!apiBase) {
      return;
    }
    setError(null);
    try {
      const r = await apiGetJson<{
        ok?: boolean;
        skills?: SkillRow[];
        cnPack?: CnPack | null;
      }>(apiBase, "/api/skills");
      setSkills(r.skills ?? []);
      setCnPack(r.cnPack ?? null);
    } catch (e) {
      setError(errorMessage(e, "无法加载技能库"));
      setSkills([]);
    }
  }, [apiBase]);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function toggle(skill: SkillRow, enabled: boolean): Promise<void> {
    if (!skill.signatureOk && enabled) {
      setError(`技能 ${skill.id} 签名无效，无法启用（${skill.signatureError ?? "signature"}）`);
      return;
    }
    setBusyId(skill.id);
    setError(null);
    try {
      const r = await apiSendJson<{ ok?: boolean; skills?: SkillRow[] }, { skillId: string; enabled: boolean }>(
        apiBase,
        "/api/skills/enabled",
        "POST",
        { skillId: skill.id, enabled },
      );
      setSkills(r.skills ?? []);
    } catch (e) {
      setError(errorMessage(e, "更新技能启用状态失败"));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="lm-settings-section" data-testid="lm-settings-skills">
      <div className="lm-settings-section-title lm-settings-section-title--duplicate">技能库</div>
      {cnPack ? (
        <div className="lm-settings-group lm-settings-surface" data-testid="lm-cn-legal-pack">
          <div className="lm-settings-row">
            <span className="lm-settings-key">中国法律包</span>
            <span className="lm-pill lm-pill-success">{cnPack.label ?? cnPack.id ?? "已发现"}</span>
          </div>
          {(cnPack.notes || cnPack.description || cnPack.workflowIds?.length) ? (
            <p className="lm-settings-caption">
              {cnPack.notes ?? cnPack.description ?? ""}
              {cnPack.workflowIds?.length ? ` · ${cnPack.workflowIds.join("、")}` : ""}
            </p>
          ) : null}
        </div>
      ) : (
        <p className="lm-settings-caption">未发现中国法律包</p>
      )}
      {error ? (
        <p className="lm-settings-caption lm-settings-caption--warn" role="alert">
          {error}
        </p>
      ) : null}
      {skills === null ? <p className="lm-settings-caption">加载中…</p> : null}
      {skills && skills.length === 0 ? <p className="lm-settings-caption">暂无本地技能</p> : null}
      {skills && skills.length > 0 ? (
        <ul className="lm-settings-group lm-settings-surface" data-testid="lm-skills-list">
          {skills.map((s) => (
            <li key={s.id} className="lm-settings-row" data-testid={`lm-skill-row-${s.id}`}>
              <div>
                <strong>{s.name}</strong>
                <span className="lm-meta">
                  {" "}
                  · v{s.version}
                  {s.signatureOk ? " · 签名通过" : ` · 签名失败${s.signatureError ? ` (${s.signatureError})` : ""}`}
                </span>
                {s.description ? <p className="lm-meta">{s.description}</p> : null}
              </div>
              <button
                type="button"
                className={`lm-btn lm-btn-sm ${s.enabled ? "lm-btn-accent" : "lm-btn-secondary"}`}
                disabled={busyId === s.id || (!s.signatureOk && !s.enabled)}
                data-testid={`lm-skill-toggle-${s.id}`}
                onClick={() => void toggle(s, !s.enabled)}
              >
                {busyId === s.id ? "…" : s.enabled ? "已启用" : s.signatureOk ? "未启用" : "拒载"}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <button type="button" className="lm-btn lm-btn-ghost lm-btn-sm" onClick={() => void reload()}>
        刷新
      </button>
    </div>
  );
}
