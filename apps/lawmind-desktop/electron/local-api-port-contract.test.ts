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
  addinHostStatus,
  hostReconnectInstructions,
  lawmindPortInWpsPublish,
  loopbackPortInText,
  manifestInstructions,
  resolveManifestTargets,
  resolveWpsJsaddonsDir,
  upsertWpsPublishXml,
  windowsWordDeveloperRegArgs,
  WORD_ADDIN_MANIFEST_ID,
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

  it("Windows 且装了 Word ⇒ 先登记当前用户的开发者加载项，不写下载目录优先", () => {
    const targets = resolveManifestTargets({
      platform: "win32",
      home: "C:/Users/shl",
      downloads: "C:/Users/shl/Downloads",
      appData: "C:/Users/shl/AppData/Roaming",
      windowsWord: true,
      exists: () => false,
    });
    expect(targets[0]).toEqual({
      location: "word-windows",
      dir: "C:/Users/shl/AppData/Roaming/LawMind/word-addin",
    });
  });

  it("Windows 没装 Word ⇒ 不造开发者加载项目录", () => {
    const targets = resolveManifestTargets({
      platform: "win32",
      home: "C:/Users/shl",
      downloads: "C:/Users/shl/Downloads",
      appData: "C:/Users/shl/AppData/Roaming",
      windowsWord: false,
      exists: () => true,
    });
    expect(targets.map((target) => target.location)).toEqual(["downloads"]);
  });

  it("Word 开发者登记只用当前用户的注册表参数", () => {
    const args = windowsWordDeveloperRegArgs("C:\\Users\\shl\\AppData\\Roaming\\LawMind\\word-addin\\manifest.xml");
    expect(args[0]).toBe("add");
    expect(args.join(" ")).toContain("HKCU\\Software\\Microsoft\\Office\\16.0\\WEF\\Developer");
    expect(args).toContain(WORD_ADDIN_MANIFEST_ID);
    expect(args.join(" ")).not.toContain("HKLM");
    expect(() => windowsWordDeveloperRegArgs("")).toThrow(/invalid/);
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

  it("同时连上 Word 和 WPS 时，说明里不写地址", () => {
    const text = hostReconnectInstructions({
      wordLocation: "word-container",
      wpsStatus: "written",
      changed: true,
    });
    expect(text).toContain("Word");
    expect(text).toContain("WPS");
    expect(text).not.toContain("localhost");
    expect(text).not.toContain("54881");
  });

  it("退到下载目录 ⇒ 让律师放进 Word，不写出地址", () => {
    const text = manifestInstructions("downloads", "http://localhost:54881");
    expect(text).toContain("下载");
    expect(text).toContain("完全退出 Word");
    expect(text).not.toContain("http://localhost:54881");
    expect(text).not.toContain("54881");
  });
});

describe("WPS publish.xml", () => {
  const url = "http://localhost:62400/word-addin/wps/";

  it("没装 WPS 时不造目录", () => {
    expect(
      resolveWpsJsaddonsDir({
        platform: "darwin",
        home: "/Users/shl",
        exists: () => false,
      }),
    ).toBeNull();
  });

  it("Mac 上父目录已在就登记到 jsaddons", () => {
    expect(
      resolveWpsJsaddonsDir({
        platform: "darwin",
        home: "/Users/shl",
        exists: (p) => p.endsWith("/.kingsoft/wps"),
      }),
    ).toBe("/Users/shl/Library/Containers/com.kingsoft.wpsoffice.mac/Data/.kingsoft/wps/jsaddons");
  });

  it("写入时保留别人的加载项，并只认自己的端口", () => {
    const xml = upsertWpsPublishXml(
      `<jsplugins>\n  <jsplugin name="other" type="wps" url="http://127.0.0.1:9/x/" enable="enable"/>\n</jsplugins>\n`,
      url,
    );
    expect(xml).toContain('name="other"');
    expect(xml).toContain(url);
    expect(lawmindPortInWpsPublish(xml)).toBe(62400);
    expect(loopbackPortInText("noise")).toBeNull();
  });

  it("重复登记替换自己的那条，不追加第二条", () => {
    const once = upsertWpsPublishXml("", "http://localhost:54881/word-addin/wps/");
    const twice = upsertWpsPublishXml(once, url);
    expect(twice.match(/name="lawmind"/g)).toHaveLength(1);
    expect(lawmindPortInWpsPublish(twice)).toBe(62400);
  });

  it("拒绝不是回环加载项目录的地址", () => {
    expect(() => upsertWpsPublishXml("", "https://example.com/word-addin/wps/")).toThrow(/invalid/);
  });
});

describe("addinHostStatus", () => {
  it("文件端口对上且这次没改过 ⇒ 已连接", () => {
    expect(
      addinHostStatus({
        installed: true,
        recordedPort: 62400,
        actualPort: 62400,
        pendingReopen: false,
        anotherCopy: false,
      }),
    ).toBe("connected");
  });

  it("刚改过清单 ⇒ 请重开，即使端口已经写对", () => {
    expect(
      addinHostStatus({
        installed: true,
        recordedPort: 62400,
        actualPort: 62400,
        pendingReopen: true,
        anotherCopy: false,
      }),
    ).toBe("reopen");
  });

  it("另一个 LawMind 占着端口 ⇒ 不叫人去连这份", () => {
    expect(
      addinHostStatus({
        installed: true,
        recordedPort: 1,
        actualPort: 2,
        pendingReopen: false,
        anotherCopy: true,
      }),
    ).toBe("another-copy");
  });

  it("没安装 ⇒ missing", () => {
    expect(
      addinHostStatus({
        installed: false,
        recordedPort: null,
        actualPort: 62400,
        pendingReopen: false,
        anotherCopy: false,
      }),
    ).toBe("missing");
  });
});
