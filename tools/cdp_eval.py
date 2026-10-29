# -*- coding: utf-8 -*-
"""极简 CDP 客户端（纯标准库）。

用途：驱动**非 headless** 的 Chrome，验证真实浏览器里的行为
（headless 的媒体栈不可用 —— `<audio>` 与 `decodeAudioData` 都不回调，
拿它验证音效会得到假阴性）。

只实现 CDP 需要的最小子集：
  · HTTP GET /json/list 拿目标页的 webSocketDebuggerUrl
  · WebSocket 握手（client → server，带掩码）
  · 文本帧收发（CDP 全是文本帧，且长度通常 < 64KB）

用法：
  python tools/cdp_eval.py <url> <js_expr> [--timeout 20]
  → 打印 JSON：{"ok":true,"result":...} 或 {"ok":false,"error":"..."}
"""
import base64
import json
import os
import socket
import struct
import sys
import time
import urllib.request


def _http_json(url, timeout=10):
    req = urllib.request.Request(url, headers={"User-Agent": "cdp-eval"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


class WS:
    """够用的 WebSocket 客户端：只做文本帧，不做分片/续传。"""

    def __init__(self, url, timeout=20):
        # ws://127.0.0.1:PORT/devtools/page/XXX
        rest = url[len("ws://"):]
        hostport, _, path = rest.partition("/")
        path = "/" + path
        host, _, port = hostport.partition(":")
        self.sock = socket.create_connection((host, int(port)), timeout=timeout)
        self.sock.settimeout(timeout)
        key = base64.b64encode(os.urandom(16)).decode()
        req = (
            "GET %s HTTP/1.1\r\n"
            "Host: %s\r\n"
            "Upgrade: websocket\r\n"
            "Connection: Upgrade\r\n"
            "Sec-WebSocket-Key: %s\r\n"
            "Sec-WebSocket-Version: 13\r\n\r\n" % (path, hostport, key)
        )
        self.sock.sendall(req.encode())
        # 读握手响应（到 \r\n\r\n 为止）
        buf = b""
        while b"\r\n\r\n" not in buf:
            chunk = self.sock.recv(4096)
            if not chunk:
                raise RuntimeError("握手失败：连接被关闭")
            buf += chunk
        if b"101" not in buf.split(b"\r\n", 1)[0]:
            raise RuntimeError("握手失败：%s" % buf.split(b"\r\n", 1)[0])

    def send(self, text):
        data = text.encode("utf-8")
        n = len(data)
        header = bytearray([0x81])          # FIN + text
        if n < 126:
            header.append(0x80 | n)        # MASK
        elif n < 65536:
            header.append(0x80 | 126)
            header += struct.pack(">H", n)
        else:
            header.append(0x80 | 127)
            header += struct.pack(">Q", n)
        mask = os.urandom(4)
        header += mask
        masked = bytes(b ^ mask[i % 4] for i, b in enumerate(data))
        self.sock.sendall(bytes(header) + masked)

    def _recv_exact(self, n):
        buf = b""
        while len(buf) < n:
            chunk = self.sock.recv(n - len(buf))
            if not chunk:
                raise RuntimeError("连接中断")
            buf += chunk
        return buf

    def recv(self):
        """收一个完整文本帧。"""
        while True:
            b0, b1 = self._recv_exact(2)
            opcode = b0 & 0x0F
            masked = b1 & 0x80
            length = b1 & 0x7F
            if length == 126:
                length = struct.unpack(">H", self._recv_exact(2))[0]
            elif length == 127:
                length = struct.unpack(">Q", self._recv_exact(8))[0]
            mask = self._recv_exact(4) if masked else None
            payload = self._recv_exact(length)
            if mask:
                payload = bytes(b ^ mask[i % 4] for i, b in enumerate(payload))
            if opcode == 0x8:               # close
                raise RuntimeError("浏览器关闭了连接")
            if opcode == 0x9:               # ping → 回 pong
                continue
            if opcode in (0x1, 0x2):        # text / binary
                return payload.decode("utf-8", "replace")

    def close(self):
        try:
            self.sock.close()
        except Exception:
            pass


def eval_js(url, expr, timeout=20, debug_port=9222):
    deadline = time.time() + timeout
    targets = None
    while time.time() < deadline:
        try:
            targets = _http_json("http://127.0.0.1:%d/json/list" % debug_port)
            break
        except Exception:
            time.sleep(0.4)
    if not targets:
        return {"ok": False, "error": "连不上 CDP 端口 %d" % debug_port}

    page = None
    for t in targets:
        if t.get("type") == "page" and t.get("webSocketDebuggerUrl"):
            page = t
            break
    if page is None:
        return {"ok": False, "error": "没有可用的 page target"}

    ws = WS(page["webSocketDebuggerUrl"], timeout=timeout)
    try:
        mid = 1
        ws.send(json.dumps({"id": mid, "method": "Page.enable"}))
        ws.send(json.dumps({"id": mid + 1, "method": "Runtime.enable"}))
        ws.send(json.dumps({
            "id": mid + 2, "method": "Page.navigate", "params": {"url": url}
        }))
        ws.send(json.dumps({
            "id": mid + 3, "method": "Runtime.evaluate",
            "params": {"expression": expr, "awaitPromise": True,
                       "returnByValue": True, "timeout": (timeout - 5) * 1000},
        }))

        end = time.time() + timeout
        while time.time() < end:
            msg = json.loads(ws.recv())
            if msg.get("id") == mid + 3:
                res = msg.get("result", {})
                if "exceptionDetails" in res:
                    return {"ok": False,
                            "error": str(res["exceptionDetails"].get("text"))
                                    + " " + str(res["exceptionDetails"].get("exception", {}).get("description", ""))}
                return {"ok": True, "result": res.get("result", {}).get("value")}
        return {"ok": False, "error": "等待超时"}
    finally:
        ws.close()


def main():
    if len(sys.argv) < 3:
        print(__doc__)
        return 2
    url = sys.argv[1]
    expr = sys.argv[2]
    timeout = 20
    if "--timeout" in sys.argv:
        timeout = int(sys.argv[sys.argv.index("--timeout") + 1])
    r = eval_js(url, expr, timeout)
    print(json.dumps(r, ensure_ascii=False))
    return 0 if r.get("ok") else 1


if __name__ == "__main__":
    sys.exit(main())
