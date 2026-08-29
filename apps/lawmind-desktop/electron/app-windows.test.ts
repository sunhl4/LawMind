import { describe, expect, it } from "vitest";
import {
  isAuxPopoutWindowUrl,
  isDevToolsWindowUrl,
  shouldKeepLocalServerAlive,
} from "./app-windows.mjs";

describe("isDevToolsWindowUrl", () => {
  it("matches detached DevTools", () => {
    expect(isDevToolsWindowUrl("devtools://devtools/bundled/devtools_app.html")).toBe(true);
  });

  it("does not match LawMind renderer URLs", () => {
    expect(isDevToolsWindowUrl("http://127.0.0.1:5174/")).toBe(false);
    expect(isDevToolsWindowUrl("file:///Applications/LawMind.app/Contents/Resources/dist/index.html")).toBe(
      false,
    );
  });
});

describe("isAuxPopoutWindowUrl", () => {
  it("matches review preview hash", () => {
    expect(isAuxPopoutWindowUrl("http://127.0.0.1:5174/#lm-popout=review-preview&taskId=t1")).toBe(true);
  });

  it("does not match the main workspace", () => {
    expect(isAuxPopoutWindowUrl("http://127.0.0.1:5174/")).toBe(false);
  });
});

describe("shouldKeepLocalServerAlive", () => {
  it("keeps the API when the main window is still up (DevTools / aux closed)", () => {
    expect(
      shouldKeepLocalServerAlive({
        mainAlive: true,
        auxAliveCount: 0,
        remainingAppWindowCount: 0,
      }),
    ).toBe(true);
  });

  it("keeps the API when an aux preview remains after the main window closed", () => {
    expect(
      shouldKeepLocalServerAlive({
        mainAlive: false,
        auxAliveCount: 1,
        remainingAppWindowCount: 1,
      }),
    ).toBe(true);
  });

  it("keeps the API when any non-DevTools window remains", () => {
    expect(
      shouldKeepLocalServerAlive({
        mainAlive: false,
        auxAliveCount: 0,
        remainingAppWindowCount: 1,
      }),
    ).toBe(true);
  });

  it("allows shutdown only when no app windows remain", () => {
    expect(
      shouldKeepLocalServerAlive({
        mainAlive: false,
        auxAliveCount: 0,
        remainingAppWindowCount: 0,
      }),
    ).toBe(false);
  });
});
