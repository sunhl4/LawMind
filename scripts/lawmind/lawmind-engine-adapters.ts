/**
 * Shared model adapter wiring for LawMind CLIs (smoke, benchmark).
 */

import {
  createDomesticGeneralAdaptersFromEnv,
  createGeneralModelAdapter,
  createLegalModelAdapter,
  createLexEdgeAdapterFromEnv,
  createOpenSourceLegalAdaptersFromEnv,
  createPartnerLegalAdapterFromEnv,
  createWorkspaceAdapter,
} from "../../src/lawmind/index.js";

export function buildLawMindCliAdapters(workspaceDir: string, opts: { forceMock?: boolean } = {}) {
  const mockGeneralAdapter = createGeneralModelAdapter(async () => ({
    claims: [
      {
        text: "该事项需要先完成事实清单与证据清单，再形成正式法律意见。",
        confidence: 0.82,
      },
    ],
    sources: [{ title: "内部工作流规范", citation: "workspace/MEMORY.md" }],
  }));

  const mockLegalAdapter = createLegalModelAdapter(async () => ({
    claims: [
      {
        text: "在作出最终法律意见前，应明确适用法律条款并核对最新修订版本。",
        confidence: 0.9,
      },
    ],
    sources: [{ title: "法律检索规则", citation: "通用法律工作流规则" }],
    riskFlags: ["当前为 benchmark/smoke 模拟数据。"],
  }));

  const realAdapters = [
    ...createDomesticGeneralAdaptersFromEnv(),
    ...createOpenSourceLegalAdaptersFromEnv(),
    ...createLexEdgeAdapterFromEnv(),
    ...createPartnerLegalAdapterFromEnv(),
  ];
  const useRealModel = !opts.forceMock && realAdapters.length > 0;
  const modelAdapters = useRealModel ? realAdapters : [mockGeneralAdapter, mockLegalAdapter];

  return {
    adapters: [createWorkspaceAdapter(workspaceDir), ...modelAdapters],
    useRealModel,
    modelHint: useRealModel ? "env-adapters" : "mock-adapters",
  };
}
