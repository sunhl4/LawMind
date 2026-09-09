/**
 * @vitest-environment jsdom
 *
 * 产品实验台卡片（跨案件实验累积板 / Roadmap 候选池）为内部仪器：
 * 律师构建（默认）不渲染；VITE_LAWMIND_INTERNAL_EXPERIMENT_UI=1 时完整渲染。
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MatterCrossExperimentBoardCard,
  MatterRoadmapCandidatesCard,
} from "./matter-roadmap-cards";
import type { CrossExperimentBoardItem } from "./matter-roadmap-cards";
import type { MatterRoadmapCandidate } from "./matter-interaction";

const boardItem: CrossExperimentBoardItem = {
  key: "adapt-review-surface",
  title: "审核上下文前置",
  matterCount: 3,
  totalEvents: 9,
  latestAt: "2026-08-01T10:00:00.000Z",
  exampleMatterIds: ["m-1"],
  includesCurrentMatter: false,
};

const candidate: MatterRoadmapCandidate = {
  key: "adapt-review-surface",
  title: "审核上下文前置",
  score: 41,
  rationale: "多案件重复出现。",
  urgency: "now",
  readiness: "validated",
  owner: "案件概览 / 文书台",
  benefit: "减少来回切换。",
  risk: "概览变重。",
  matterCount: 3,
  totalEvents: 9,
};

describe("matter-roadmap-cards 内部开关", () => {
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
    vi.unstubAllEnvs();
  });

  it("默认（律师构建）两张实验台卡片均不渲染", async () => {
    vi.stubEnv("VITE_LAWMIND_INTERNAL_EXPERIMENT_UI", "0");
    await act(async () => {
      root.render(
        <>
          <MatterCrossExperimentBoardCard items={[boardItem]} onOpenSuggestion={vi.fn()} />
          <MatterRoadmapCandidatesCard
            candidates={[candidate]}
            summary={{ candidateCount: 1, nowCount: 1, validatedCount: 1, topCandidate: candidate }}
            onOpenSuggestion={vi.fn()}
          />
        </>,
      );
    });
    expect(host.textContent).not.toContain("跨案件实验累积板");
    expect(host.textContent).not.toContain("Roadmap 候选池");
    expect(host.querySelector(".lm-matter-cross-experiment-card")).toBeNull();
    expect(host.querySelector(".lm-matter-roadmap-card")).toBeNull();
  });

  it("内部开关开启时功能完整渲染", async () => {
    vi.stubEnv("VITE_LAWMIND_INTERNAL_EXPERIMENT_UI", "1");
    await act(async () => {
      root.render(
        <>
          <MatterCrossExperimentBoardCard items={[boardItem]} onOpenSuggestion={vi.fn()} />
          <MatterRoadmapCandidatesCard
            candidates={[candidate]}
            summary={{ candidateCount: 1, nowCount: 1, validatedCount: 1, topCandidate: candidate }}
            onOpenSuggestion={vi.fn()}
          />
        </>,
      );
    });
    expect(host.textContent).toContain("跨案件实验累积板");
    expect(host.textContent).toContain("Roadmap 候选池");
    expect(host.textContent).toContain("审核上下文前置");
    expect(host.textContent).toContain("建议 owner");
  });
});
