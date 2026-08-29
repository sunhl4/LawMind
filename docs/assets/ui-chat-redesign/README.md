# 对话页 UI 对照（参考稿）

> **产品决策（2026-07-20）**：不按本目录「改架构」落地；保留现有对话页信息架构，仅做视觉美化（`styles/chat.css` 等）。  
> 下列脚本仍可用于对照示意，**不是**实施规格。

## 本地生成对照图（终端）

在仓库根目录：

```bash
# 需已 pnpm install；首次可能要装浏览器
pnpm --filter lawmind-desktop exec playwright install chromium

pnpm lawmind:ui:chat-mockups
# 等价：node scripts/lawmind/generate-ui-chat-redesign-mockups.mjs
```

也可只预览 HTML（不截图）：

```bash
open scripts/lawmind/ui-chat-redesign/before.html
open scripts/lawmind/ui-chat-redesign/after.html
```

输出：

| 文件 | 含义 |
|------|------|
| [01-before-current.png](./01-before-current.png) | 改前示意 |
| [02-after-target.png](./02-after-target.png) | 改后目标 |
| [00-compare.png](./00-compare.png) | 左右对照 |
| [00-compare.html](./00-compare.html) | 浏览器打开对照 |

源模板：`scripts/lawmind/ui-chat-redesign/{before,after}.html`（可改文案/布局后重跑脚本）。

## 改后目标结构

| 区域 | 内容 |
|------|------|
| 顶栏 | 仅 **对话 / 在办** |
| 左侧 | **我的案件** → **对话记录** → 底部黄铜 **待我拍板** |
| 主区 | 干净消息流 + 输入区 |
| 禁止 | 待审 sticky、草稿条、侧栏再叠驾驶舱主导航 |

## 确认后只改对话页

侧栏结构、顶栏收束、输入区对齐。不动文书台/专案组整壳。

拍板回复：`对话页按改后做` 或 `改后要调整：…`。
