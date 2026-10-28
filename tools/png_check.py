# -*- coding: utf-8 -*-
"""PNG 像素断言工具（纯标准库，不依赖 Pillow）。

用途：headless 截图**必须做内容断言** —— 只看「文件存在 / 字节数」会漏掉
「驱动脚本没执行 → 三张图渲染出同一张菜单页」这类静默失败（本项目踩过）。
判据 = 指定颜色在图中**实际出现**，而不是「文件非空」。

用法：
  python market/png_check.py <png> --must-have "#e74c3b:红" "#3498db:蓝"
                            --min-ratio 0.01
                            --expect-diff a.png b.png
"""
import argparse
import struct
import sys
import zlib
from collections import Counter


def decode(path):
    """返回 (w, h, ch, pixels bytes)。支持颜色类型 0/2/3/4/6，位深 8。"""
    d = open(path, "rb").read()
    if d[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError("不是 PNG：%s" % path)
    w, h = struct.unpack(">II", d[16:24])
    depth, ct = d[24], d[25]
    if depth != 8:
        raise ValueError("仅支持位深 8，实测 %d" % depth)
    pos, idat = 8, b""
    while pos < len(d):
        ln = struct.unpack(">I", d[pos:pos + 4])[0]
        typ = d[pos + 4:pos + 8]
        if typ == b"IDAT":
            idat += d[pos + 8:pos + 8 + ln]
        pos += 12 + ln
    raw = zlib.decompress(idat)
    ch = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}[ct]
    stride = w * ch
    out = bytearray()
    prev = bytearray(stride)
    i = 0
    for _y in range(h):
        f = raw[i]; i += 1
        line = bytearray(raw[i:i + stride]); i += stride
        if f == 1:
            for x in range(ch, stride):
                line[x] = (line[x] + line[x - ch]) & 255
        elif f == 2:
            for x in range(stride):
                line[x] = (line[x] + prev[x]) & 255
        elif f == 3:
            for x in range(stride):
                line[x] = (line[x] + ((line[x - ch] if x >= ch else 0) + prev[x]) // 2) & 255
        elif f == 4:
            for x in range(stride):
                a = line[x - ch] if x >= ch else 0
                b = prev[x]
                c = prev[x - ch] if x >= ch else 0
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                pr = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                line[x] = (line[x] + pr) & 255
        out += line
        prev = line
    return w, h, ch, bytes(out)


def hex2rgb(s):
    s = s.lstrip("#")
    return (int(s[0:2], 16), int(s[2:4], 16), int(s[4:6], 16))


def count_color(px, ch, rgb, tol=12):
    """统计与目标色相近（每通道 ±tol）的像素数。"""
    r0, g0, b0 = rgb
    n = 0
    for o in range(0, len(px), ch):
        if (abs(px[o] - r0) <= tol and abs(px[o + 1] - g0) <= tol
                and abs(px[o + 2] - b0) <= tol):
            n += 1
    return n


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("png")
    ap.add_argument("--must-have", action="append", default=[],
                    help='"#rrggbb:说明"，该色必须出现')
    ap.add_argument("--min-ratio", type=float, default=0.0,
                    help="非背景像素占比下限")
    ap.add_argument("--expect-diff", nargs=2, default=None,
                    help="两张图必须不同（防「驱动脚本没跑」的全等失败）")
    ap.add_argument("--tol", type=int, default=12)
    args = ap.parse_args()

    w, h, ch, px = decode(args.png)
    total = w * h
    ok = True
    print("%s  %dx%d  %d 字节" % (args.png, w, h, len(px) // ch))

    for spec in args.must_have:
        hexv, _, desc = spec.partition(":")
        rgb = hex2rgb(hexv)
        n = count_color(px, ch, rgb, args.tol)
        ratio = n / total
        good = n > 0
        ok = ok and good
        print("  [%s] 颜色 %s (%s): %d 像素 (%.2f%%)"
              % ("OK" if good else "FAIL", hexv, desc or "", n, ratio * 100))

    cnt = Counter()
    for o in range(0, len(px), ch * 5):
        cnt[(px[o] >> 4, px[o + 1] >> 4, px[o + 2] >> 4)] += 1
    s = sum(cnt.values())
    nonbg = 1 - cnt.most_common(1)[0][1] / s
    good = nonbg >= args.min_ratio
    ok = ok and good
    print("  [%s] 非背景像素占比 %.1f%% (下限 %.1f%%)"
          % ("OK" if good else "FAIL", nonbg * 100, args.min_ratio * 100))

    if args.expect_diff:
        a = open(args.expect_diff[0], "rb").read()
        b = open(args.expect_diff[1], "rb").read()
        same = a == b
        ok = ok and not same
        print("  [%s] 两图不同（%s vs %s）"
              % ("OK" if not same else "FAIL", args.expect_diff[0], args.expect_diff[1]))

    print("=> %s" % ("全部通过" if ok else "存在失败项"))
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
