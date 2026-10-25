# macOS 签名与公证（内测分发）

面向：要把 LawMind 发给**别人**（律师、内测用户、客户 IT）在 Mac 上双击就能装的场景。

**不需要**上架 App Store，**不需要** TestFlight。内测走的是 **Developer ID Application 签名 + Apple 公证（notarization）+ staple**。

本文只讲操作。代码侧（谁签、谁公证、环境变量怎么读）见 [docs/lawmind/manual/67-port-credentials-packaging-implementation.md](../../docs/lawmind/manual/67-port-credentials-packaging-implementation.md)。

## 0. 为什么必须做

浏览器/网盘下载的 `.app` 带 `com.apple.quarantine` 标记。只做了 adhoc 签名的包会被 Gatekeeper 拦下：

> "LawMind" 已损坏，无法打开。你应该将它移到废纸篓。

用户能靠「右键 → 打开」绕过，但有两件事绕不过去：

1. **自动更新会失败**。`electron-updater` 在 macOS 上走 Squirrel.Mac，它要求 app 有有效签名；adhoc 包每次都要用户手动重装。
2. **首启信任成本高**。要律师在「隐私与安全性」里点「仍要打开」，对法律工作台来说是坏的信号。

判断当前包是什么状态：

```bash
codesign -dv --verbose=2 apps/lawmind-desktop/release/mac-arm64/LawMind.app 2>&1 | grep -E 'Signature|TeamIdentifier'
# adhoc 包：Signature=adhoc / TeamIdentifier=not set
# 正式包：Signature size=... / TeamIdentifier=XXXXXXXXXX
```

## 1. 一次性准备

### 1.1 加入 Apple Developer Program

| 账号类型 | 适合 | 需要的材料 | 审核 |
| --- | --- | --- | --- |
| Individual（个人） | 先跑内测，不强调公司主体 | Apple ID + 双重认证 + 信用卡 | 约 24–48 小时 |
| Organization（组织，推荐对外） | 以公司名义分发 | **D-U-N-S 编号**、法定实体信息、可验证的公司电话/网站 | 约 1–2 周 |

- 报名：<https://developer.apple.com/programs/enroll/>，或 iPhone 上的 **Apple Developer** App（个人账号在 App 里最快）。
- 组织账号先在 <https://developer.apple.com/DUNS/> 免费查/申请 D-U-N-S。公司名称必须与营业执照一致，否则会被打回重来。
- 成功后到 <https://developer.apple.com/account> → **Membership details** 抄下 **Team ID**（10 位，公证要用）。
- **不要**买 Developer Enterprise Program（$299/年）：它只允许发给本单位员工，不能给外部客户。

### 1.2 生成签名证书（只要一张 Developer ID Application）

在**要打包的那台 Mac** 上：

1. 钥匙串访问 → 证书助理 → **从证书颁发机构请求证书** → 「存储到磁盘」→ 得到 `CertificateSigningRequest.certSigningRequest`。
2. <https://developer.apple.com/account/resources/certificates/list> → **+** → **Developer ID Application** → 上传 CSR → 下载 `.cer`。
3. 双击 `.cer`，装进「登录」钥匙串。
4. 验证（必须看到一行 Developer ID）：

```bash
security find-identity -v -p codesigning
# 1) ABCD...  "Developer ID Application: Your Company (TEAMID1234)"
```

5. **给 CI 用**：钥匙串访问里右键该证书 → 导出 `.p12`（设一个强密码）→ base64：

```bash
base64 -i developer-id.p12 | pbcopy   # 这就是 MAC_CSC_LINK
```

> 只有将来做 `.pkg` 安装包才需要 `Developer ID Installer`；dmg / zip 分发只需要上面这张。

### 1.3 公证凭据（三选一，代码三种都支持）

| 方式 | 环境变量 | 适合 |
| --- | --- | --- |
| ① 钥匙串 profile | `APPLE_KEYCHAIN_PROFILE`（可选 `APPLE_KEYCHAIN`） | 本机打包最省事 |
| ② App Store Connect API Key | `APPLE_API_KEY`（.p8 路径）+ `APPLE_API_KEY_ID` + `APPLE_API_ISSUER` | CI 首选，不会像专用密码那样失效 |
| ③ Apple ID + App 专用密码 | `APPLE_ID` + `APPLE_APP_SPECIFIC_PASSWORD` + `APPLE_TEAM_ID` | 最直观，配置最少 |

③ 的专用密码：<https://appleid.apple.com> → 登录与安全 → **App 专用密码** → 生成，形如 `abcd-efgh-ijkl-mnop`（**不是**你的 Apple ID 登录密码）。

① 的本机初始化：

```bash
xcrun notarytool store-credentials lawmind-notary \
  --apple-id "you@example.com" \
  --team-id "TEAMID1234" \
  --password "abcd-efgh-ijkl-mnop"
export APPLE_KEYCHAIN_PROFILE=lawmind-notary
```

这些值**只放环境变量 / GitHub Secrets，绝不写进仓库**。

### 1.4 GitHub Actions Secrets

仓库 → **Settings → Secrets and variables → Actions → New repository secret**：

| Secret | 内容 | 必需 |
| --- | --- | --- |
| `MAC_CSC_LINK` | `base64` 后的 `.p12` | mac 签名必需 |
| `MAC_CSC_KEY_PASSWORD` | 导出 `.p12` 时设的密码 | mac 签名必需 |
| `APPLE_ID` | Apple ID 邮箱 | 公证（方式③） |
| `APPLE_APP_SPECIFIC_PASSWORD` | App 专用密码 | 公证（方式③） |
| `APPLE_TEAM_ID` | Membership 里的 Team ID | 公证（方式③） |
| `WIN_CSC_LINK` / `WIN_CSC_KEY_PASSWORD` | Windows Authenticode 证书 | 仅 Windows 分发 |

> `MAC_CSC_LINK` 为空时，CI 会打 adhoc 包**并且照样发布**——这正是需要盯的地方。发版前确认 secrets 已配，或本地构建时设 `LAWMIND_REQUIRE_NOTARIZED=1` 强制失败。

## 2. 本机打一个「下载就能双击」的包

仓库已经把签名与公证接进 `electron-builder` 的两个钩子（`afterPack` / `afterAllArtifactBuild`），不需要手写 `codesign`。

### 2.1 只打当前架构（最快验证链路）

```bash
cd <repo-root>

export CSC_NAME="Developer ID Application: Your Company (TEAMID1234)"
export APPLE_KEYCHAIN_PROFILE=lawmind-notary        # 或 1.3 里的方式②/③
export LAWMIND_REQUIRE_NOTARIZED=1                  # 缺证书/缺凭据直接失败，不发 adhoc 包

pnpm lawmind:desktop:dist
```

### 2.2 同时出 arm64 + x64（Intel Mac 用）

```bash
pnpm lawmind:desktop:dist:mac:both
```

它做的事与单架构相同，只是**先给两个架构各 vendor 一份内嵌运行时**，再**用一次** `electron-builder --arm64 --x64` 同时出包：

| 步骤 | 产物 |
| --- | --- |
| esbuild 打本地 API | `apps/lawmind-desktop/server/dist/lawmind-local-server.cjs` |
| vendor Node 运行时（两个架构） | `resources/node-runtime/darwin-arm64`、`darwin-x64` |
| vendor OfficeCLI（两个架构） | `resources/officecli/darwin-arm64`、`darwin-x64` |
| Vite 打渲染层 | `apps/lawmind-desktop/dist/` |
| preflight 断言 | 每个目标架构的 node / officecli 都在，且 Mach-O 头架构匹配 |
| `electron-builder --arm64 --x64` | `release/mac-arm64/LawMind.app`、`release/mac/LawMind.app`（x64 的 appOutDir 就叫 `mac`）、两个 dmg（文件名才是 `-mac-x64`）、两个 zip、**一个** `latest-mac.yml` |
| `afterPack` | 用同一身份逐个签内嵌 `node` 与 `officecli`（漏签会被公证直接拒） |
| `afterAllArtifactBuild` | 逐个 `.app` 校验 Developer ID → `notarytool submit --wait` → `stapler staple`（只对 `.dmg`，见下） |

几个必须知道的行为：

- **`.zip` 只公证、不 staple**。`stapler` 只支持 `.app` / `.dmg` / `.pkg`，对 zip 会以 66 退出（`Stapler is incapable of working with ZIP archive files`）。票据只是离线加速，联网首启 Gatekeeper 仍按 CDHash 在线校验。代码按扩展名分流，并在日志里写 `notarized but not stapled: ...zip`。
- **每个架构的 `.app` 只带自己的运行时**。`extraResources` 用了 `${platform}-${arch}` 宏，Intel 包里不会混进 arm64 的 node。**不要用 `--universal`**：内嵌的 node / officecli 是架构特定的二进制，universal 合并时两套运行时会同名冲突；正确做法就是两份独立包（本节的 `dist:electron:mac:both`）。
- **交叉架构不执行目标二进制**。Apple 芯片上打 x64 时，`node --version` / `officecli --version` 要 Rosetta；脚本改为用官方 tarball 里的 `include/node/node_version.h` 与 `VERSION` 哨兵断言版本，所以在没有 Rosetta 的 CI arm64 runner 上也能跑。
- **preflight 是硬失败**。`electron-builder` 在 `extraResources` 的 `from` 不存在时只 warn 然后照样出包，会得到「能装能开、但本地 API 起不来」的安装包；`scripts/assert-vendored-runtimes.mjs` 把这种情况提前挡掉。
- **交叉 vendoring 要能下载两套二进制**。打 Intel 包必须能拿到 `officecli-mac-x64`（约 34.7MB）；网络受限时先按 §6 的对应条目处理，否则 preflight 会直接拒绝打包（这是**有意**设计：宁可不产包，也不发一个 Word 改稿用不了的包）。

如果只想验证结构不想出 dmg（快很多）：

```bash
cd apps/lawmind-desktop
node scripts/assert-vendored-runtimes.mjs --arch arm64,x64
pnpm exec electron-builder --dir --arm64 --x64
```

## 3. 发出去之前：四道闸

```bash
APP=apps/lawmind-desktop/release/mac-arm64/LawMind.app

# ① 签名身份 + 硬化运行时
codesign -dv --verbose=4 --entitlements - "$APP" 2>&1 | grep -E 'Authority|TeamIdentifier|flags|options'
#   期望：Authority=Developer ID Application: ...
#         TeamIdentifier=TEAMID1234
#         flags=0x10000(runtime)

# ② 签名完整性（深签，含内嵌 node/officecli）
codesign --verify --deep --strict --verbose=2 "$APP"

# ③ Gatekeeper 预判（最关键）
spctl -a -vvv -t install "$APP"
#   期望：accepted / source=Notarized Developer ID

# ④ 公证票据已订上
xcrun stapler validate apps/lawmind-desktop/release/LawMind-0.2.2-mac-arm64.dmg
#   期望：The validate action worked!

# ⑤ 双架构时两个包都要过
#    注意 x64 的 appOutDir 是 `mac`（electron-builder 只给非 x64 加后缀）
for dir in mac-arm64 mac; do
  codesign --verify --deep --strict "apps/lawmind-desktop/release/$dir/LawMind.app" && \
  spctl -a -vvv -t install "apps/lawmind-desktop/release/$dir/LawMind.app"
done
```

### 必须在「干净」环境测一遍

从 `release/` 直接拖进「应用程序」是**测不出问题**的：本机构建的 app 没有 quarantine 位，永远不会被拦。要：

1. 换一台干净 Mac / 新建一个 macOS 用户 / 干净虚拟机；
2. 用**浏览器或网盘**下载 dmg；
3. 拖进「应用程序」→ **双击**（不是右键）→ 应直接进向导，填 API Key 后能发一条对话；
4. 想确认 quarantine 确实存在：`xattr -l /Applications/LawMind.app` 应能看到 `com.apple.quarantine`。

Intel 包要在 Intel Mac（或 Rosetta 环境）上同样跑一遍。

## 4. CI 发版流程

`.github/workflows/lawmind-desktop-build.yml`：

- `workflow_dispatch` 手动触发，或推 tag `lawmind-desktop-v*`。
- **mac 一次出双架构**（`dist:electron:mac:both`），随后 `Verify packaged mac architectures` 步骤用 `lipo -archs` 断言 `mac-arm64` 是 arm64、`mac` 是 x86_64，并检查两个包里各自的 `node-runtime/darwin-*` 存在、且没有混入另一架构的运行时。
- 只有 tag 构建且 `MAC_CSC_LINK` 非空时，才把 `LAWMIND_REQUIRE_NOTARIZED=1` 传给构建。
- `release` job 在缺 `latest*.yml` 时**拒绝发布**（客户端自动更新靠它）。

发版：

```bash
# 1) 改版本号
#    apps/lawmind-desktop/package.json -> version
# 2) 打 tag 并推
git tag lawmind-desktop-v0.2.3
git push origin lawmind-desktop-v0.2.3
```

Release 里应出现：`LawMind-<ver>-mac-arm64.dmg` / `.zip`、`LawMind-<ver>-mac-x64.dmg` / `.zip`、`latest-mac.yml`、对应的 `.blockmap`，以及 Windows / Linux 产物。**这些必须留在同一个 Release**，否则客户端只能手动下载升级。

## 5. 用户侧步骤（可直接发到内测群里）

**已签名 + 已公证的包：**

1. 先看「关于本机 → 芯片」：Apple 芯片（M1/M2/M3/M4）下 `mac-arm64` 包；Intel 下 `mac-x64` 包。
2. 下载对应的 `.dmg`。
3. 双击打开 → 把 `LawMind` 拖进「应用程序」。
4. 打开「应用程序」→ 双击 `LawMind`。
5. 首次可能提示「已确认开发者」，点「打开」即可（这是正常提示，不是报错）。
6. 按向导填大模型 API Key → 开始使用。

**如果拿到的是未公证的测试包（兜底）：**

- 右键 `LawMind.app` → **打开** → 再点「打开」；或
- 系统设置 → 隐私与安全性 → 底部「仍要打开」；或
- 终端：`xattr -dr com.apple.quarantine /Applications/LawMind.app`

## 6. 故障排查

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| 构建报 `LAWMIND_REQUIRE_NOTARIZED=1 but these LawMind.app builds are not signed with Developer ID Application: mac-arm64, mac` | 某一个架构没签上（常见：`CSC_NAME` 拼错、证书只导入了私钥缺证书链） | `security find-identity -v -p codesigning` 确认证书；重导 `.p12`（含证书 + 私钥 + Apple WWDR 中间证书） |
| `LAWMIND_REQUIRE_NOTARIZED=1 but Apple notary credentials are not set` | 三种凭据一个都没配 | 按 1.3 配一组 |
| notarytool 返回 `Invalid` 且日志含 `The binary is not signed` | 内嵌二进制漏签（新增内嵌工具没加进 `listBundledHelperBinaries`） | 在 `mac-gatekeeper.mjs` 里补上扫描路径，重新打包 |
| notarytool 日志含 `The signature does not include a secure timestamp` | 用了 `--timestamp` 之外的路径签，或 adhoc 残留 | 确保用 Developer ID 签名（adhoc 不产时间戳） |
| `stapler` 报 `Stapler is incapable of working with ZIP archive files` | 对 `.zip` 调了 staple | 已修：只对 `.dmg` 装订；这是预期日志 `notarized but not stapled: ...zip` |
| `stapler validate` 报 `CloudKit query ... Record not found` / Error 65 | 该文件**没有**公证票据（未公证，或公证还没成功） | 先看 notarytool 提交结果，再 staple |
| 用户双击提示「已损坏」 | 未公证，或公证失败后仍发布了 | 检查 `spctl -a -vvv -t install` 输出；未通过不得发版 |
| Intel 用户打不开 / 闪退 | 只出了 arm64 包，或 x64 包里混进 arm64 运行时 | 用 `dist:electron:mac:both`；CI 的 `Verify packaged mac architectures` 会拦住 |
| 自动更新下载后不安装 | 包未签名，或 Release 缺 `latest-mac.yml` | 配齐签名；确认 yml 与二进制在同一 Release |
| `pnpm vendor:officecli --arch x64` 报 `Download stalled` / `Timeout downloading`，只有 arm64 那份在 | 到 `d.officecli.ai` 与 GitHub Release 的网络不通或极慢（资产本身存在，`Content-Length` 约 34.7MB）。实测过一次镜像 + 官方源都只有 ~75KB/s，断点续传 16 分钟仅拿到 32KB | 换网络/代理（或手机热点）后重跑；也可在能下载的机器上取到二进制后**手动**放到 `resources/officecli/darwin-x64/officecli`（`chmod +x`），再跑 `node scripts/assert-vendored-runtimes.mjs --arch arm64,x64` 自查架构。**不要**用 `--bin` 跨架构复制（会直接报错） |
| 打包日志出现 `file source doesn't exist from=.../resources/officecli/darwin-x64` 但构建仍继续 | electron-builder 对缺失的 `extraResources` 源目录只 warn | 正常流程会被 `assert-vendored-runtimes.mjs` 提前拦下；若见到这行说明绕过了 preflight（例如直接调 `electron-builder`），产出的包会缺 officecli |

查公证日志：

```bash
xcrun notarytool log <submission-id> \
  --apple-id "you@example.com" --team-id "TEAMID1234" \
  --password "abcd-efgh-ijkl-mnop"
```

`<submission-id>` 在 `afterAllArtifactBuild` 的 notarytool 输出里，或 `xcrun notarytool history` 里查。
