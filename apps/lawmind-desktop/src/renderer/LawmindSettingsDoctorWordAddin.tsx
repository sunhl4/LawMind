import { useCallback, useEffect, useState, type ReactNode } from "react";

/**
 * Word 与 WPS 的连接。端口和清单路径只留在主进程日志里。
 * 这一行常驻：清单停在旧地址时，律师也找得到「重新连接」。
 */

type HostStatus = "connected" | "reopen" | "missing" | "another-copy";

type AddinHosts = {
  word: HostStatus;
  wps: HostStatus;
};

function hostCaption(product: "Word" | "WPS", status: HostStatus | undefined): string {
  if (status === "another-copy") {
    return "请改用已经打开的 LawMind。不要同时开两份。";
  }
  if (status === "missing") {
    return product === "Word" ? "这台电脑没有安装 Word。" : "这台电脑没有安装 WPS。";
  }
  if (status === "reopen") {
    return product === "Word" ? "请完全退出 Word 后再打开。" : "请完全退出 WPS 后再打开。";
  }
  if (status === "connected") {
    return product === "Word" ? "Word 已连接。" : "WPS 已连接。";
  }
  return "暂时看不清是否连着。";
}

export function WordAddinDoctorGroup(): ReactNode {
  const [hosts, setHosts] = useState<AddinHosts | null>(null);
  const [ready, setReady] = useState(false);
  const [unreadable, setUnreadable] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const getConfig = window.lawmindDesktop?.getConfig;
    if (!getConfig) {
      setHosts(null);
      setReady(true);
      return undefined;
    }
    void getConfig()
      .then((cfg) => {
        if (cancelled) {
          return;
        }
        setHosts(cfg.addinHosts ?? null);
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
      setMsg(res.instructions ?? "已重新连接。请完全退出 Word 和 WPS 后再打开。");
      const wordSideloaded = res.location === "word-container" || res.location === "word-windows";
      if (wordSideloaded || res.wpsStatus === "written" || res.wpsStatus === "unchanged") {
        setHosts((prev) => ({
          word: wordSideloaded ? "reopen" : (prev?.word ?? "missing"),
          wps:
            res.wpsStatus === "written" || res.wpsStatus === "unchanged"
              ? "reopen"
              : (prev?.wps ?? "missing"),
        }));
      }
    } catch {
      setMsg("没能重新连接。请稍后再试。");
    } finally {
      setBusy(false);
    }
  }, []);

  if (!ready || (!unreadable && !hosts)) {
    return null;
  }

  const anotherCopy = hosts?.word === "another-copy" || hosts?.wps === "another-copy";

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
            data-drift={hosts?.word === "reopen" ? "yes" : "no"}
            role={hosts?.word === "reopen" || hosts?.word === "another-copy" ? "alert" : undefined}
          >
            {unreadable ? "暂时看不清 Word 是否连着。" : hostCaption("Word", hosts?.word)}
          </span>
        </span>
      </div>
      <div className="lm-settings-row">
        <span className="lm-settings-key lm-settings-key-stack">
          WPS
          <span
            className="lm-settings-caption"
            data-testid="lm-doctor-addin-wps"
            role={hosts?.wps === "reopen" || hosts?.wps === "another-copy" ? "alert" : undefined}
          >
            {unreadable ? "暂时看不清 WPS 是否连着。" : hostCaption("WPS", hosts?.wps)}
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
            {busy ? "正在连接…" : "重新连接"}
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
