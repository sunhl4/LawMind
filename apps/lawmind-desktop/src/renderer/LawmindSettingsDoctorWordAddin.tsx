import { useCallback, useEffect, useState, type ReactNode } from "react";

/**
 * Word 连接。端口与清单路径只留在主进程日志里；这里只告诉律师连上没有、要不要重开 Word。
 */

type LoopbackPortDrift = {
  requestedPort: number;
  actualPort: number;
  occupant: "another-lawmind" | "foreign" | "unknown";
};

export function WordAddinDoctorGroup(): ReactNode {
  const [drift, setDrift] = useState<LoopbackPortDrift | null>(null);
  const [ready, setReady] = useState(false);
  const [unreadable, setUnreadable] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void window.lawmindDesktop
      ?.getConfig?.()
      .then((cfg) => {
        if (cancelled) {
          return;
        }
        setDrift(cfg.loopbackPortDrift ?? null);
        setReady(true);
      })
      .catch(() => {
        if (!cancelled) {
          setUnreadable(true);
          setReady(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const resync = useCallback(async () => {
    setBusy(true);
    setMsg(null);
    try {
      const res = await window.lawmindDesktop?.syncWordAddinManifest?.();
      if (!res?.ok) {
        setMsg(res?.error ?? "没能重新连接。请稍后再试。");
        return;
      }
      setMsg(res.instructions ?? "已重新连接。请完全退出 Word 后再打开。");
    } catch {
      setMsg("没能重新连接。请稍后再试。");
    } finally {
      setBusy(false);
    }
  }, []);

  const anotherCopy = drift?.occupant === "another-lawmind";
  /** 连得上就不占外观页。只有端口被占、读不到，或刚试过重连，才告诉律师。 */
  if (!ready || (drift === null && !unreadable && !msg)) {
    return null;
  }

  return (
    <div
      className="lm-settings-group lm-settings-surface"
      data-testid="lm-doctor-word-addin"
      aria-busy={busy}
    >
      <div className="lm-settings-row">
        <span className="lm-settings-key lm-settings-key-stack">
          Word
          <span
            className="lm-settings-caption"
            data-testid="lm-doctor-addin-port-contract"
            data-drift={drift ? "yes" : "no"}
            role={drift ? "alert" : undefined}
          >
            {unreadable
              ? "暂时看不清 Word 是否连着。"
              : anotherCopy
                ? "请改用已经打开的 LawMind。不要同时开两份。"
                : "请完全退出 Word 后再打开。"}
          </span>
        </span>
        {anotherCopy ? null : (
          <button
            type="button"
            className="lm-btn lm-btn-secondary lm-btn-sm"
            disabled={busy}
            data-testid="lm-doctor-addin-resync"
            onClick={() => void resync()}
          >
            {busy ? "正在连接…" : "重新连接 Word"}
          </button>
        )}
      </div>
      {msg ? (
        <p className="lm-settings-caption" role="status" data-testid="lm-doctor-addin-msg">
          {msg}
        </p>
      ) : null}
    </div>
  );
}
