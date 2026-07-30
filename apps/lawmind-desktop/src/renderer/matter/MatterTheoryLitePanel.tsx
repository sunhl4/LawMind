import { useEffect, useState, type ReactNode } from "react";
import { apiGetJson, apiSendJson, errorMessage } from "../api-client";
import type { MatterTheoryLite } from "../../../../../src/lawmind/matter-ops/types.ts";

type Props = {
  apiBase: string;
  matterId: string;
};

/**
 * Skills E3 — Matter theory surface (epic-theory-after: issues / authorities / open Qs).
 */
export function MatterTheoryLitePanel(props: Props): ReactNode {
  const { apiBase, matterId } = props;
  const [issues, setIssues] = useState("");
  const [authorities, setAuthorities] = useState("");
  const [openQuestions, setOpenQuestions] = useState("");
  const [anchored, setAnchored] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const reload = async () => {
    setLoadError(null);
    try {
      const j = await apiGetJson<{ ok?: boolean; theory?: MatterTheoryLite | null }>(
        apiBase,
        `/api/matters/${encodeURIComponent(matterId)}/theory`,
      );
      if (!j.theory) {
        return;
      }
      setIssues(j.theory.issues);
      setAuthorities(j.theory.authorities);
      setOpenQuestions(j.theory.openQuestions);
      setAnchored(j.theory.anchored);
    } catch (e) {
      setLoadError(errorMessage(e, "加载案件理论失败"));
    }
  };

  useEffect(() => {
    void reload();
  }, [apiBase, matterId]);

  const save = async () => {
    setBusy(true);
    setMsg(null);
    try {
      await apiSendJson(apiBase, `/api/matters/${encodeURIComponent(matterId)}/theory`, "PUT", {
        issues,
        authorities,
        openQuestions,
        anchored,
      });
      setMsg("理论已保存");
    } catch (e) {
      setMsg(errorMessage(e, "保存理论失败"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="lm-matter-theory-lite" data-testid="lm-matter-theory-lite" aria-label="案件理论">
      <header className="lm-matter-theory-lite-head">
        <div>
          <span className="lm-assignment-kicker">案件理论</span>
          <strong>争点 · 依据 · 开放问题</strong>
        </div>
        <p className="lm-meta">结构化推理板，不是对话。严格援引导出前请勾选已锚定。</p>
      </header>

      {loadError ? (
        <p className="lm-error" role="alert">
          {loadError}{" "}
          <button type="button" className="lm-btn lm-btn-ghost lm-btn-sm" onClick={() => void reload()}>
            重试
          </button>
        </p>
      ) : null}

      <div className="lm-matter-theory-panes">
        <label className="lm-matter-theory-pane lm-job-intake-field">
          <span>争点树</span>
          <textarea
            className="lm-input"
            rows={5}
            value={issues}
            onChange={(e) => setIssues(e.target.value)}
            placeholder="法律构成要件 / 争议焦点…"
          />
        </label>
        <label className="lm-matter-theory-pane lm-job-intake-field">
          <span>依据矩阵</span>
          <textarea
            className="lm-input"
            rows={5}
            value={authorities}
            onChange={(e) => setAuthorities(e.target.value)}
            placeholder="法条、先例、证据锚点…"
          />
        </label>
        <label className="lm-matter-theory-pane lm-job-intake-field">
          <span>开放问题</span>
          <textarea
            className="lm-input"
            rows={5}
            value={openQuestions}
            onChange={(e) => setOpenQuestions(e.target.value)}
            placeholder="待核实事实 / 待补证据…"
          />
        </label>
      </div>

      <div className="lm-matter-theory-actions">
        <label className="lm-settings-row lm-settings-row-check">
          <span>已锚定（可用于严格援引导出）</span>
          <input
            type="checkbox"
            checked={anchored}
            data-testid="lm-theory-anchored"
            onChange={(e) => setAnchored(e.target.checked)}
          />
        </label>
        <button
          type="button"
          className="lm-btn lm-btn-sm"
          disabled={busy}
          data-testid="lm-theory-save"
          onClick={() => void save()}
        >
          保存理论
        </button>
      </div>
      {msg ? (
        <p className="lm-meta" role="status">
          {msg}
        </p>
      ) : null}
    </section>
  );
}
