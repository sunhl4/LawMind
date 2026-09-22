import { describe, expect, it } from "vitest";
import { mapToRows, rowsToMap } from "./lawmind-routing-defaults-form";

describe("lawmind-routing-defaults-form", () => {
  it("round-trips byKind / byDeliverable maps", () => {
    const map = {
      "draft.word": { roleId: "contract_review" },
      "contract.review": { assistantId: "asst_1", roleId: "contract_review" },
    };
    const rows = mapToRows(map);
    expect(rows).toEqual([
      { key: "draft.word", roleId: "contract_review", assistantId: "" },
      { key: "contract.review", roleId: "contract_review", assistantId: "asst_1" },
    ]);
    expect(rowsToMap(rows)).toEqual({
      "draft.word": { roleId: "contract_review", assistantId: undefined },
      "contract.review": { roleId: "contract_review", assistantId: "asst_1" },
    });
  });

  it("drops empty keys and empty assignee rows", () => {
    expect(
      rowsToMap([
        { key: "  ", roleId: "x", assistantId: "" },
        { key: "k", roleId: "", assistantId: "" },
        { key: "ok", roleId: "r", assistantId: "" },
      ]),
    ).toEqual({ ok: { roleId: "r", assistantId: undefined } });
  });
});
