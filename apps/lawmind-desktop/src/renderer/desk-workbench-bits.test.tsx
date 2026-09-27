/**
 * @vitest-environment jsdom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { IntakeBriefBlocks, type IntakeBriefView } from "./desk-workbench-bits";

function brief(over: Partial<IntakeBriefView> = {}): IntakeBriefView {
  return {
    clientNeeds: [],
    coreFacts: [],
    causeCandidates: [],
    evidenceGaps: [],
    nextActions: [],
    ...over,
  };
}

describe("IntakeBriefBlocks", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    host.remove();
  });

  it("shows parties that were read but did not fit the docket", async () => {
    await act(async () => {
      root.render(
        <IntakeBriefBlocks
          brief={brief({ omittedPartyNotes: ["被告：被告33", "被告：被告34"] })}
          onApplyCause={() => undefined}
        />,
      );
    });
    expect(host.textContent).toContain("未写入卷宗的当事人");
    expect(host.textContent).toContain("被告：被告33");
    expect(host.textContent).toContain("被告：被告34");
  });

  it("hides the omitted-party block when nobody was left out", async () => {
    await act(async () => {
      root.render(<IntakeBriefBlocks brief={brief()} onApplyCause={() => undefined} />);
    });
    expect(host.textContent).not.toContain("未写入卷宗的当事人");
  });
});
