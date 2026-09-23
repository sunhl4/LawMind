#!/usr/bin/env python3
"""交叉引用审计：检查手册里「第 N.M 节」的引用。

## 三种检查与它们的可信度

| 检查 | 判据 | 可信度 |
| --- | --- | --- |
| ① 悬空 | 引用了不存在的小节号 | **硬错**，必须为 0 |
| ② 跨章 | 引用的章与自己所在的章不同 | **提示**，多为有意（实现章引用功能章） |
| ③ 熵差 | 引用句与目标标题没有任何中文 2-gram / 标识符重叠 | **提示**，误报率高 |

③ 只做「缩小人工复核范围」用，不要直接当错。实测它标出的 129 处里，绝大多数是对的
（算法抓不到同义表述，例如「编译器默认不问」与标题「边界：什么时候会问律师」）。

真正有效的是**人工抽查一批**：读被引用小节的标题，看它与引用句说的是不是同一件事。
本仓库 2026-09-23 那轮抽查修掉了 22 处语义错位——② ③ 都查不出来，因为小节号是存在的。

## 用法（在 docs/lawmind/manual/ 下）

    python3 check-crossrefs.py              # 汇总 + ③ 的清单
    python3 check-crossrefs.py --cross      # 附带 ② 的完整清单

## 注意

INDEX.md 被排除——它的编号（「一、」下的 2.3 这类）会与章节号撞车。
"""
import re
import glob
import sys

CH = r"(\d+)\.(\d+)"
HEAD = re.compile(r"^(#{2,4})\s+" + CH + r"(?:\.(\d+))?\s+(.+?)\s*$")
REF = re.compile(r"第\s*" + CH + r"\s*节")


def build_heads():
    """{小节号: (文件, 标题)}；只扫章节文件。"""
    heads = {}
    for f in sorted(glob.glob("*.md")):
        if f == "INDEX.md":
            continue
        for line in open(f, encoding="utf-8"):
            m = HEAD.match(line)
            if m:
                sec = f"{m.group(2)}.{m.group(3)}" + (f".{m.group(4)}" if m.group(4) else "")
                heads[sec] = (f, m.group(5))
    return heads


def toks(s):
    """中文取 2-gram，英文/标识符整体取。"""
    out = set(re.findall(r"[A-Za-z_][A-Za-z0-9_./-]{2,}", s))
    zh = "".join(re.findall(r"[\u4e00-\u9fff]", s))
    out |= {zh[i:i + 2] for i in range(len(zh) - 1)}
    return out


def main():
    show_cross = "--cross" in sys.argv
    heads = build_heads()
    dangling, cross_ch, entropy = [], [], []

    for f in sorted(glob.glob("*.md")):
        if f == "INDEX.md":
            continue
        own = re.match(r"^(\d+)", f)
        own_ch = own.group(1) if own else None
        for i, line in enumerate(open(f, encoding="utf-8"), 1):
            for m in REF.finditer(line):
                sec = f"{m.group(1)}.{m.group(2)}"
                if sec not in heads:
                    dangling.append((f, i, sec, line.strip()))
                    continue
                tgt_file, tgt_title = heads[sec]
                if own_ch and m.group(1) != own_ch and re.match(rf"^{m.group(1)}-", tgt_file):
                    cross_ch.append((f, i, sec, tgt_title, tgt_file))
                a, b = max(0, m.start() - 40), min(len(line), m.end() + 40)
                if not (toks(line[a:b]) & toks(tgt_title)):
                    entropy.append((f, i, sec, tgt_title, line.strip()[:100]))

    print(f"小节总数 {len(heads)}")
    print(f"① 悬空（硬错）  {len(dangling)}")
    print(f"② 跨章（提示）  {len(cross_ch)}")
    print(f"③ 熵差（提示）  {len(entropy)}")

    if dangling:
        print("\n── ① 悬空：必须修 ──")
        for f, i, sec, txt in dangling:
            print(f"  {f}:{i}  第{sec}节 ✗\n     {txt[:110]}")

    if show_cross and cross_ch:
        print("\n── ② 跨章：确认是有意引用 ──")
        for f, i, sec, title, tgt in cross_ch:
            print(f"  {f}:{i}  第{sec}节 → \"{title}\"（{tgt}）")

    if entropy:
        print("\n── ③ 熵差：逐条读目标标题，多数是对的 ──")
        for f, i, sec, title, txt in entropy:
            print(f"  {f}:{i}  第{sec}节 = \"{title}\"\n     …{txt}…")

    if not dangling:
        print("\n① 通过。② ③ 需人工判断；建议每次成批改章后抽查 10–20 条。")


if __name__ == "__main__":
    main()
