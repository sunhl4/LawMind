/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from "vitest";
import {
  requestContractFastLaneOpen,
  subscribeContractFastLaneOpen,
} from "./lawmind-contract-fast-lane-bus";

describe("lawmind-contract-fast-lane-bus", () => {
  it("notifies subscribers", () => {
    const fn = vi.fn();
    const unsub = subscribeContractFastLaneOpen(fn);
    requestContractFastLaneOpen({ materialsHint: "已引用：a.docx", preferCompact: true });
    expect(fn).toHaveBeenCalledWith({ materialsHint: "已引用：a.docx", preferCompact: true });
    unsub();
    requestContractFastLaneOpen({});
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
