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

  it("honors LAWMIND_USER_DATA_DIR so E2E can isolate the whole profile", () => {
    const prev = process.env.LAWMIND_USER_DATA_DIR;
    process.env.LAWMIND_USER_DATA_DIR = "/tmp/lm-e2e-userdata";
    try {
      const setPath = vi.fn();
      pinDevUserData({
        getPath: (name: string) => (name === "appData" ? "/tmp/AppSupport" : ""),
        setPath,
        isPackaged: false,
      });
      // 覆盖优先于历史 Electron 目录：配置、.env.lawmind、models.json 与 localStorage 一并隔离。
      expect(setPath).toHaveBeenCalledWith("userData", "/tmp/lm-e2e-userdata");

      // 打包版忽略该变量：环境变量不得改变生产 userData。
      const packagedSetPath = vi.fn();
      pinDevUserData(
        { getPath: () => "/tmp/AppSupport", setPath: packagedSetPath, isPackaged: true },
        { packaged: true },
      );
      expect(packagedSetPath).not.toHaveBeenCalled();
    } finally {
      if (prev === undefined) {
        delete process.env.LAWMIND_USER_DATA_DIR;
      } else {
        process.env.LAWMIND_USER_DATA_DIR = prev;
      }
    }
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
