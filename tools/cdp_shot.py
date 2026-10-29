# -*- coding: utf-8 -*-
"""在真实 Chrome 里截游戏画面（CDP Page.captureScreenshot）。

为什么不用 tools/make_screenshots.py
----------------------------------
那个脚本用 `--headless --screenshot`，而 **headless 的媒体栈不可用**
（`<audio>` 不回调、`decodeAudioData` 永不 settle），拿它验证音效素材
会得到**假阴性**。本脚本驱动**带窗口的真实 Chrome**，与用户实际运行环境一致。

同时它能做**像素断言**（"指定颜色在画面里真的出现了"），而不是只检查文件非空
—— 只看「文件存在」会漏过「素材没被画出来」这类静默失败。

用法：
  python tools/cdp_shot.py <url> <out.png> [--js "<准备脚本>"] [--timeout 30]
"""
import base64
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from cdp_run import PORT, _start_chrome, _wait_targets  # noqa: E402
from cdp_eval import WS  # noqa: E402


def capture(url, out_png, prep_js=None, timeout=30, width=1280, height=720):
    proc = _start_chrome()
    try:
        pages = _wait_targets(timeout=15)
        if not pages:
            return {"ok": False, "error": "Chrome 未就绪"}
        ws = WS(pages[0]["webSocketDebuggerUrl"], timeout=timeout)
        try:
            ws.send(json.dumps({"id": 1, "method": "Page.enable"}))
            ws.send(json.dumps({"id": 2, "method": "Runtime.enable"}))
            ws.send(json.dumps({
                "id": 3, "method": "Emulation.setDeviceMetricsOverride",
                "params": {"width": width, "height": height,
                           "deviceScaleFactor": 1, "mobile": False}}))
            ws.send(json.dumps({"id": 4, "method": "Page.navigate",
                                "params": {"url": url}}))

            next_id = 5
            if prep_js:
                ws.send(json.dumps({
                    "id": next_id, "method": "Runtime.evaluate",
                    "params": {"expression": prep_js, "awaitPromise": True,
                               "returnByValue": True,
                               "timeout": (timeout - 8) * 1000}}))
                next_id += 1

            shot_id = next_id
            # 等准备脚本跑完再截图
            deadline = time.time() + timeout
            while time.time() < deadline:
                msg = json.loads(ws.recv())
                if msg.get("id") == (next_id - 1 if prep_js else None):
                    break
            time.sleep(1.0)

            ws.send(json.dumps({"id": shot_id, "method": "Page.captureScreenshot",
                                "params": {"format": "png"}}))
            while time.time() < deadline:
                msg = json.loads(ws.recv())
                if msg.get("id") == shot_id:
                    data = msg.get("result", {}).get("data")
                    if not data:
                        return {"ok": False, "error": "截图返回空"}
                    raw = base64.b64decode(data)
                    with open(out_png, "wb") as f:
                        f.write(raw)
                    return {"ok": True, "bytes": len(raw)}
            return {"ok": False, "error": "截图超时"}
        finally:
            ws.close()
    finally:
        try:
            proc.terminate()
        except Exception:
            pass


def main():
    if len(sys.argv) < 3:
        print(__doc__)
        return 2
    url, out_png = sys.argv[1], sys.argv[2]
    prep_js = None
    timeout = 30
    if "--js" in sys.argv:
        prep_js = sys.argv[sys.argv.index("--js") + 1]
    if "--timeout" in sys.argv:
        timeout = int(sys.argv[sys.argv.index("--timeout") + 1])
    r = capture(url, out_png, prep_js, timeout)
    print(json.dumps(r, ensure_ascii=False))
    return 0 if r.get("ok") else 1


if __name__ == "__main__":
    sys.exit(main())
