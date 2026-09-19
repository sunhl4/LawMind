import { describe, expect, it } from "vitest";
import { resolveDevUserDataDir } from "./lawmind-root.mjs";

describe("resolveDevUserDataDir", () => {
  const base = { appDataDir: "/Users/x/Library/Application Support", brandFolder: "Electron" };

  it("pins the brand dev folder by default", () => {
    expect(resolveDevUserDataDir({ ...base })).toBe(
      "/Users/x/Library/Application Support/Electron",
    );
    expect(resolveDevUserDataDir({ ...base, brandFolder: undefined })).toBe(
      "/Users/x/Library/Application Support/Electron",
    );
    expect(resolveDevUserDataDir({ ...base, brandFolder: "LawMindDev" })).toBe(
      "/Users/x/Library/Application Support/LawMindDev",
    );
  });

  it("honors LAWMIND_USER_DATA_DIR so E2E can isolate the whole profile", () => {
    // 绝对路径：原样（resolve 后）使用。
    expect(resolveDevUserDataDir({ ...base, override: "/tmp/lm-e2e-userdata" })).toBe(
      "/tmp/lm-e2e-userdata",
    );
    // 相对路径：相对当前工作目录 resolve，行为可预期。
    expect(resolveDevUserDataDir({ ...base, override: "./tmp/ud" })).toBe(
      `${process.cwd()}/tmp/ud`,
    );
    // 空白覆盖等同未设置，不能把 userData 指到空路径。
    expect(resolveDevUserDataDir({ ...base, override: "   " })).toBe(
      "/Users/x/Library/Application Support/Electron",
    );
  });

  it("ignores the override in packaged builds (env must not move prod userData)", () => {
    // 与 LAWMIND_SKIP_API_AUTH 同姿态：测试可隔离，生产不可被环境变量改状态。
    expect(
      resolveDevUserDataDir({ ...base, override: "/tmp/lm-e2e-userdata", packaged: true }),
    ).toBeNull();
    expect(resolveDevUserDataDir({ ...base, packaged: true })).toBeNull();
  });
});
