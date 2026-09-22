/**
 * 端口契约的回归测试。
 *
 * 这一组锁的是 2026-09-21 那次故障的**根因面**：Word 的侧载清单把回环端口钉死在文件里，
 * 所以端口是持久化契约的一部分 —— 静默漂移会让所有已侧载的窗格失联，而窗格自己无法
 * 重新发现新端口（发现端点也挂在旧 base 上）。
 *
 * 三条断言各自对应一个必须成立的性质：
 *   1. 漂移只在**真的换了端口**时成立（不误报），且占用者三态不能退化；
 *   2. 「是不是 LawMind」的判定要严到不会把别人的服务认成自己（否则会误导排障方向）；
 *   3. 清单落点不能凭空造 Word 的容器目录（那是别的应用的地盘）。
 */

import { describe, expect, it } from "vitest";
import {
  buildPortDrift,
  classifyDiscoveryResponse,
  manifestInstructions,
  resolveManifestTargets,
} from "./local-api-port-contract.mjs";

describe("buildPortDrift：端口漂移的判定", () => {
  it("端口没变 ⇒ 不算漂移（null）", () => {
    expect(buildPortDrift({ preferredPort: 54881, actualPort: 54881 })).toBeNull();
  });

  it("没有偏好端口（首次启动 / 用户没配）⇒ 不算漂移", () => {
    expect(buildPortDrift({ preferredPort: 0, actualPort: 50169 })).toBeNull();
    expect(buildPortDrift({ preferredPort: null, actualPort: 50169 })).toBeNull();
    expect(buildPortDrift({ preferredPort: undefined, actualPort: 50169 })).toBeNull();
  });

  it("真的换了端口 ⇒ 记下 requested / actual", () => {
    const drift = buildPortDrift({
      preferredPort: 54881,
      actualPort: 50169,
      occupant: "another-lawmind",
    });
    expect(drift).toEqual({
      requestedPort: 54881,
      actualPort: 50169,
      occupant: "another-lawmind",
    });
  });

  it("占用者三态不退化：unknown 不等于 foreign", () => {
    // 混为一谈会让排障的人往错的方向查（外部程序 vs 刚崩掉的残留）。
    const foreign = buildPortDrift({ preferredPort: 1, actualPort: 2, occupant: "foreign" });
    const unknown = buildPortDrift({ preferredPort: 1, actualPort: 2, occupant: "unknown" });
    const missing = buildPortDrift({ preferredPort: 1, actualPort: 2 });
    expect(foreign?.occupant).toBe("foreign");
    expect(unknown?.occupant).toBe("unknown");
    expect(missing?.occupant).toBe("unknown");
  });

  it("拒绝非法的 preferredPort（负数 / 非整数 / 越界不当偏好）", () => {
    expect(buildPortDrift({ preferredPort: -1, actualPort: 50169 })).toBeNull();
    expect(buildPortDrift({ preferredPort: 1.5, actualPort: 50169 })).toBeNull();
    expect(buildPortDrift({ preferredPort: 70000, actualPort: 50169 })).toBeNull();
  });
});

describe("classifyDiscoveryResponse：是不是 LawMind 自己", () => {
  it("发现端点的真实形状 ⇒ another-lawmind", () => {
    expect(
      classifyDiscoveryResponse({
        ok: true,
        base: "http://127.0.0.1:54881",
        instanceId: "fbd29cb11237a0c4",
        epoch: 1,
        clients: ["desktop", "renderer", "word-addin", "cli"],
        credentialModel: "derived-hmac-sha256",
      }),
    ).toBe("another-lawmind");
  });

  it("缺任何一项形状特征都不认（宁可说不认识，也不误导）", () => {
    const base = {
      instanceId: "x",
      epoch: 1,
      clients: ["cli"],
    };
    expect(classifyDiscoveryResponse({ ...base, instanceId: undefined })).toBe("foreign");
    expect(classifyDiscoveryResponse({ ...base, instanceId: "" })).toBe("foreign");
    expect(classifyDiscoveryResponse({ ...base, epoch: "1" })).toBe("foreign");
    expect(classifyDiscoveryResponse({ ...base, clients: "cli" })).toBe("foreign");
  });

  it("别人的服务 / 非 JSON / 空值 ⇒ foreign", () => {
    expect(classifyDiscoveryResponse({ hello: "world" })).toBe("foreign");
    expect(classifyDiscoveryResponse("not json")).toBe("foreign");
    expect(classifyDiscoveryResponse(null)).toBe("foreign");
    expect(classifyDiscoveryResponse(undefined)).toBe("foreign");
  });
});

describe("resolveManifestTargets：清单落点", () => {
  const alwaysExists = () => true;
  const neverExists = () => false;

  it("macOS 且 Word 容器已存在 ⇒ 优先直接装进侧载目录", () => {
    const targets = resolveManifestTargets({
      platform: "darwin",
      home: "/Users/shl",
      downloads: "/Users/shl/Downloads",
      exists: alwaysExists,
    });
    expect(targets[0]).toEqual({
      location: "word-container",
      dir: "/Users/shl/Library/Containers/com.microsoft.Word/Data/Documents/wef/lawmind-word-addin",
    });
    expect(targets[1]).toEqual({ location: "downloads", dir: "/Users/shl/Downloads" });
  });

  it("Word 容器不存在（没装 Word）⇒ 不凭空造容器目录，直接退到下载目录", () => {
    const targets = resolveManifestTargets({
      platform: "darwin",
      home: "/Users/shl",
      downloads: "/Users/shl/Downloads",
      exists: neverExists,
    });
    // 造出 com.microsoft.Word 的容器是污染别的应用的地盘，必须避免。
    expect(targets).toEqual([{ location: "downloads", dir: "/Users/shl/Downloads" }]);
  });

  it("非 macOS（Windows / Linux）⇒ 只有下载目录", () => {
    for (const platform of ["win32", "linux"]) {
      const targets = resolveManifestTargets({
        platform,
        home: "C:/Users/shl",
        downloads: "C:/Users/shl/Downloads",
        exists: alwaysExists,
      });
      expect(targets.map((t) => t.location)).toEqual(["downloads"]);
    }
  });
});

describe("manifestInstructions：说明要说清下一步做什么", () => {
  it("装进侧载目录 ⇒ 让律师重启 Word", () => {
    const text = manifestInstructions("word-container", "http://localhost:54881");
    expect(text).toContain("退出 Word");
    expect(text).not.toContain("拖进");
  });

  it("退到下载目录 ⇒ 让律师自己拖，并写明清单指向的地址", () => {
    const text = manifestInstructions("downloads", "http://localhost:54881");
    expect(text).toContain("拖进");
    expect(text).toContain("http://localhost:54881");
  });
});
