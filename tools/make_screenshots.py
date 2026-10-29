# -*- coding: utf-8 -*-
"""为 GitHub README 生成游戏截图（headless Chrome + 注入脚本驱动游戏）。

**不改游戏源码**：用 `--headless` 加载一个临时的「包装页」，包装页内联原
`index.html` 的全部内容，并在末尾追加一段脚本把游戏推进到指定状态
（进入战斗 / 打开面板 / 展示装备），再由 Chrome 截**整页**（含 HUD 的
DOM 覆盖层 —— `canvas.toDataURL()` 抓不到它）。

用法：
  python tools/make_screenshots.py            # 生成到 docs/screenshots/
  python tools/make_screenshots.py --keep     # 保留中间产物（调试用）

产物：docs/screenshots/*.png（1280x720）
"""
import argparse
import os
import re
import shutil
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC_HTML = os.path.join(ROOT, "index.html")
# 包装页**必须与 index.html 同级**：index.html 用相对路径 `<script src="game.js">`
# 加载主脚本，包装页若放在子目录里就找不到 game.js ⇒ startGame 未定义 ⇒ 驱动脚本静默失败
# （三张图会渲染出完全相同的菜单页，md5 一致 —— 这就是排查该问题的判据）。
WORK = os.path.join(ROOT, "_shot_work")
OUT = os.path.join(ROOT, "docs", "screenshots")
CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"


def build_wrapper(state_js, out_png, budget=6000, tag="scene"):
    """生成包装页：原 index.html 内容 + 追加驱动脚本。"""
    html = open(SRC_HTML, encoding="utf-8").read()
    # 移除 </body>，追加驱动脚本
    drive = """
<script>
(function () {
  function report(tag) {
    try { document.title = 'SHOT:' + tag + ':' + (typeof gameState !== 'undefined' ? gameState : '?'); } catch (e) {}
  }
  function go() {
    try {
      %s
      report('ok');
    } catch (e) {
      report('ERR:' + e.message);
      console.error('DRIVE_ERROR: ' + e.message + '\\n' + e.stack);
    }
  }
  if (document.readyState === 'complete') setTimeout(go, 200);
  else window.addEventListener('load', function () { setTimeout(go, 200); });
})();
</script>
""" % state_js
    assert "</body>" in html
    html = html.replace("</body>", drive + "\n</body>")

    # 让 body 正好是游戏大小，避免整页截图时出现黑边
    html = html.replace("min-height: 100vh;", "min-height: 0;")
    html = html.replace("width: 100%;\n    height: 100%;", "width: 1280px;\n    height: 720px;")
    # —— 每个场景一个独立文件 ——
    # 早先三个场景都写同一个 `page.html`，**后写的覆盖先写的**，
    # 于是 Chrome 加载的永远是最后一个场景（inventory）⇒
    # character / gameplay 的截图内容与预期不符，且**不报错**。
    # 判据：三张图 md5 相同 + 内容断言里的「面板内有绿色属性值」为 0。
    wrapper = os.path.join(WORK, "page_%s.html" % tag)
    with open(wrapper, "wb") as f:
        f.write(html.encode("utf-8"))
    # game.js 必须与包装页同级（相对路径加载）
    link = os.path.join(WORK, "game.js")
    if not os.path.exists(link):
        try:
            os.symlink(os.path.join(ROOT, "game.js"), link)
        except OSError:
            shutil.copyfile(os.path.join(ROOT, "game.js"), link)
    return wrapper


def shoot(wrapper, out_png, budget):
    if os.path.exists(out_png):
        os.remove(out_png)
    cmd = [
        CHROME, "--headless=new", "--disable-gpu", "--hide-scrollbars",
        "--no-sandbox", "--disable-dev-shm-usage",
        "--force-device-scale-factor=1",
        "--window-size=1280,720",
        "--virtual-time-budget=%d" % budget,
        "--screenshot=%s" % out_png,
        "file:///" + wrapper.replace("\\", "/"),
    ]
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
    ok = os.path.exists(out_png) and os.path.getsize(out_png) > 1000
    return ok, r.stdout.strip(), r.stderr.strip()[-400:]


# —— 三种场景 ——
SCENES = {
    # ① 战斗画面：进入游戏 + 刷一批怪 + 攻击（触发顿帧/伤害数字/粒子）
    # 敌人用 `new Enemy(...)` **直接构造**而非 `makeEnemy` —— 后者内部用
    # `choose(kinds)` 随机挑种类，颜色随机 ⇒ 截图的颜色断言不稳定。
    "gameplay": """
      startGame();
      // 清空 startGame() 生成的原地图敌人（29 只，位置散布在 3000+ 像素外，
      // 会追着玩家跑并把画面塞满杂兵）—— 只留下面摆好的 4 只，构图才可控。
      enemies.length = 0;
      projectiles.length = 0;
      var cx = player.x, cy = player.y;
      function spawn(cfg, dx, dy) {
        var e = new Enemy(cx + dx, cy + dy, cfg);
        enemies.push(e);
        return e;
      }
      var SLIME = { name:'史莱姆', color:'#2ecc71', eyeColor:'#ffffff',
                    hp:50, atk:6, def:3, exp:18, gold:10, w:36, h:48 };
      var ELITE = { name:'精英怪', color:'#c0392b', eyeColor:'#ffff00',
                    hp:120, atk:16, def:6, exp:60, gold:40, elite:true, w:40, h:56 };
      spawn(SLIME, 150, -90);
      spawn(SLIME, -170, 70);
      spawn(SLIME, 60, 140);
      spawn(ELITE, 250, 40);
      player.atk = 42; player.level = 7;
      // 模拟攻击：面向最近敌人挥剑（触发攻击特效 / 顿帧 / 伤害数字）
      function aim() {
        var best = null, bd = 1e9;
        for (var e of enemies) {
          if (!e.alive) continue;
          var d = Math.hypot(e.x - player.x, e.y - player.y);
          if (d < bd) { bd = d; best = e; }
        }
        if (best) { mouse.x = best.x; mouse.y = best.y; mouse.down = true; }
      }
      aim();
      setTimeout(aim, 120);
      setTimeout(function(){
        aim();
        // 诊断：把场上状态写进 title，便于截图后核对（不进最终产物）
        var alive = enemies.filter(function(e){return e.alive;});
        document.title = 'SHOT:' + alive.length + '/' + enemies.length
          + ' px=' + Math.round(player.x) + ',' + Math.round(player.y)
          + ' cam=' + Math.round(camera.x) + ',' + Math.round(camera.y)
          + ' e0=' + (alive[0] ? Math.round(alive[0].x - camera.x) + ',' + Math.round(alive[0].y - camera.y) : '-');
      }, 260);
    """,
    # ② 角色面板：展示装备 6 槽位 + 属性
    "character": """
      startGame();
      player.level = 12; player.exp = 320; player.gold = 1840;
      player.atk = 38; player.def = 24; player.maxHp = 260; player.hp = 221;
      player.maxMp = 90; player.mp = 74; player.crit = 18; player.lifesteal = 12;
      // 装备 6 个槽位 —— 面板的 6 个槽位默认是 .empty（无加成 ⇒ 属性区没有
      // 绿色 bonus 数字，截图会显得空）。装备对象字段照抄游戏内测试用例的结构。
      player.equipped = {
        weapon: { kind:'weapon', name:'烈焰之刃', color:'#ff6b35', rarity:'legendary',
                  atk:25, def:0, range:60,
                  affixes:[{stat:'atk',value:8,label:'攻击力 +8'},
                           {stat:'crit',value:5,label:'暴击率 +5%'}] },
        armor:  { kind:'armor', name:'龙鳞胸甲', color:'#2ecc71', rarity:'rare',
                  atk:0, def:18, hp:40,
                  affixes:[{stat:'def',value:6,label:'防御力 +6'}] },
        head:   { kind:'head', name:'秘银头盔', color:'#95a5a6', rarity:'rare',
                  atk:0, def:8, hp:20,
                  affixes:[{stat:'hp',value:15,label:'生命值 +15'}] },
        gloves: { kind:'gloves', name:'霜寒护腕', color:'#3498db', rarity:'common',
                  atk:6, def:5,
                  affixes:[{stat:'atk',value:3,label:'攻击力 +3'}] },
        boots:  { kind:'boots', name:'疾风战靴', color:'#e67e22', rarity:'common',
                  atk:0, def:4, speed:0.5,
                  affixes:[{stat:'speed',value:0.3,label:'移动速度 +0.3'}] },
        amulet: { kind:'amulet', name:'智慧之戒', color:'#9b59b6', rarity:'legendary',
                  atk:8, def:0, crit:6, lifesteal:5,
                  affixes:[{stat:'crit',value:6,label:'暴击率 +6%'},
                           {stat:'lifesteal',value:5,label:'吸血 +5%'}] }
      };
      if (typeof player.invalidateBonus === 'function') player.invalidateBonus();
      setTimeout(function () {
        try { toggleCharacterPanel(); } catch (e) {}
      }, 200);
    """,
    # ③ 背包：展示装备列表与词条
    "inventory": """
      startGame();
      player.level = 9; player.gold = 960;
      // 往背包里放 5 件装备（背包 = player.inventory，16 格）
      var ITEMS = [
        { kind:'weapon', name:'烈焰之刃', color:'#ff6b35', rarity:'legendary', atk:25, def:0, range:60,
          affixes:[{stat:'atk',value:8,label:'攻击力 +8'},{stat:'crit',value:5,label:'暴击率 +5%'}] },
        { kind:'armor', name:'龙鳞胸甲', color:'#2ecc71', rarity:'rare', atk:0, def:18, hp:40,
          affixes:[{stat:'def',value:6,label:'防御力 +6'}] },
        { kind:'head', name:'秘银头盔', color:'#95a5a6', rarity:'rare', atk:0, def:8, hp:20,
          affixes:[{stat:'hp',value:15,label:'生命值 +15'}] },
        { kind:'gloves', name:'霜寒护腕', color:'#3498db', rarity:'common', atk:6, def:5,
          affixes:[{stat:'atk',value:3,label:'攻击力 +3'}] },
        { kind:'boots', name:'疾风战靴', color:'#e67e22', rarity:'common', atk:0, def:4, speed:0.5,
          affixes:[{stat:'speed',value:0.3,label:'移动速度 +0.3'}] }
      ];
      for (var i = 0; i < ITEMS.length; i++) { player.inventory[i] = ITEMS[i]; }
      setTimeout(function () {
        try {
          var p = document.getElementById('inventory-panel');
          p.classList.add('active');
          if (typeof renderInventoryPanel === 'function') renderInventoryPanel();
        } catch (e) {}
      }, 200);
    """,
}


def png_stats(path):
    """用纯 Python 解 PNG，统计画面是否「有内容」（避免依赖 Pillow）。"""
    import struct, zlib
    d = open(path, "rb").read()
    if d[:8] != b"\x89PNG\r\n\x1a\n":
        return None
    w, h = struct.unpack(">II", d[16:24])
    ct = d[25]
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
    out = bytearray(); prev = bytearray(stride); i = 0
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
        out += line; prev = line
    from collections import Counter
    cnt = Counter()
    for j in range(0, len(out), ch * 5):
        cnt[(out[j] >> 4, out[j + 1] >> 4, out[j + 2] >> 4)] += 1
    total = sum(cnt.values())
    top = cnt.most_common(1)[0][1]
    return {"w": w, "h": h, "distinct": len(cnt), "nonbg_ratio": round(1 - top / total, 3)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--keep", action="store_true", help="保留中间产物")
    ap.add_argument("--budget", type=int, default=6000, help="virtual-time-budget 毫秒")
    args = ap.parse_args()

    if not os.path.exists(CHROME):
        print("找不到 Chrome：%s" % CHROME)
        return 1
    shutil.rmtree(WORK, ignore_errors=True)
    os.makedirs(WORK, exist_ok=True)
    os.makedirs(OUT, exist_ok=True)

    # —— 每个场景的特征颜色断言 ——
    # 只判「文件非空」会漏掉「驱动脚本没跑 → 三张图渲染同一张菜单页」；
    # 故每个场景都要有**该场景独有**的颜色出现。
    ASSERTS = {
        # 血条渐变（#c0392b/#e74c3c）+ 敌人血条 —— 战斗场景必有
        "gameplay": ["#e74c3c:血条红", "#1e8449:史莱姆描边绿", "#f39c12:精英光环"],
        # 角色面板边框 #c39bd3
        "character": ["#c39bd3:面板边框"],
        # 背包面板边框 #555 + 槽位
        "inventory": ["#555555:面板边框"],
    }

    results = []
    for name, js in SCENES.items():
        out_png = os.path.join(OUT, "%s.png" % name)
        wrapper = build_wrapper(js, out_png, args.budget, tag=name)
        ok, so, se = shoot(wrapper, out_png, args.budget)
        if not ok:
            print("[FAIL] %s —— 未生成 PNG\n%s" % (name, se))
            results.append((name, None))
            continue
        st = png_stats(out_png)
        print("[ OK ] %-10s %s  %d 字节  颜色桶 %d  非背景 %.1f%%"
              % (name, "%dx%d" % (st["w"], st["h"]), os.path.getsize(out_png),
                 st["distinct"], st["nonbg_ratio"] * 100))
        results.append((name, st))

    # —— 内容断言：调 png_check.py 做颜色校验 + 两两不同校验 ——
    print("\n== 内容断言 ==")
    rc = 0
    names = [n for n, st in results if st]
    for i, name in enumerate(names):
        cmd = [sys.executable, os.path.join(ROOT, "tools", "png_check.py"),
               os.path.join(OUT, "%s.png" % name), "--min-ratio", "0.2"]
        for spec in ASSERTS.get(name, []):
            cmd += ["--must-have", spec]
        # 与另一张图必须不同（防「驱动脚本没跑」的全等失败）
        other = names[(i + 1) % len(names)]
        cmd += ["--expect-diff", os.path.join(OUT, "%s.png" % name),
                os.path.join(OUT, "%s.png" % other)]
        r = subprocess.run(cmd, capture_output=True, text=True)
        good = r.returncode == 0
        rc = rc or (0 if good else 1)
        for line in r.stdout.strip().splitlines():
            print("  %s" % line)
        if not good:
            print("  ^ 场景 %s 断言未通过" % name)

    if not args.keep:
        shutil.rmtree(WORK, ignore_errors=True)
    else:
        print("中间产物保留在 %s" % WORK)
    bad = [n for n, st in results if st is None or st["nonbg_ratio"] < 0.05]
    if bad:
        print("警告：以下场景画面内容过少（可能黑屏）：%s" % ", ".join(bad))
        rc = 1
    return rc


if __name__ == "__main__":
    sys.exit(main())
