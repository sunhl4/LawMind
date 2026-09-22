/**
 * @vitest-environment jsdom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MatterCognitionPanel } from "./MatterCognitionPanel";

describe("MatterCognitionPanel density", () => {
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

  it("keeps upgrade clues visible and folds diagnostics", async () => {
    await act(async () => {
      root.render(
        <MatterCognitionPanel
          apiBase=""
          matterId="m-1"
          drafts={[]}
          cognitionTaskId={null}
          setCognitionTaskId={() => {}}
          cognitionDraft={null}
          cognitionBoardLoading={false}
          cognitionBoardError={null}
          cognitionBoard={{
            observedDraftCount: 2,
            reasoningDraftCount: 1,
            uniqueMemoryLayerCount: 3,
            injectedMemoryLayerCount: 1,
            candidateMemoryLayerCount: 1,
            missingMemoryLayerCount: 0,
            missingReasoningCount: 0,
            missingCitationCount: 0,
            uncoveredFrequentLayerCount: 0,
            oldestDraftAt: "2026-01-01T00:00:00.000Z",
            newestDraftAt: "2026-09-01T00:00:00.000Z",
            memoryCategories: [],
            missingMemoryLayers: [],
            upgradeSuggestions: [
              { label: "时效抗辩口径", recommendation: "写入律师档案", count: 3 },
            ],
            topMemoryLayers: [],
            draftCoverage: [],
          }}
          cognitionLoading={false}
          cognitionError={null}
          cognitionReasoningMarkdown={null}
          cognitionMemorySources={[]}
          cognitionActionBusy={null}
          cognitionActionMsg={null}
          draftCitationByTask={{}}
          adoptionHistoryInsight={{
            total: 0,
            lawyerCount: 0,
            assistantCount: 0,
            crossMatterCount: 0,
            latestSavedAt: undefined,
            repeatedLabels: [],
          }}
          visiblePersistentAdoptions={[]}
          adoptedSuggestions={[]}
          saveUpgradeSuggestion={async () => {}}
          openReviewFromMatter={() => {}}
        />,
      );
    });

    expect(host.textContent).toContain("经验升级线索");
    expect(host.textContent).toContain("时效抗辩口径");
    expect(host.textContent).toContain("诊断与记录");
    expect(host.textContent).not.toContain("认知风险信号");
    expect(host.textContent).not.toContain("记忆采纳队列");

    await act(async () => {
      host.querySelector<HTMLButtonElement>("[data-testid='lm-matter-overview-more']")?.click();
    });

    expect(host.textContent).toContain("认知风险信号");
    expect(host.textContent).toContain("记忆采纳队列");
  });
});
