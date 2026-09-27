# LawMind Skill 签名与密钥

> **状态**：已落地。代码在 `src/lawmind/skills/skill-runtime.ts`，签名 CLI 是 `pnpm lawmind:skills:sign`。
> **用途**：回答「`.signing-secret` 是什么」「为什么要轮换」「换了密钥之后我该跑什么」。

## 1. 它保护什么

产品路径**不读**工作区里的 `SKILL.md`。作业标准正文来自安装包内的 `src/lawmind/skills/builtin/*.md`（`readSkillPromptBodies` / `read_skill` / 工具披露都走这份）。往工作区丢一份签过名的技能，不会改模型行为，也不会多出一个工具。

本地服务启动不再把内置正文抄到工作区。`<工作区>/lawmind/skills/<id>/` 里若还有旧副本，`listLocalSkills` 和 `enabled.json` 只描述它们；回合不读。

`SKILL.sig` = `HMAC-SHA256(SKILL.md 正文, 签名密钥)`，校验点仍是 `verifySkillSignature`。签名失败只会让 `listLocalSkills` 把该副本标成未启用，**不会**关掉对应的内置作业标准。

## 2. 三种密钥来源（`resolveSkillSigningSecretSource`）

| 来源      | 取法                                         | 是不是秘密                                                                       |
| --------- | -------------------------------------------- | -------------------------------------------------------------------------------- |
| `env`     | `LAWMIND_SKILL_SIGNING_SECRET`               | **是**，生产必须走这条；密钥放工作区之外（如 `<userData>/LawMind/.env.lawmind`） |
| `file`    | `<workspace>/lawmind/skills/.signing-secret` | 是，但落在**工作区内**（agent 可写区），只作单机便利档；该文件永不入库           |
| `derived` | `sha256("lawmind-skill:" + 工作区路径)[:32]` | **不是**。算法公开、路径通常可知 ⇒ 任何人都能算出并伪造签名                      |

`derived` 只是让「刚装好、什么都没有」的开发环境别直接崩。**它不构成信任锚**；
`pnpm lawmind:skills:sign` 默认拒绝用它签名，除非显式 `--allow-derived`。

> 打包版的建议方向（尚未落地）：缺 `LAWMIND_SKILL_SIGNING_SECRET` 时 fail-closed，
> 即拒绝加载 workspace Skill 而不是退到 `derived`。参照 `LAWMIND_SKIP_API_AUTH`
> 在 packaged 被忽略的做法。

## 3. 轮换 runbook

```bash
# 1) 生成新密钥并放到工作区之外（0600）
node -e 'console.log(require("crypto").randomBytes(32).toString("base64url"))'
#    追加到 <userData>/LawMind/.env.lawmind：
#    LAWMIND_SKILL_SIGNING_SECRET=<新值>

# 2) 移除工作区内的旧密钥文件（若存在），并确认它不在 git 索引里
git rm --cached workspace/lawmind/skills/.signing-secret   # 仅在它被跟踪时

# 3) 重签：先看，再写
pnpm lawmind:skills:sign -- --workspace "<现场工作区>" --check
pnpm lawmind:skills:sign -- --workspace "<现场工作区>"

# 4) 重启桌面端，使 server 进程读到新的 .env.lawmind
```

判定「签成功了」：`--check` 输出「不通过 0」；随后桌面端 Skill 列表里 `signatureOk` 全为真。

## 4. 顺序约束（硬约束，别改回去）

`apps/lawmind-desktop/server/lawmind-local-server.ts` 的启动顺序是**签名的前提**：

```
bootstrapLawMindDesktopEnv(...)      ← 先把 .env.lawmind 灌进 process.env
  ↓
resolveSkillSigningSecretSource(...) ← 此刻解析出的才是真密钥
  ↓
ensureBuiltinSkillSeeds(dir, { secret })  ← 显式传入，别让它自己猜
```

反例（2026-09-20）：播种跑在环境变量加载之前，副本用 `derived` 签名，`listLocalSkills` 用 env 密钥验签，副本全部显示签名失败。当时回合还读工作区副本，所以作业标准会静默消失。现在回合只读 builtin，同样的顺序错误只让副本列表签不上，不再关掉交办。

密钥仍由调用方显式传入。`ensure-builtin-skill-seeds.test.ts` 盯住「签下去的就是传进来的那个」。

## 5. 已知历史

2026-09-20 之前，仓库里跟踪过一份**写死的字面量**密钥
（`workspace/lawmind/skills/.signing-secret`，2026-07-21 随 `82d3e6c76` 入库）。
仓库是公开的，所以那把密钥等同于公开；`cn-contract-checklist` 的
`SKILL.sig` 也正是用它签的，同样可被伪造。处置：

- 该文件已从索引移除（`git rm --cached`）并写进 `.gitignore`（`**/.signing-secret`）；
- `cn-contract-checklist/SKILL.sig` 一并停止跟踪（由每个安装用自己的密钥签）；
- 按 §3 轮换；**不重写 git 历史**（仓库已公开且已多人 clone），在发布说明里记一笔；
- 另有一条独立的设计弱点同批修掉：现场工作区此前根本没有 `.signing-secret`，
  35 个内置 Skill 的签名全部落在 `derived` 兜底值上 ⇒ 闸门本来就没锁。
