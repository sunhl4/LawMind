import { useEffect, useState, type ReactNode } from "react";
import { apiGetJson } from "./api-client";

type DaemonRecap = {
  headline: string;
  details: string[];
};

type DaemonPayload = {
  supervisionGaveUp?: boolean;
  heartbeatStale?: boolean;
  recap?: DaemonRecap | null;
};

/**
 * 「你走后发生了什么」。文案以 `/api/daemon` 的 recap 为准，这里不重算。
 * 没出过事时服务端返回空，这一条就不占屏幕。
 */
export function LawmindDaemonRecap(props: { apiBase?: string; onOpen?: () => void }): ReactNode {
  const { apiBase } = props;
  const [daemon, setDaemon] = useState<DaemonPayload | null>(null);

  useEffect(() => {
    if (!apiBase?.trim()) {
      setDaemon(null);
      return undefined;
    }
    let cancelled = false;
    void apiGetJson<{ daemon?: DaemonPayload }>(apiBase, "/api/daemon")
      .then((payload) => {
        if (!cancelled) {
          setDaemon(payload.daemon ?? null);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setDaemon(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [apiBase]);

  const { onOpen } = props;
  const recap = daemon?.recap;
  if (!recap?.headline) {
    return null;
  }
  const tone = daemon?.supervisionGaveUp
    ? "lm-callout-danger"
    : daemon?.heartbeatStale
      ? "lm-callout-warn"
      : "lm-callout-muted";
  const body = (
    <>
      <p className="lm-callout-title">{recap.headline}</p>
      {recap.details.length > 0 ? (
        <ul className="lm-callout-body">
          {recap.details.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      ) : null}
    </>
  );
  if (onOpen) {
    return (
      <button
        type="button"
        className={`lm-callout ${tone} lm-desk-recap-btn`}
        data-testid="lm-fleet-daemon-recap"
        onClick={onOpen}
      >
        {body}
      </button>
    );
  }
  return (
    <div className={`lm-callout ${tone}`} role="status" data-testid="lm-fleet-daemon-recap">
      {body}
    </div>
  );
}
