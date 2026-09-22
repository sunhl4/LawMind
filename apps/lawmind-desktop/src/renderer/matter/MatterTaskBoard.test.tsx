/**
 * @vitest-environment jsdom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MatterTaskBoard } from "./MatterTaskBoard";

describe("MatterTaskBoard", () => {
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

  it("aggregates queue row subtitle from phase label", async () => {
    await act(async () => {
      root.render(
        <MatterTaskBoard
          tasks={[]}
          queueItems={[
            {
              queueItemId: "q-1",
              matterId: "m-1",
              kind: "need_lawyer_review",
              phase: "review",
              status: "open",
              priority: "normal",
              title: "复核违约金条款",
              createdAt: "2026-01-01T00:00:00.000Z",
              updatedAt: "2026-01-01T00:00:00.000Z",
            },
          ]}
          approvalRequests={[]}
          drafts={[]}
          acceptanceByTask={{}}
        />,
      );
    });
    expect(host.textContent).toContain("复核违约金条款");
    expect(host.textContent).toContain("审核");
  });
});
