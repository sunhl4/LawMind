import { useCallback, useEffect, useState, type ReactNode } from "react";

/**
 * Word 加载项：端口契约与「重新侧载」。
 *
 * ## 为什么需要这一组
 *
 * Word 的侧载清单把回环端口**钉死**在文件里 —— 清单是生成时按请求的实际 `Host` 现场
 * 替换地址的，但律师**存盘并侧载之后**那个端口就固定了。所以端口一旦变化，所有已侧载
 * 的窗格都够不着服务，而窗格自己**无法重新发现**新端口（发现端点
 * `/.well-known/lawmind-local` 也挂在旧 base 上）。
 *
 * 现场表现会误导人：先是窗格报 `unauthorized`（持有派生改造之前的旧凭据），服务换端口
 * 之后变成 `Load failed`（网络错误）。两者都看不出真因是「端口漂移」。
 *
 * 这一组做两件事：
 *   1. 把漂移**明说**，包括是被谁占的（另一个 LawMind 实例 / 其它程序 / 未知）；
 *   2. 提供**唯一**的恢复动作：用当前端口重新生成清单并装回 Word 的侧载目录。
 *
 * 根因治理在别处：`main.mjs` 的单实例锁让第二个实例不再能抢走端口。
 */

type LoopbackPortDrift = {
  requestedPort: number;
  actualPort: number;
  occupant: "another-lawmind" | "foreign" | "unknown";
};

function occupantLabel(drift: LoopbackPortDrift): string {
  switch (drift.occupant) {
    case "another-lawmind":
      return "另一个 LawMind 实例";
    case "foreign":
      return "其它程序";
    default:
      // 端口确实被占，但它不响应本机 API 探测 —— 无法进一步区分是外部程序还是别的
      // 异常状态。如实这么写，不猜（猜错会把排障引向错误方向）。
      return "其它程序（无法进一步区分）";
  }
}

export function WordAddinDoctorGroup(): ReactNode {
  const [drift, setDrift] = useState<LoopbackPortDrift | null>(null);
  const [apiBase, setApiBase] = useState("");
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
        setApiBase(cfg.apiBase ?? "");
        setDrift(cfg.loopbackPortDrift ?? null);
      })
      .catch(() => {
        /* 拿不到配置就不显示漂移；这一组本身仍可用（重新侧载仍可点）。 */
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
        setMsg(res?.error ?? "重新侧载失败。");
        return;
      }
      setMsg(`${res.instructions ?? "清单已更新。"}${res.path ? `（${res.path}）` : ""}`);
      // 清单已指向当前端口 ⇒ 漂移这件事就消解了（端口本身没变，契约恢复了）。
      setDrift(null);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "重新侧载失败。");
    } finally {
      setBusy(false);
    }
  }, []);

  return (
    <div className="lm-settings-group lm-settings-surface" data-testid="lm-doctor-word-addin">
      <h4 className="lm-doctor-group-title">Word 加载项</h4>
      <div className="lm-doctor-security-grid">
        <span className="lm-settings-key">本机 API 地址</span>
        <span className="lm-meta" data-testid="lm-doctor-addin-base">
          {apiBase || "（读取中…）"}
        </span>
        <span className="lm-settings-key">侧载端口</span>
        <span
          className={drift ? "lm-pill lm-pill-warn" : "lm-pill lm-pill-success"}
          data-testid="lm-doctor-addin-port-contract"
          data-drift={drift ? "yes" : "no"}
        >
          {drift ? `已漂移（清单指向 ${drift.requestedPort}）` : "与清单一致"}
        </span>
      </div>

      {drift ? (
        <p className="lm-settings-caption" role="alert">
          本机 API 端口从 <code>{drift.requestedPort}</code> 变到 <code>{drift.actualPort}</code>：
          原端口被{occupantLabel(drift)}占用。已侧载的 Word 窗格仍向{" "}
          <code>{drift.requestedPort}</code> 请求，因此会报「无法加载」或加载失败 ——
          这与模型 Key、与鉴权都无关。点下面的按钮用当前端口重新生成清单即可恢复。
        </p>
      ) : null}

      <p className="lm-settings-caption">
        清单里的地址是生成时按实际端口写死的，侧载之后就固定了；因此端口变化必须重新侧载。
      </p>

      <div className="lm-doctor-actions" style={{ marginTop: 8 }}>
        <button
          type="button"
          className="lm-btn lm-btn-secondary lm-btn-sm"
          disabled={busy}
          data-testid="lm-doctor-addin-resync"
          onClick={() => void resync()}
        >
          {busy ? "正在重新侧载…" : "重新侧载 Word 清单"}
        </button>
      </div>
      {msg ? (
        <p className="lm-settings-caption" role="status" data-testid="lm-doctor-addin-msg">
          {msg}
        </p>
      ) : null}
    </div>
  );
}
