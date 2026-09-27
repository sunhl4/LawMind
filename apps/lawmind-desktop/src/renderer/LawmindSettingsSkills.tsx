import { useCallback, useEffect, useState, type ReactNode } from "react";
import { apiGetJson, errorMessage } from "./api-client";

type SkillRow = {
  id: string;
  name: string;
  version: string;
  description: string;
};

type Props = {
  apiBase: string;
};

/** Read-only catalog. Lawyers do not install or toggle playbooks. */
export function LawmindSettingsSkills(props: Props): ReactNode {
  const { apiBase } = props;
  const [skills, setSkills] = useState<SkillRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!apiBase) {
      return;
    }
    setError(null);
    try {
      const r = await apiGetJson<{ ok?: boolean; skills?: SkillRow[] }>(apiBase, "/api/skills");
      setSkills(r.skills ?? []);
    } catch (e) {
      setError(errorMessage(e, "无法加载作业标准"));
      setSkills([]);
    }
  }, [apiBase]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return (
    <div className="lm-settings-section" data-testid="lm-settings-skills">
      <p className="lm-settings-caption">
        这些作业标准写在软件里，交办时按事项自动带上。不能在这里安装、上传或关闭。
      </p>
      {error ? (
        <p className="lm-settings-caption lm-settings-caption--warn" role="alert">
          {error}
        </p>
      ) : null}
      {skills === null ? <p className="lm-settings-caption">加载中…</p> : null}
      {skills && skills.length === 0 ? <p className="lm-settings-caption">暂无内置作业标准</p> : null}
      {skills && skills.length > 0 ? (
        <ul className="lm-settings-group lm-settings-surface" data-testid="lm-skills-list">
          {skills.map((s) => (
            <li key={s.id} className="lm-settings-row" data-testid={`lm-skill-row-${s.id}`}>
              <div>
                <strong>{s.name}</strong>
                <span className="lm-meta"> · v{s.version}</span>
                {s.description ? <p className="lm-meta">{s.description}</p> : null}
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
