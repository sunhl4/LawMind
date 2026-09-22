import { describe, expect, it } from "vitest";
import {
  effectiveTier,
  isLawyerEscalationAvailable,
  machineVerdictsAffectOutcome,
  resolveDisabledVerifiers,
  resolveEscalationPosture,
  resolveJudgmentTieringMode,
  resolveLawyerEscalationPosture,
  shouldRunMachineStage,
} from "./judgment-tiering.js";

const NO_DISABLED = new Set<string>();

describe("G0 判据分级门控：解析顺序与缺省", () => {
  it("缺省为 shadow（零行为影响，所以默认开不构成风险）", () => {
    expect(resolveJudgmentTieringMode({ env: {} })).toBe("shadow");
  });

  it("policy 显式优先于 env", () => {
    expect(
      resolveJudgmentTieringMode({
        policy: { judgmentTiering: "on" },
        env: { LAWMIND_JUDGMENT_TIERING: "off" },
      }),
    ).toBe("on");
  });

  it("env 显式生效", () => {
    expect(resolveJudgmentTieringMode({ env: { LAWMIND_JUDGMENT_TIERING: "on" } })).toBe("on");
    expect(resolveJudgmentTieringMode({ env: { LAWMIND_JUDGMENT_TIERING: "off" } })).toBe("off");
  });

  it("未知取值按缺省处理（不把写错的配置当硬墙或免检）", () => {
    expect(resolveJudgmentTieringMode({ env: { LAWMIND_JUDGMENT_TIERING: "yes-please" } })).toBe(
      "shadow",
    );
    expect(resolveJudgmentTieringMode({ policy: { judgmentTiering: 123 }, env: {} })).toBe(
      "shadow",
    );
  });

  it("只有 on 时 machine 结论参与 verdict", () => {
    expect(machineVerdictsAffectOutcome("on")).toBe(true);
    expect(machineVerdictsAffectOutcome("shadow")).toBe(false);
    expect(machineVerdictsAffectOutcome("off")).toBe(false);
  });

  it("off 不跑 machine 段；shadow 与 on 都跑", () => {
    expect(shouldRunMachineStage("off")).toBe(false);
    expect(shouldRunMachineStage("shadow")).toBe(true);
    expect(shouldRunMachineStage("on")).toBe(true);
  });
});

describe("G0 effectiveTier：降级只能朝更严方向", () => {
  it("非 machine 项不受 mode 影响", () => {
    expect(effectiveTier({ declared: "judge", mode: "on", disabledVerifiers: NO_DISABLED })).toBe(
      "judge",
    );
    expect(effectiveTier({ declared: "lawyer", mode: "on", disabledVerifiers: NO_DISABLED })).toBe(
      "lawyer",
    );
  });

  it("off → 全部按 judge 走（不是回退到模型下 verdict）", () => {
    expect(
      effectiveTier({
        declared: "machine",
        verifier: "citations.subset",
        mode: "off",
        disabledVerifiers: NO_DISABLED,
      }),
    ).toBe("judge");
  });

  it("on + 验证器可用 → machine", () => {
    expect(
      effectiveTier({
        declared: "machine",
        verifier: "citations.subset",
        mode: "on",
        disabledVerifiers: NO_DISABLED,
      }),
    ).toBe("machine");
  });

  it("on + 验证器被停用 → **降回 judge**（不是失效放行）", () => {
    expect(
      effectiveTier({
        declared: "machine",
        verifier: "citations.subset",
        mode: "on",
        disabledVerifiers: new Set(["citations.subset"]),
      }),
    ).toBe("judge");
  });

  it("on + 缺 verifier → 降回 judge", () => {
    expect(effectiveTier({ declared: "machine", mode: "on", disabledVerifiers: NO_DISABLED })).toBe(
      "judge",
    );
  });
});

describe("G0 自动回滚开关：停用验证器", () => {
  it("返回的是**已注册**的验证器 id，未知 id 静默忽略（无害：它本就没跑）", () => {
    const disabled = resolveDisabledVerifiers({
      env: { LAWMIND_JUDGMENT_DISABLED_VERIFIERS: "citations.subset,not.real" },
    });
    expect([...disabled]).toEqual(["citations.subset"]);
  });

  it("支持 policy 数组形式，并与 env 合并", () => {
    const disabled = resolveDisabledVerifiers({
      policy: { judgmentDisabledVerifiers: ["citations.used"] },
      env: { LAWMIND_JUDGMENT_DISABLED_VERIFIERS: "citations.subset" },
    });
    expect([...disabled].toSorted()).toEqual(["citations.subset", "citations.used"]);
  });

  it("空值 / 非字符串元素不产生停用项", () => {
    expect([
      ...resolveDisabledVerifiers({
        policy: { judgmentDisabledVerifiers: [1, null, ""] },
        env: {},
      }),
    ]).toEqual([]);
  });
});

describe("G3 升级通道开关：默认关，且与 edition 解耦", () => {
  it("缺省一律 off（通道开不开是判据分级成熟度问题，不是版本差异）", () => {
    expect(resolveLawyerEscalationPosture({ env: {} })).toBe("off");
    expect(isLawyerEscalationAvailable({ env: {} })).toBe(false);
    // 三个 edition 的缺省都是 off —— 判定主体必须跨 edition 一致，
    // 否则战绩序列不是同一个东西。
    for (const edition of ["solo", "firm", "private_deploy"]) {
      expect(
        resolveLawyerEscalationPosture({ policy: { edition }, env: {} }),
        `${edition} 缺省应为 off`,
      ).toBe("off");
    }
  });

  it("policy 显式优先于 env", () => {
    expect(
      resolveLawyerEscalationPosture({
        policy: { judgmentEscalation: "off" },
        env: { LAWMIND_JUDGMENT_ESCALATION: "on" },
      }),
    ).toBe("off");
  });

  it("env 显式生效", () => {
    expect(resolveLawyerEscalationPosture({ env: { LAWMIND_JUDGMENT_ESCALATION: "on" } })).toBe(
      "on",
    );
    expect(isLawyerEscalationAvailable({ env: { LAWMIND_JUDGMENT_ESCALATION: "on" } })).toBe(true);
  });

  it("未知取值按 off（不把写错的配置当成已开启）", () => {
    expect(
      resolveLawyerEscalationPosture({ policy: { judgmentEscalation: "maybe" }, env: {} }),
    ).toBe("off");
  });
});

describe("G3 升级卡姿态：三 edition 分档", () => {
  it("solo → advisory（单人执业，打断成本高，先让他看见）", () => {
    expect(resolveEscalationPosture({ policy: { edition: "solo" }, env: {} })).toBe("advisory");
  });

  it("firm / private_deploy → block（口径不一致必须确认）", () => {
    expect(resolveEscalationPosture({ policy: { edition: "firm" }, env: {} })).toBe("block");
    expect(resolveEscalationPosture({ policy: { edition: "private_deploy" }, env: {} })).toBe(
      "block",
    );
  });

  it("缺省 edition（solo）→ advisory", () => {
    expect(resolveEscalationPosture({ env: {} })).toBe("advisory");
  });

  it("policy 显式覆盖 edition 缺省", () => {
    expect(
      resolveEscalationPosture({
        policy: { edition: "firm", judgmentEscalationPosture: "advisory" },
        env: {},
      }),
    ).toBe("advisory");
  });

  it("env 显式在 policy 之后生效", () => {
    expect(
      resolveEscalationPosture({
        policy: { edition: "solo" },
        env: { LAWMIND_JUDGMENT_ESCALATION_POSTURE: "block" },
      }),
    ).toBe("block");
  });

  it("**未知取值按 edition 缺省**（不把写错的配置当硬墙或免检）", () => {
    // firm 缺省是 block；写错的值不得把它降成 advisory。
    expect(
      resolveEscalationPosture({
        policy: { edition: "firm", judgmentEscalationPosture: "blocc" },
        env: {},
      }),
    ).toBe("block");
    // solo 缺省是 advisory；写错的值不得把它升成 block。
    expect(
      resolveEscalationPosture({
        policy: { edition: "solo", judgmentEscalationPosture: "hard" },
        env: {},
      }),
    ).toBe("advisory");
  });
});
