/**
 * 后台办件（lawmindd）掉线 / 卡住时主动 OS 通知，并在冷启动时打开设置→工作区置顶回执。
 * 只认「放弃重试」与「心跳过期」，自动恢复不打扰（对齐 shouldNotifyDaemonIncident）。
 */
import { useEffect, useRef } from "react";
import { shouldNotifyDaemonIncident } from "../../../../src/lawmind/platform/lawmind-daemon-supervision.ts";
import { apiGetJson } from "./api-client";
import type { LawmindDaemonPayload } from "./lawmind-app-data";
import { useSettingsPanelStore } from "./stores/settings-panel-store";

const STORAGE_PREFIX = "lawmind-daemon-incident-sig:";
const POLL_MS = 30_000;

function readSig(key: string): string | null {
  try {
    return sessionStorage.getItem(STORAGE_PREFIX + key);
  } catch {
    return null;
  }
}

function writeSig(key: string, sig: string): void {
  try {
    sessionStorage.setItem(STORAGE_PREFIX + key, sig);
  } catch {
    /* ignore quota / private mode */
  }
}

function incidentSignature(daemon: LawmindDaemonPayload): string | null {
  if (daemon.supervisionGaveUp) {
    return `gave-up:${daemon.recap?.headline ?? "stop"}`;
  }
  if (daemon.heartbeatStale) {
    return `stale:${daemon.heartbeatAt ?? daemon.lastTickAt ?? "1"}`;
  }
  return null;
}

export function useDaemonIncidentNotify(args: {
  apiBase: string;
  enabled: boolean;
}): void {
  const { apiBase, enabled } = args;
  const openedRecapRef = useRef(false);

  useEffect(() => {
    if (!enabled || !apiBase.trim()) {
      return undefined;
    }
    const desk = window.lawmindDesktop;
    if (!desk?.showNotification) {
      return undefined;
    }

    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | undefined;

    const tick = async () => {
      try {
        const payload = await apiGetJson<{ daemon?: LawmindDaemonPayload }>(apiBase, "/api/daemon");
        if (cancelled) {
          return;
        }
        const daemon = payload.daemon;
        if (!daemon || !shouldNotifyDaemonIncident(daemon)) {
          return;
        }
        const sig = incidentSignature(daemon);
        if (!sig) {
          return;
        }

        // 冷启动：第一次看见事故就打开设置→工作区，让回执置顶可见。
        if (!openedRecapRef.current && !readSig("startup-opened")) {
          openedRecapRef.current = true;
          writeSig("startup-opened", sig);
          useSettingsPanelStore.getState().setSettingsPanel(true, "workspace");
        }

        if (readSig("notify") === sig) {
          return;
        }
        const title = daemon.recap?.headline?.trim() || "后台办件出状况了";
        const body =
          daemon.recap?.details?.filter(Boolean).join(" ") ||
          (daemon.supervisionGaveUp
            ? "关桌面后继续办件已停止重试，请到设置→工作区查看。"
            : "关桌面后继续办件超过一分钟没有动静，请到设置→工作区查看。");
        const res = await desk.showNotification({
          title,
          body,
          openSettingsOnClick: true,
          settingsSection: "workspace",
        });
        if (res?.ok) {
          writeSig("notify", sig);
        }
      } catch {
        /* 轮询失败不打扰 */
      }
    };

    void tick();
    timer = setInterval(() => {
      void tick();
    }, POLL_MS);

    return () => {
      cancelled = true;
      if (timer) {
        clearInterval(timer);
      }
    };
  }, [apiBase, enabled]);
}
