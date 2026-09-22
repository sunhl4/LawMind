import { describe, expect, it } from "vitest";
import {
  isAllowedMainWindowNavigationUrl,
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

describe("isAllowedMainWindowNavigationUrl (will-navigate 防护)", () => {
  const opts = {
    devServerUrl: "http://127.0.0.1:5174",
    distIndexPath: "/Applications/LawMind.app/Contents/Resources/dist/index.html",
  };

  it("allows the packaged renderer file:// under dist/", () => {
    expect(
      isAllowedMainWindowNavigationUrl(
        "file:///Applications/LawMind.app/Contents/Resources/dist/index.html",
        opts,
      ),
    ).toBe(true);
    expect(
      isAllowedMainWindowNavigationUrl(
        "file:///Applications/LawMind.app/Contents/Resources/dist/assets/app.js",
        opts,
      ),
    ).toBe(true);
  });

  it("allows the dev server origin (loopback spelling variants)", () => {
    expect(isAllowedMainWindowNavigationUrl("http://127.0.0.1:5174/", opts)).toBe(true);
    expect(isAllowedMainWindowNavigationUrl("http://127.0.0.1:5174/#lm-popout=review-preview", opts)).toBe(
      true,
    );
    expect(isAllowedMainWindowNavigationUrl("http://localhost:5174/", opts)).toBe(true);
  });

  it("blocks remote https pages (token + fs bridge exposure)", () => {
    expect(isAllowedMainWindowNavigationUrl("https://evil.example/phish", opts)).toBe(false);
  });

  it("blocks other loopback ports and non-dist file paths", () => {
    expect(isAllowedMainWindowNavigationUrl("http://127.0.0.1:9999/", opts)).toBe(false);
    expect(isAllowedMainWindowNavigationUrl("file:///etc/passwd", opts)).toBe(false);
  });

  it("blocks non-http(s)/file protocols and garbage", () => {
    expect(isAllowedMainWindowNavigationUrl("devtools://devtools/bundled/devtools_app.html", opts)).toBe(
      false,
    );
    expect(isAllowedMainWindowNavigationUrl("not a url", opts)).toBe(false);
    expect(isAllowedMainWindowNavigationUrl("", opts)).toBe(false);
    expect(isAllowedMainWindowNavigationUrl(undefined, opts)).toBe(false);
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
