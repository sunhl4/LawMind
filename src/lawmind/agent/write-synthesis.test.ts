import { describe, expect, it } from "vitest";
import {
  CALCULATE_PARAM_FAILURE_CAP,
  CALCULATE_PARAM_STOP_MARKER,
  WRITE_SYNTHESIS_DEMO_ONLY_CAP,
  WRITE_SYNTHESIS_MARKER,
  WRITE_SYNTHESIS_SEARCH_CAP,
  countSearchCalls,
  formatCalculateParamStopNudge,
  formatWriteSynthesisNudge,
  shouldSynthesizeBeforeWrite,
  trailingCalculateParamFailures,
  turnHasLiveStatuteHit,
  withholdSearchTools,
} from "./write-synthesis.js";

describe("write synthesis", () => {
  it("counts statute and case searches and withholds them once the cap is hit", () => {
    expect(
      countSearchCalls({
        search_statute: 3,
        search_case_law: 1,
        web_search: 0,
        write_document: 1,
      }),
    ).toBe(4);
    expect(WRITE_SYNTHESIS_SEARCH_CAP).toBe(4);
    const ready = shouldSynthesizeBeforeWrite({
      missingDeliverables: ["答辩状.md"],
      searchCalls: 4,
      advertisedToolNames: ["search_statute", "write_document", "calculate"],
    });
    expect(ready).toBe(true);
    expect(
      withholdSearchTools(["search_statute", "search_case_law", "write_document", "calculate"]),
    ).toEqual(["write_document", "calculate"]);
  });

  it("waits past four searches when every hit is still demo corpus", () => {
    const demoOnly = [
      {
        toolCallResponses: [
          {
            name: "search_statute",
            result: { ok: true, data: { demoCorpus: true, hits: [{ snippet: "第三十六条" }] } },
          },
        ],
      },
    ];
    expect(turnHasLiveStatuteHit(demoOnly)).toBe(false);
    expect(WRITE_SYNTHESIS_DEMO_ONLY_CAP).toBe(8);
    expect(
      shouldSynthesizeBeforeWrite({
        missingDeliverables: ["答辩状.md"],
        searchCalls: 4,
        advertisedToolNames: ["search_statute", "write_document"],
        liveStatuteHit: false,
      }),
    ).toBe(false);
    expect(
      shouldSynthesizeBeforeWrite({
        missingDeliverables: ["答辩状.md"],
        searchCalls: 8,
        advertisedToolNames: ["write_document"],
        liveStatuteHit: false,
      }),
    ).toBe(true);
    expect(
      turnHasLiveStatuteHit([
        {
          toolCallResponses: [
            {
              name: "search_statute",
              result: {
                ok: true,
                data: { hits: [{ title: "劳动合同法", snippet: "第三十六条" }] },
              },
            },
          ],
        },
      ]),
    ).toBe(true);
  });

  it("stays off when the named file is already there or searches are still short", () => {
    expect(
      shouldSynthesizeBeforeWrite({
        missingDeliverables: [],
        searchCalls: 8,
        advertisedToolNames: ["write_document"],
      }),
    ).toBe(false);
    expect(
      shouldSynthesizeBeforeWrite({
        missingDeliverables: ["memo.md"],
        searchCalls: 3,
        advertisedToolNames: ["search_statute", "write_document"],
      }),
    ).toBe(false);
    expect(
      shouldSynthesizeBeforeWrite({
        missingDeliverables: ["memo.md"],
        searchCalls: 4,
        advertisedToolNames: ["search_statute", "calculate"],
      }),
    ).toBe(false);
  });

  it("keeps retrieved article numbers and still asks for a complete conclusion", () => {
    const nudge = formatWriteSynthesisNudge(["答辩状-5.md"]);
    expect(nudge.startsWith(WRITE_SYNTHESIS_MARKER)).toBe(true);
    expect(nudge).toContain("答辩状-5.md");
    expect(nudge).toContain("已经出现的条号");
    expect(nudge).toContain("【待核实】");
    expect(nudge).toContain("结论仍写完整");
    expect(nudge).toContain("演示语料不要写成权威来源");
    expect(nudge).toContain("不要整段改成待核实");
    expect(nudge).not.toContain("检索先停");
    expect(nudge).not.toContain("不要再调用");
    expect(nudge).not.toContain("不要编造条号");
    expect(nudge).not.toContain("不要替题目下胜负结论");
  });

  it("counts only trailing calculate parameter failures", () => {
    const messages = [
      {
        toolCallResponses: [
          { name: "calculate", result: { ok: false, error: "yearsOfService 必须是数字。" } },
        ],
      },
      {
        toolCallResponses: [{ name: "search_statute", result: { ok: true } }],
      },
      {
        toolCallResponses: [
          { name: "calculate", result: { ok: false, error: "start 必须是 YYYY-MM-DD。" } },
        ],
      },
    ];
    expect(trailingCalculateParamFailures(messages)).toBe(2);
    expect(CALCULATE_PARAM_FAILURE_CAP).toBe(2);
    expect(formatCalculateParamStopNudge()).toContain(CALCULATE_PARAM_STOP_MARKER);
    expect(formatCalculateParamStopNudge()).toContain("未核算");
    expect(
      trailingCalculateParamFailures([
        {
          toolCallResponses: [{ name: "calculate", result: { ok: false, error: "必须是数字。" } }],
        },
        { toolCallResponses: [{ name: "calculate", result: { ok: true } }] },
        {
          toolCallResponses: [{ name: "calculate", result: { ok: false, error: "必须是数字。" } }],
        },
      ]),
    ).toBe(1);
  });
});
