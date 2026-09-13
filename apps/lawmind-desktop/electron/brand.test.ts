import { describe, expect, it, vi } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  LAWMIND_PRODUCT_NAME,
  applyProductName,
  loadDesktopBrand,
  pinDevUserData,
  resolveRuntimeAppIconPath,
} from "./brand.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));

describe("desktop brand", () => {
  it("loads the checked-in manifest", () => {
    const brand = loadDesktopBrand();
    expect(brand.productName).toBe("LawMind");
    expect(brand.appId).toBe("ai.lawmind.desktop");
    expect(LAWMIND_PRODUCT_NAME).toBe("LawMind");
    expect(resolveRuntimeAppIconPath(here)).toBe(path.join(here, "icon.png"));
  });

  it("pins unpackaged userData to the historical Electron folder", () => {
    const setPath = vi.fn();
    pinDevUserData({
      getPath: (name: string) => (name === "appData" ? "/tmp/AppSupport" : ""),
      setPath,
      isPackaged: false,
    });
    expect(setPath).toHaveBeenCalledWith("userData", path.join("/tmp/AppSupport", "Electron"));
  });

  it("does not pin userData for packaged builds", () => {
    const setPath = vi.fn();
    pinDevUserData(
      {
        getPath: () => "/tmp/AppSupport",
        setPath,
        isPackaged: true,
      },
      { packaged: true },
    );
    expect(setPath).not.toHaveBeenCalled();
  });

  it("sets the process name and About panel", () => {
    const electronApp = {
      setName: vi.fn(),
      setAboutPanelOptions: vi.fn(),
      getVersion: () => "0.1.0",
    };
    applyProductName(electronApp);
    expect(electronApp.setName).toHaveBeenCalledWith("LawMind");
    expect(electronApp.setAboutPanelOptions).toHaveBeenCalledWith({
      applicationName: "LawMind",
      applicationVersion: "0.1.0",
    });
  });
});
