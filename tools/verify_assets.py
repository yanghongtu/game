# -*- coding: utf-8 -*-
"""验证素材真的**画在画面上**（而不是「文件存在」）。

为什么需要这个
--------------
本项目踩过的坑：截图类脚本的失败方式是「静默产出错内容」而非报错 ——
多场景写同一个包装页会互相覆盖、调用的 API 不存在会产出空面板、
断言用配置色而非**不透明的实际渲染色**会几乎必然落空。
只看「文件非空 / 文件存在」会漏过全部三种。

所以这里的判据是：**素材的标志性颜色，在游戏画面的指定区域里真的出现了**。

用法：
  python tools/verify_assets.py
"""
import json
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "tools"))
from png_check import decode, count_color, hex2rgb  # noqa: E402
from cdp_shot import capture  # noqa: E402

URL = "file:///" + os.path.join(ROOT, "index.html").replace("\\", "/")

# —— 素材标志性颜色（取自素材自身的调色板，程序化版本不会出现）——
# 每项：色值 → 判据说明
MARKERS = [
    ("#43e1b3", "史莱姆/幽灵的青绿色"),
    ("#8b9bb4", "精灵的灰蓝轮廓色"),
    ("#f7c282", "精灵的暖黄高光"),
    ("#c0cbdc", "精灵的浅灰白"),
]

# 各精灵在 16x16 图里的特征色（从源素材直方图确认过）
SPRITE_MARKERS = {
    "slime":            "#43e1b3",
    "slime_king":       "#43e1b3",
    "skeleton":         "#c0cbdc",
    "skeleton_warrior": "#c0cbdc",
    "ghost":            "#43e1b3",
}


def prep_js(enemy_name):
    """把玩家挪到指定敌人旁边（摄像机跟随玩家 ⇒ 敌人会进画面）。"""
    return """
(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  await sleep(2500);
  document.getElementById('btn-start').click();
  await sleep(1200);
  const e = enemies.find(x => x.name === %s);
  if (e) { player.x = e.x - 70; player.y = e.y; }
  await sleep(900);
  return 'ok';
})()
""" % json.dumps(enemy_name, ensure_ascii=False)


def main():
    tmp = os.path.join(ROOT, "_shot_verify.png")
    ok_all = True
    print("== 素材渲染验证 ==")

    # —— ① 史莱姆 ——
    r = capture(URL, tmp, prep_js("史莱姆"), timeout=30)
    if not r.get("ok"):
        print("  [FAIL] 截图失败：%s" % r.get("error"))
        return 1
    w, h, ch, px = decode(tmp)
    for hexv, desc in MARKERS:
        n = count_color(px, ch, hex2rgb(hexv), tol=18)
        good = n > 20
        ok_all = ok_all and good
        print("  [%s] %s (%s): %d 像素"
              % ("OK" if good else "FAIL", hexv, desc, n))

    # —— ② 地板/墙素材 ——
    # 地板 cobble_blood 的主色 #313131 与墙 brick_gray 的 #414141
    # 程序化版本的地板是 #3d3d5c / #353550（带蓝），差异明显
    r = capture(URL, tmp, prep_js("史莱姆"), timeout=30)
    w, h, ch, px = decode(tmp)
    for hexv, desc in [("#313131", "cobble_blood 地板主色"),
                       ("#414141", "brick_gray 墙主色")]:
        n = count_color(px, ch, hex2rgb(hexv), tol=10)
        good = n > 500
        ok_all = ok_all and good
        print("  [%s] %s (%s): %d 像素"
              % ("OK" if good else "FAIL", hexv, desc, n))

    # —— ③ 素材加载完整性 ——
    r = subprocess.run(
        ["python", os.path.join(ROOT, "tools", "cdp_run.py"), URL,
         "(async()=>{const s=ms=>new Promise(r=>setTimeout(r,ms));await s(2500);"
         "initAudio();for(let i=0;i<60&&!ASSETS.audioReady;i++)await s(200);"
         "return JSON.stringify({img:Object.keys(ASSETS.img).length,"
         "audio:Object.keys(ASSETS.audio).length});})()", "--timeout", "30"],
        capture_output=True, text=True, cwd=ROOT)
    try:
        res = json.loads(r.stdout.strip().splitlines()[-1])
        cnt = json.loads(res["result"]) if res.get("ok") else {}
    except Exception:
        cnt = {}
    img_n, aud_n = cnt.get("img", 0), cnt.get("audio", 0)
    good = img_n == 14 and aud_n == 10
    ok_all = ok_all and good
    print("  [%s] 素材加载：图片 %d/14，音频 %d/10"
          % ("OK" if good else "FAIL", img_n, aud_n))

    # —— ④ 降级路径：资源加载失败时游戏仍能跑 ——
    # 用 ?nores=1 之类不好做；直接断言「ASSETS.img 为空时 drawWorld 不抛错」
    r = subprocess.run(
        ["python", os.path.join(ROOT, "tools", "cdp_run.py"), URL,
         "(async()=>{const s=ms=>new Promise(r=>setTimeout(r,ms));await s(2000);"
         "const saved=Object.assign({},ASSETS.img);for(const k in ASSETS.img)delete ASSETS.img[k];"
         "let err=null;try{document.getElementById('btn-start').click();await s(600);"
         "drawWorld();drawEntities();}catch(e){err=e.message;}"
         "for(const k in saved)ASSETS.img[k]=saved[k];"
         "return JSON.stringify({err});})()", "--timeout", "25"],
        capture_output=True, text=True, cwd=ROOT)
    try:
        res = json.loads(r.stdout.strip().splitlines()[-1])
        derr = json.loads(res["result"]).get("err") if res.get("ok") else "cdp失败"
    except Exception:
        derr = "cdp失败"
    good = derr is None
    ok_all = ok_all and good
    print("  [%s] 降级路径（无素材时绘制不报错）: %s"
          % ("OK" if good else "FAIL", derr or "无异常"))

    if os.path.exists(tmp):
        os.remove(tmp)
    print("\n=> %s" % ("全部通过" if ok_all else "存在失败项"))
    return 0 if ok_all else 1


if __name__ == "__main__":
    sys.exit(main())
