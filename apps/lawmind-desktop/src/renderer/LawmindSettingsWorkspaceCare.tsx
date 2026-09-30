import { useCallback, useEffect, useState, type ReactNode } from "react";
import { apiSendJson, errorMessage } from "./api-client";
import { loadHealthPayload, type HealthPayload } from "./lawmind-app-data";

type Props = {
  apiBase?: string;
};

/**
 * 查找只在索引没建好或过期时出现。档案对不上时才提供整理。
 * 不展示计数、状态药丸或内部错误码。
 */
export function LawmindSettingsWorkspaceCare({ apiBase }: Props): ReactNode {
  const [health, setHealth] = useState<HealthPayload | null>(null);
  const [rebuildBusy, setRebuildBusy] = useState(false);
  const [rebuildMsg, setRebuildMsg] = useState<string | null>(null);
  const [repairBusy, setRepairBusy] = useState(false);
  const [repairMsg, setRepairMsg] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!apiBase) {
      return;
    }
    try {
      setHealth(await loadHealthPayload(apiBase));
    } catch {
      /* 打不开时不编造状态 */
    }
  }, [apiBase]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const issueCount = health?.doctor?.matterConsistency?.ok === false
    ? (health.doctor.matterConsistency.issueCount ?? 0)
    : 0;
  const searchIndex = health?.doctor?.searchIndex;
  const searchNeedsRebuild = searchIndex?.ready === false || searchIndex?.stale === true;
  const executionLines =
    health?.executionSurface?.lines ?? health?.doctor?.executionSurface?.lines ?? [];

  async function rebuild(): Promise<void> {
    if (!apiBase) {
      return;
    }
    setRebuildBusy(true);
    setRebuildMsg(null);
    try {
      const j = (await apiSendJson(apiBase, "/api/search/workspace/rebuild", "POST", {})) as {
        ok?: boolean;
        error?: string;
        hint?: string;
      };
      if (j.ok) {
        setRebuildMsg("查找已重建。");
        await refresh();
      } else {
        setRebuildMsg(j.hint ?? j.error ?? "没能重建");
      }
    } catch (e) {
      setRebuildMsg(errorMessage(e, "没能重建"));
    } finally {
      setRebuildBusy(false);
    }
  }

  async function repair(): Promise<void> {
    if (!apiBase) {
      return;
    }
    setRepairBusy(true);
    setRepairMsg(null);
    try {
      const j = (await apiSendJson(apiBase, "/api/matters/repair-projections", "POST", {})) as {
        ok?: boolean;
        repaired?: number;
        error?: string;
      };
      if (j.ok) {
        setRepairMsg(`已整理 ${j.repaired ?? 0} 个案件。`);
        await refresh();
      } else {
        setRepairMsg(j.error ?? "没能整理");
      }
    } catch (e) {
      setRepairMsg(errorMessage(e, "没能整理"));
    } finally {
      setRepairBusy(false);
    }
  }

  return (
    <>
      {executionLines.length > 0 ? (
        <div
          className="lm-settings-group lm-settings-surface"
          data-testid="lm-workspace-execution-surface"
        >
          <div className="lm-settings-row">
            <span className="lm-settings-key">本机哪些不能丢</span>
          </div>
          <ul className="lm-callout-body" data-testid="lm-workspace-execution-lines">
            {executionLines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <p className="lm-settings-caption">
            卷宗、会话、草稿和常设工作要备份；索引和后台状态可重建；密钥不在工作区文件夹里。
          </p>
        </div>
      ) : null}
      {searchNeedsRebuild ? (
        <div className="lm-settings-group lm-settings-surface" id="lawmind-settings-search-index" data-testid="lm-workspace-search">
          <div className="lm-settings-row">
            <span className="lm-settings-key">查找</span>
            <button
              type="button"
              className="lm-btn lm-btn-secondary lm-btn-sm"
              data-testid="lm-workspace-rebuild-search"
              disabled={rebuildBusy || !apiBase}
              onClick={() => void rebuild()}
            >
              {rebuildBusy ? "重建中…" : "重建查找"}
            </button>
          </div>
          <p className="lm-settings-caption">查找还没跟上这些材料。重建一次即可。</p>
          {rebuildMsg ? (
            <p className="lm-settings-caption" role="status">
              {rebuildMsg}
            </p>
          ) : null}
        </div>
      ) : null}
      {issueCount > 0 ? (
        <div className="lm-settings-group lm-settings-surface" data-testid="lm-workspace-matter-repair">
          <div className="lm-settings-row">
            <span className="lm-settings-key">案件档案</span>
            <button
              type="button"
              className="lm-btn lm-btn-secondary lm-btn-sm"
              disabled={repairBusy || !apiBase}
              onClick={() => void repair()}
            >
              {repairBusy ? "整理中…" : "重新整理"}
            </button>
          </div>
          <p className="lm-settings-caption">有 {issueCount} 个案件的档案和记录不一致。</p>
          {repairMsg ? (
            <p className="lm-settings-caption" role="status">
              {repairMsg}
            </p>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
