# -*- coding: utf-8 -*-
"""在**同一个进程**里启动真实 Chrome + 通过 CDP 跑一段 JS 并取回结果。

为什么需要它
------------
headless Chrome 的**媒体栈不可用**：`<audio>` 不触发 `loadedmetadata`、
`decodeAudioData` 的 Promise 永不 settle ⇒ 用 headless 验证音效只会得到
**假阴性**（"没加载成功"其实是环境问题，不是代码问题）。

而跨 shell 命令的常驻 Chrome 进程会被环境回收 ⇒ 端口连不上。

所以这里把「起 Chrome → 等端口 → 连 CDP → 跑 JS → 拿结果 → 收 Chrome」
放进**一个进程**里完成，避开两个坑。

用法：
  python tools/cdp_run.py <url> <js_expr> [--timeout 25] [--keep-open]
  → stdout 打印 JSON：{"ok":true,"result":...}
"""
import json
import os
import subprocess
import sys
import time
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from cdp_eval import WS  # noqa: E402

CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
PORT = 9333
PROFILE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                       "_chrome_cdp")


def _start_chrome():
    prof = os.path.join(os.environ.get("TEMP", "."), "cdp_run_profile")
    args = [
        CHROME,
        "--remote-debugging-port=%d" % PORT,
        "--user-data-dir=%s" % prof,
        "--no-first-run", "--no-default-browser-check",
        "--allow-file-access-from-files",
        "--autoplay-policy=no-user-gesture-required",
        "--window-size=1280,800",
        "about:blank",
    ]
    flags = subprocess.CREATE_NEW_PROCESS_GROUP if os.name == "nt" else 0
    return subprocess.Popen(args, stdout=subprocess.DEVNULL,
                            stderr=subprocess.DEVNULL, creationflags=flags)


def _wait_targets(timeout=20):
    end = time.time() + timeout
    while time.time() < end:
        try:
            req = urllib.request.Request(
                "http://127.0.0.1:%d/json/list" % PORT,
                headers={"User-Agent": "cdp-run"})
            with urllib.request.urlopen(req, timeout=3) as r:
                data = json.loads(r.read().decode("utf-8"))
            pages = [t for t in data
                     if t.get("type") == "page" and t.get("webSocketDebuggerUrl")]
            if pages:
                return pages
        except Exception:
            pass
        time.sleep(0.4)
    return []


def run(url, expr, timeout=25):
    proc = _start_chrome()
    try:
        pages = _wait_targets(timeout=15)
        if not pages:
            return {"ok": False, "error": "Chrome 未就绪"}
        ws = WS(pages[0]["webSocketDebuggerUrl"], timeout=timeout)
        try:
            ws.send(json.dumps({"id": 1, "method": "Page.enable"}))
            ws.send(json.dumps({"id": 2, "method": "Runtime.enable"}))
            ws.send(json.dumps({"id": 3, "method": "Page.navigate",
                                "params": {"url": url}}))
            ws.send(json.dumps({"id": 4, "method": "Runtime.evaluate",
                                "params": {"expression": expr,
                                           "awaitPromise": True,
                                           "returnByValue": True,
                                           "timeout": (timeout - 5) * 1000}}))
            end = time.time() + timeout
            while time.time() < end:
                msg = json.loads(ws.recv())
                if msg.get("id") == 4:
                    res = msg.get("result", {})
                    if "exceptionDetails" in res:
                        ed = res["exceptionDetails"]
                        return {"ok": False,
                                "error": "%s %s" % (ed.get("text"),
                                                    ed.get("exception", {}).get("description", ""))}
                    return {"ok": True, "result": res.get("result", {}).get("value")}
            return {"ok": False, "error": "等待超时"}
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
    url, expr = sys.argv[1], sys.argv[2]
    timeout = 25
    if "--timeout" in sys.argv:
        timeout = int(sys.argv[sys.argv.index("--timeout") + 1])
    r = run(url, expr, timeout)
    print(json.dumps(r, ensure_ascii=False))
    return 0 if r.get("ok") else 1


if __name__ == "__main__":
    sys.exit(main())
