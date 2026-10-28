/**
 * @vitest-environment jsdom
 */
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

const recordingItem = {
  schemaVersion: 1,
  id: "it-rec0001",
  channel: "recording",
  externalKey: "recording:e2e",
  trust: "untrusted",
  receivedAt: "2026-10-27T01:00:00.000Z",
  recordedAt: "2026-10-27T01:00:05.000Z",
  subject: "通话录音.mp3",
  text: "",
  attachments: [{ name: "通话录音.mp3", size: 2048 }],
  status: "pending",
  resolution: { decision: "unmatched", candidates: [], resolvedAt: "2026-10-27T01:00:06.000Z" },
};

const apiGetJson = vi.fn(async (_base: string, path: string) => {
  if (path.startsWith("/api/intake/items?") || path === "/api/intake/items") {
    return { ok: true, items: [recordingItem] };
  }
  if (path.endsWith("/overviews")) {
    return { ok: true, overviews: [] };
  }
  if (path === "/api/intake/items/it-rec0001") {
    return { ok: true, item: recordingItem };
  }
  return { ok: false };
});

const apiSendJson = vi.fn(async (_base: string, path: string) => {
  if (path.includes("/transcribe")) {
    return { ok: true, chars: 16, via: "127.0.0.1" };
  }
  return { ok: true };
});

vi.mock("./api-client", () => ({
  apiGetJson: (...args: unknown[]) => apiGetJson(...(args as [string, string])),
  apiSendJson: (...args: unknown[]) => apiSendJson(...(args as [string, string])),
  errorMessage: (_error: unknown, fallback: string) => fallback,
}));

import { LawmindIntakeInbox } from "./LawmindIntakeInbox";

describe("LawmindIntakeInbox recording transcription", () => {
  let host: HTMLDivElement;
  let root: Root;

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    apiGetJson.mockClear();
    apiSendJson.mockClear();
    recordingItem.text = "";
  });

  async function flush() {
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  function button(label: string): HTMLButtonElement {
    const found = [...host.querySelectorAll("button")].find((node) =>
      node.textContent?.includes(label),
    );
    if (!found) {
      throw new Error(`button not found: ${label}`);
    }
    return found;
  }

  it("shows the transcribe block for recordings and writes the transcript back", async () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root.render(
        <LawmindIntakeInbox apiBase="http://127.0.0.1:9" matterChoices={[]} pollMs={0} />,
      );
    });
    await flush();

    expect(host.textContent).toContain("录音转写");
    expect(host.querySelector('[data-testid="lm-fleet-intake-recording-hint"]')).toBeTruthy();

    await act(async () => {
      button("转写录音").click();
    });
    await flush();

    expect(apiSendJson).toHaveBeenCalledWith(
      "http://127.0.0.1:9",
      "/api/intake/items/it-rec0001/transcribe",
      "POST",
      {},
    );
    expect(
      host.querySelector('[data-testid="lm-fleet-intake-transcribe-note"]')?.textContent,
    ).toContain("已转写 16 字");
  });

  it("asks the server to overwrite when the recording already has a transcript", async () => {
    recordingItem.text = "旧文字";
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root.render(
        <LawmindIntakeInbox apiBase="http://127.0.0.1:9" matterChoices={[]} pollMs={0} />,
      );
    });
    await flush();

    await act(async () => {
      button("重新转写").click();
    });
    await flush();

    expect(apiSendJson).toHaveBeenCalledWith(
      "http://127.0.0.1:9",
      "/api/intake/items/it-rec0001/transcribe?force=1",
      "POST",
      {},
    );
  });

  it("explains the no_config reason without failing", async () => {
    apiSendJson.mockImplementationOnce(async () => ({ ok: false, reason: "no_config" }));
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root.render(
        <LawmindIntakeInbox apiBase="http://127.0.0.1:9" matterChoices={[]} pollMs={0} />,
      );
    });
    await flush();

    await act(async () => {
      button("转写录音").click();
    });
    await flush();

    expect(
      host.querySelector('[data-testid="lm-fleet-intake-transcribe-note"]')?.textContent,
    ).toContain("LAWMIND_ASR_ENDPOINT");
  });
});
