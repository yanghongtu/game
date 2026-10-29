# -*- coding: utf-8 -*-
"""截图**语义构图**核对：验证画面里该有的元素都在**正确的位置**。

比「颜色出现过」强得多 —— 一张全黑 + 一个红点的图也能通过颜色断言，
但显然不是合格的截图。本脚本按区域检查元素的**位置与数量**。

用法：python tools/shot_layout_check.py <克隆目录>
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from png_check import decode, hex2rgb  # noqa: E402


def near(px, ch, o, rgb, tol=14):
    return (abs(px[o] - rgb[0]) <= tol and abs(px[o + 1] - rgb[1]) <= tol
            and abs(px[o + 2] - rgb[2]) <= tol)


def region_hits(px, ch, w, box, rgb, tol=14):
    """统计指定矩形区域内命中目标色的像素数。"""
    x0, y0, x1, y1 = box
    n = 0
    for y in range(max(0, y0), min(720, y1)):
        row = y * w
        for x in range(max(0, x0), min(w, x1)):
            o = (row + x) * ch
            if near(px, ch, o, rgb, tol):
                n += 1
    return n


def main():
    root = sys.argv[1] if len(sys.argv) > 1 else "."
    # 截图目录：优先 <root>/docs/screenshots（仓库布局），
    # 否则把 <root> 当作截图目录本身（`make_screenshots.py --out DIR` 的产物）。
    _default = os.path.join(root, "docs", "screenshots")
    S = _default if os.path.isdir(_default) else root
    print("截图目录：%s" % S)
    ok_all = True

    def check(title, cond, detail):
        nonlocal ok_all
        ok_all = ok_all and cond
        print("  [%s] %-46s %s" % ("OK" if cond else "FAIL", title, detail))

    # —— ① gameplay：HUD 血蓝条在左上、敌人（绿/精英环）在画面中部、玩家在中心 ——
    print("== gameplay.png ==")
    w, h, ch, px = decode(os.path.join(S, "gameplay.png"))
    hp = region_hits(px, ch, w, (0, 0, 260, 120), hex2rgb("#e74c3c"))
    check("左上 HUD 血条为红", hp > 100, "%d 像素 @ (0,0)-(260,120)" % hp)
    mp = region_hits(px, ch, w, (0, 0, 260, 200), hex2rgb("#3498db"))
    check("左上 HUD 蓝条为蓝", mp > 100, "%d 像素 @ (0,0)-(260,200)" % mp)
    slime = region_hits(px, ch, w, (300, 150, 1000, 620), hex2rgb("#1e8449"))
    check("画面中部有史莱姆（描边绿）", slime > 50, "%d 像素 @ (300,150)-(1000,620)" % slime)
    elite = region_hits(px, ch, w, (300, 150, 1000, 620), hex2rgb("#f39c12"))
    check("画面中部有精英怪光环", elite > 5, "%d 像素 @ (300,150)-(1000,620)" % elite)
    # 玩家脚下是**半透明**金色光环 rgba(251,191,36,α)：按纯色匹配不到，
    # 改用「亮度显著高于地板」的亮金像素做判据（容差放宽到 40）。
    aura = region_hits(px, ch, w, (480, 260, 800, 520), hex2rgb("#fbbf24"), tol=40)
    check("玩家脚下有金色光环", aura > 30, "%d 像素 @ (480,260)-(800,520)" % aura)
    # 底部技能栏：5 个 50x50 槽位，槽位边框是**不透明**的 #555
    slots = region_hits(px, ch, w, (560, 645, 720, 705), hex2rgb("#555555"))
    check("底部技能栏有 5 个槽位边框", slots > 200, "%d 像素 @ (560,645)-(720,705)" % slots)

    # —— ② character：面板边框紫色环绕中央 760x520 区域 ——
    print("== character.png ==")
    w, h, ch, px = decode(os.path.join(S, "character.png"))
    panel = hex2rgb("#c39bd3")
    top = region_hits(px, ch, w, (250, 95, 1030, 110), panel)
    bot = region_hits(px, ch, w, (250, 605, 1030, 620), panel)
    check("面板上边框为紫", top > 200, "%d 像素 @ 上边" % top)
    check("面板下边框为紫", bot > 200, "%d 像素 @ 下边" % bot)
    left = region_hits(px, ch, w, (252, 100, 268, 615), panel)
    right = region_hits(px, ch, w, (1015, 100, 1031, 615), panel)
    check("面板左边框为紫", left > 100, "%d 像素 @ 左边" % left)
    check("面板右边框为紫", right > 100, "%d 像素 @ 右边" % right)
    inner = region_hits(px, ch, w, (270, 110, 1010, 600), hex2rgb("#2ecc71"))
    check("面板内有绿色属性值", inner > 20, "%d 像素 @ 面板内部" % inner)

    # —— ③ inventory：右下角背包面板（280px 宽，底部 10px，右侧 10px）——
    print("== inventory.png ==")
    w, h, ch, px = decode(os.path.join(S, "inventory.png"))
    bord = hex2rgb("#555555")
    ib = region_hits(px, ch, w, (985, 460, 1270, 710), bord)
    check("右下背包面板区域有边框色", ib > 500, "%d 像素 @ (985,460)-(1270,710)" % ib)
    # 背包面板：宽 280、右侧边距 10 ⇒ 竖线在 x≈988 与 x≈1267；
    # 上边框是一条横贯的灰线。面板高度随内容而变，**不能写死 y** ——
    # 故先在 400~560 区间内自动定位那条横线，再据此断言。
    best_y, best_n = -1, 0
    for y in range(400, 560):
        n = region_hits(px, ch, w, (992, y, 1264, y + 2), bord)
        if n > best_n:
            best_y, best_n = y, n
    check("背包面板上边框是一条水平线", best_n > 150,
          "%d 像素 @ y=%d" % (best_n, best_y))
    above = region_hits(px, ch, w, (992, best_y - 40, 1264, best_y - 38), bord)
    check("面板上方无同样长度的水平线", above < best_n / 2,
          "上方 %d vs 边框 %d 像素" % (above, best_n))

    print("\n=> %s" % ("全部通过" if ok_all else "存在失败项"))
    return 0 if ok_all else 1


if __name__ == "__main__":
    sys.exit(main())
