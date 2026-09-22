import { describe, expect, it, beforeEach } from "vitest";
import {
  resetMatterOverviewViewStoreForTest,
  useMatterOverviewViewStore,
} from "./matter-overview-view-store";

describe("matter-overview-view-store", () => {
  beforeEach(() => {
    resetMatterOverviewViewStoreForTest();
  });

  it("starts with default focus/sort and collapsed extras", () => {
    expect(useMatterOverviewViewStore.getState().opsFocus).toBe("all");
    expect(useMatterOverviewViewStore.getState().opsSort).toBe("priority");
    expect(useMatterOverviewViewStore.getState().extrasOpen).toBe(false);
  });

  it("updates ops focus and sort", () => {
    useMatterOverviewViewStore.getState().setOpsFocus("review");
    useMatterOverviewViewStore.getState().setOpsSort("recent");
    expect(useMatterOverviewViewStore.getState().opsFocus).toBe("review");
    expect(useMatterOverviewViewStore.getState().opsSort).toBe("recent");
  });

  it("toggles extras open/closed", () => {
    useMatterOverviewViewStore.getState().openExtras();
    expect(useMatterOverviewViewStore.getState().extrasOpen).toBe(true);
    useMatterOverviewViewStore.getState().closeExtras();
    expect(useMatterOverviewViewStore.getState().extrasOpen).toBe(false);
  });

  it("resetTransient restores defaults while keeping store instance", () => {
    useMatterOverviewViewStore.getState().setOpsFocus("highRisk");
    useMatterOverviewViewStore.getState().setOpsSort("title");
    useMatterOverviewViewStore.getState().openExtras();
    useMatterOverviewViewStore.getState().resetTransient();
    expect(useMatterOverviewViewStore.getState().opsFocus).toBe("all");
    expect(useMatterOverviewViewStore.getState().opsSort).toBe("priority");
    expect(useMatterOverviewViewStore.getState().extrasOpen).toBe(false);
  });
});
