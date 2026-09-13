/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it } from "vitest";
import { hasLawmindDesktopBridge } from "./lawmind-desktop-bridge";

describe("hasLawmindDesktopBridge", () => {
  afterEach(() => {
    delete (window as { lawmindDesktop?: unknown }).lawmindDesktop;
  });

  it("is false in a plain browser tab", () => {
    expect(hasLawmindDesktopBridge()).toBe(false);
  });

  it("is true when Electron preload (or e2e stub) injected getConfig", () => {
    window.lawmindDesktop = {
      getConfig: async () =>
        ({
          apiBase: "http://127.0.0.1:9",
          workspaceDir: "/tmp/ws",
          projectDir: null,
          envFilePath: "",
          retrievalMode: "single",
        }) as Awaited<ReturnType<NonNullable<Window["lawmindDesktop"]>["getConfig"]>>,
    } as Window["lawmindDesktop"];
    expect(hasLawmindDesktopBridge()).toBe(true);
  });
});
