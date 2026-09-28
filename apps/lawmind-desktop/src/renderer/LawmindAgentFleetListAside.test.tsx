/**
 * @vitest-environment jsdom
 */
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LawmindAgentFleetListAside } from "./LawmindAgentFleetListAside";
import type { AgentRunSummary } from "./lawmind-agent-fleet-api";

function mockStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key) => map.get(key) ?? null,
    key: (index) => [...map.keys()][index] ?? null,
    removeItem: (key) => {
      map.delete(key);
    },
    setItem: (key, value) => {
      map.set(key, value);
    },
  };
}

function run(partial: Partial<AgentRunSummary> & { id: string }): AgentRunSummary {
  return {
    kind: "chat",
    status: "running",
    title: partial.id,
    updatedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    priority: 2,
    ...partial,
  } as AgentRunSummary;
}

describe("LawmindAgentFleetListAside", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("localStorage", mockStorage());
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  });

  it("shows the three bands and selects a row", () => {
    const onSelect = vi.fn();
    act(() => {
      root.render(
        <LawmindAgentFleetListAside
          docket={{
            needsYou: [
              run({
                id: "send",
                kind: "automation_send",
                status: "awaiting_approval",
                title: "给客户的信",
                matterId: "m1",
              }),
            ],
            inFlight: [
              run({
                id: "live",
                status: "running",
                title: "检索判例",
                matterId: "m1",
                progress: { total: 4, completed: 1 },
              }),
            ],
            settled: [run({ id: "done", status: "completed", title: "备忘录", matterId: "m1" })],
          }}
          hiddenInFlight={0}
          hiddenSettled={0}
          matterChoices={["m1"]}
          matterLabelById={{ m1: "张三案" }}
          matterFilter="all"
          onMatterFilter={() => undefined}
          onlyNeedsYou={false}
          onOnlyNeedsYou={() => undefined}
          selectedId="send"
          onSelectRun={onSelect}
          inFlightOpen
          settledOpen={false}
          onToggleBand={() => undefined}
          pendingTeachCount={0}
        />,
      );
    });

    expect(host.textContent).toContain("停在你这里");
    expect(host.textContent).toContain("正在办");
    expect(host.textContent).toContain("今天办完");
    expect(host.textContent).toContain("给客户的信");
    expect(host.textContent).toContain("张三案");
    expect(host.textContent).toContain("1/4 步");
    expect(host.textContent).not.toContain("备忘录");

    const row = host.querySelector("[data-fleet-run-id='live']");
    expect(row).toBeTruthy();
    act(() => {
      row?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onSelect).toHaveBeenCalledWith("live");
  });

  it("reports shift and ctrl clicks without opening the row", () => {
    const onSelect = vi.fn();
    const onPointerSelect = vi.fn();
    act(() => {
      root.render(
        <LawmindAgentFleetListAside
          docket={{
            needsYou: [
              run({ id: "a", kind: "automation_send", status: "awaiting_approval", title: "甲" }),
              run({ id: "b", kind: "automation_send", status: "awaiting_approval", title: "乙" }),
            ],
            inFlight: [],
            settled: [],
          }}
          hiddenInFlight={0}
          hiddenSettled={0}
          matterChoices={[]}
          matterFilter="all"
          onMatterFilter={() => undefined}
          onlyNeedsYou
          onOnlyNeedsYou={() => undefined}
          selectedId="a"
          pickedIds={new Set(["a", "b"])}
          onSelectRun={onSelect}
          onPointerSelect={onPointerSelect}
          inFlightOpen={false}
          settledOpen={false}
          onToggleBand={() => undefined}
          pendingTeachCount={0}
          batch={{
            count: 2,
            canSend: true,
            busy: false,
            onReject: () => undefined,
            onApprove: () => undefined,
            onSnooze: () => undefined,
          }}
        />,
      );
    });
    expect(host.textContent).toContain("已选 2");
    const row = host.querySelector("[data-fleet-run-id='b']");
    act(() => {
      row?.dispatchEvent(new MouseEvent("click", { bubbles: true, shiftKey: true }));
    });
    expect(onSelect).not.toHaveBeenCalled();
    expect(onPointerSelect).toHaveBeenCalledWith(expect.objectContaining({ shiftKey: true }), "b");
    act(() => {
      row?.dispatchEvent(
        new MouseEvent("click", { bubbles: true, ctrlKey: true, metaKey: false, shiftKey: false }),
      );
    });
    expect(onPointerSelect).toHaveBeenLastCalledWith(
      expect.objectContaining({ ctrlKey: true, shiftKey: false }),
      "b",
    );
    expect(host.querySelector("[data-fleet-run-id='b']")?.getAttribute("aria-selected")).toBe(
      "true",
    );
    expect(host.querySelector("[data-fleet-run-id='a']")?.getAttribute("aria-current")).toBe(
      "true",
    );
  });

  it("says when nothing needs the lawyer but other work is still open", () => {
    act(() => {
      root.render(
        <LawmindAgentFleetListAside
          docket={{ needsYou: [], inFlight: [], settled: [] }}
          hiddenInFlight={2}
          hiddenSettled={1}
          matterChoices={[]}
          matterFilter="all"
          onMatterFilter={() => undefined}
          onlyNeedsYou
          onOnlyNeedsYou={() => undefined}
          selectedId={null}
          onSelectRun={() => undefined}
          inFlightOpen={false}
          settledOpen={false}
          onToggleBand={() => undefined}
          pendingTeachCount={0}
          onShowAll={() => undefined}
        />,
      );
    });
    expect(host.textContent).toContain("没有要你处理的");
    expect(host.textContent).toContain("看正在办的和今天办完的");
  });
});
