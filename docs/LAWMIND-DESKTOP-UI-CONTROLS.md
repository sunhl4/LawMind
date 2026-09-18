# LawMind Desktop — 滚动条与表单控件约定

面向 `apps/lawmind-desktop` 渲染层。新增或改滚动容器、输入框时**必须**遵守本文；改观感应改 token，而不是在业务 CSS 里再写一套颜色。

相关：`apps/lawmind-desktop/src/renderer/styles/tokens.css`、`styles/controls.css`、`styles/README.md`。

---

## 1) 滚动条（唯一一套）

### Token

| Token                  | 用途                        |
| ---------------------- | --------------------------- |
| `--scroll-size`        | 轨道宽度/高度（默认 `8px`） |
| `--scroll-track`       | 轨道底色（默认透明）        |
| `--scroll-thumb`       | 滑块                        |
| `--scroll-thumb-hover` | 悬停滑块                    |

亮/暗主题在 `tokens.css` 的 `:root` / `html.lm-theme-dark` 里成对定义。

### 用法

1. **优先**给可滚动容器加 class：`lm-scroll`（定义在 `controls.css`）。
2. 已登记的滚动宿主（材料树、对话列表、设置页、消息区等）在 `controls.css` 里统一挂了同一套规则；**不要**再写 `::-webkit-scrollbar { width: … }` 或硬编码 `rgba(...)`。
3. 新滚动区：布局用 `overflow-y: auto` + `min-height: 0`，外观只加 `lm-scroll`（或把选择器补进 `controls.css` 那一组）。

### 禁止

- 默认系统粗白滚动条（未套 `lm-scroll` / 未登记宿主时常出现）。
- 各模块私自定义不同宽度或不同色的 thumb。
- 用 `scrollbar-width: none` 隐藏滚动条，除非产品明确要求（如横向 tab 条）。

---

## 2) 文字输入（唯一一套）

目标：**暖色浅底 + 柔边框 + 圆角**，禁止「纯白底 + 硬黑框」玩具感。

### Token

| Token                                         | 用途                            |
| --------------------------------------------- | ------------------------------- |
| `--control-bg`                                | 默认底（`surface-2`，不是纯白） |
| `--control-bg-hover`                          | 悬停底                          |
| `--control-border`                            | 边框（`border-md`）             |
| `--control-radius`                            | 圆角（`--r`）                   |
| `--control-padding-y` / `--control-padding-x` | 内边距                          |
| `--control-shadow`                            | 轻微内高光                      |
| `--input-bg`                                  | 别名 → `--control-bg`           |

焦点：`border-color: var(--accent-border)` + `box-shadow: var(--focus-ring)`。

### 用法

1. 业务表单控件使用 **`className="lm-input"`**（`input` / `textarea` / `select`）。
2. 向导/设置里的 `.lm-field input|textarea|select` 已对齐同一套。
3. 卷宗网格 `.lm-lawyer-docket-grid` 内控件已强制同一套。
4. 忘记加 class 时，`.lm-shell` 下的原生 `input/textarea/select` 有软兜底（排除 checkbox/radio/file、Monaco/CodeMirror、文书编辑器正文）。

### 禁止

- `background: #fff` / `background: white` + `border: 1px solid #000`（或高对比硬框）。
- `border-radius: 0` 的文本框（表格单元格内嵌除外且须注释原因）。
- 为单个页面另起一套「白底黑框」输入皮肤。

### 例外

- 文书全文编辑器 / Monaco / CodeMirror：保持编辑器自身主题。
- `type="checkbox|radio|file|range|color"`：系统控件，不套文本框皮肤。

---

## 3) 本案卷宗 / 概览（版面优先级）

律师点开案件后，**正文区（概览与各子页）应占视口大头**；页眉 KPI 只做一行摘要，不要做成大卡片墙。

| 层级                   | 规则                                                                                     |
| ---------------------- | ---------------------------------------------------------------------------------------- |
| Hero                   | 案名 + 一行元数据 + 右上动作；紧凑，不堆第二段说明                                       |
| KPI（`.lm-pulse-bar`） | **单行条**：标签与数字横排；禁止在窄窗变成 2×2 大卡                                      |
| Tab 正文               | `flex: 1` + `lm-scroll`；列表用柔底（`--control-bg` / wash），**禁止**白底硬框（玩具感） |
| 「本案下一步」         | 全宽优先；左色条条目，不用独立白卡片边框                                                 |
| 对话页                 | 本约定不改对话布局；改工作台时勿顺手动 `.lm-messages` / 侧栏会话                         |

子页（文书、材料、期限…）复用同一套 `.lm-lawyer-deadline-row` 柔底，不要再画一套边框卡。

---

## 4) 改观感应怎么做

1. 只改 `tokens.css` 里的 `--scroll-*` / `--control-*`（及暗色对应项）。
2. 跑：`pnpm exec vitest run apps/lawmind-desktop/src/renderer/styles/tokens.test.ts`
3. 桌面热更新后目视：侧栏滚动条、卷宗表单、设置搜索框应同时变。

---

## 5) 检查清单（PR）

- [ ] 新滚动容器是否有 `lm-scroll` 或已登记到 `controls.css`？
- [ ] 新输入是否使用 `lm-input` / `.lm-field`，且未硬编码白底黑框？
- [ ] 未新增第二套 `::-webkit-scrollbar` 颜色？
- [ ] 本案概览是否仍是「KPI 一行 + 正文占满」，而非大卡挤占？
- [ ] 未改动对话页布局？
