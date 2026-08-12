#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""PO-Closing Web 服务（仅标准库，Python 3.8+，零第三方依赖）。

启动:  python3 server.py   ->  http://127.0.0.1:8088
页面:  仅托管同目录 index.html；判定/核对/通知全部在服务端模块完成，前端无业务逻辑。
"""
import json
import os
import re
import subprocess
import sys
import threading
import time
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import config
import data_source
import invoices
import matching
import notifier
import storage

INDEX_FILE = os.path.join(config.BASE_DIR, "index.html")


def parse_po_text(text):
    """解析输入文本为去重保序的纯数字 PO 列表。"""
    seen, out = set(), []
    for tok in re.split(r"[\s,;，；、/]+", text or ""):
        t = tok.strip()
        if not t:
            continue
        if not t.isdigit():
            raise ValueError("无效 PO 号: %s（应为纯数字）" % t[:20])
        if t not in seen:
            seen.add(t)
            out.append(t)
    if not out:
        raise ValueError("请输入至少一个 PO 号")
    if len(out) > config.MAX_PO_PER_QUERY:
        raise ValueError("单次最多 %d 个 PO" % config.MAX_PO_PER_QUERY)
    return out


def judged_with_verification(po_list):
    items = matching.judge(data_source.fetch_items(po_list))
    ver = storage.verification_map()
    for it in items:
        it["VERIFY"] = ver.get(it["EBELN"] + "|" + it["EBELP"])
    return items, ver


def _parse_times(text):
    """解析 '03:33,12:33' 形式的时间表，校验 HH:MM 格式，返回排序去重列表。"""
    out = []
    for tok in re.split(r"[\s,;，；、]+", text or ""):
        t = tok.strip()
        if not t:
            continue
        if not re.match(r"^([01]?\d|2[0-3]):[0-5]\d$", t):
            raise ValueError("无效时间格式: %s（应为 HH:MM，如 03:33）" % t[:10])
        hh, mm = t.split(":")
        out.append("%02d:%s" % (int(hh), mm))
    return sorted(set(out))


def _parse_emails(text):
    """解析逗号分隔的邮箱列表并逐个校验格式。"""
    out = []
    for tok in re.split(r"[\s,;，；、]+", text or ""):
        t = tok.strip()
        if not t:
            continue
        if not re.match(r"^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$", t):
            raise ValueError("无效邮箱地址: %s" % t[:50])
        out.append(t)
    return out


def apply_settings(saved):
    """启动时把数据库中保存的设置覆盖到运行配置（优先级高于环境变量默认值）。"""
    try:
        if saved.get("SCHEDULE_TIMES") is not None:
            config.SCHEDULE_TIMES = _parse_times(saved["SCHEDULE_TIMES"])
        if saved.get("NOTIFY_EMAILS") is not None:
            config.NOTIFY_EMAILS = _parse_emails(saved["NOTIFY_EMAILS"])
    except ValueError as exc:
        print("[settings] 已存设置无效，忽略: %s" % exc)


class Handler(BaseHTTPRequestHandler):
    server_version = "POClosing/1.0"
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):  # 静默访问日志；需要审计时删除本方法
        pass

    # ---------- 基础工具 ----------
    def _cors(self):  # 前端从门户 80 端口跨域直连 8088，需放行（内网应用）
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def _send_json(self, obj, status=200):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self._cors()
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _error(self, status, msg):
        self._send_json({"ok": False, "error": msg}, status)

    def _read_json(self):
        length = int(self.headers.get("Content-Length") or 0)
        if length > config.MAX_BODY_BYTES:
            raise ValueError("请求体超出大小限制")
        if length <= 0:
            return {}
        return json.loads(self.rfile.read(length).decode("utf-8"))

    # ---------- 路由 ----------
    def do_OPTIONS(self):  # 跨域预检（POST JSON 前浏览器会先发 OPTIONS）
        self.send_response(204)
        self._cors()
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_HEAD(self):  # 探测/健康检查用（curl -I / 负载探测不取 body）
        if self.path in ("/", "/index.html", "/api/health"):
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.end_headers()
        else:
            self.send_response(404)
            self.end_headers()

    def do_GET(self):
        if self.path in ("/", "/index.html"):
            return self._send_index()
        if self.path == "/api/health":
            return self._send_json({"ok": True, "source": data_source.get_source().name})
        if self.path == "/api/notify/log":
            return self._send_json({"ok": True, "log": storage.list_notify(20)})
        if self.path == "/api/invoices":
            rows, files = invoices.load_invoices()
            return self._send_json({"ok": True, "invoices": rows, "files": files,
                                    "dir": config.INVOICE_DIR})
        if self.path == "/api/last_run":
            return self._send_json({"ok": True, "run": storage.get_last_run()})
        if self.path == "/api/sync_status":
            mail = None
            p = os.path.join(config.INVOICE_DIR, "last_sync.json")
            if os.path.isfile(p):
                try:
                    with open(p, encoding="utf-8") as f:
                        mail = json.load(f)
                except Exception:
                    mail = None
            return self._send_json({"ok": True, "mail": mail, "sap": storage.get_last_run()})
        if self.path == "/api/settings":
            return self._api_settings_get()
        return self._error(404, "Not Found")

    def do_POST(self):
        try:
            payload = self._read_json()
        except ValueError as exc:
            return self._error(400, str(exc))
        except Exception:
            return self._error(400, "请求体不是合法 JSON")
        try:
            if self.path == "/api/query":
                return self._api_query(payload)
            if self.path == "/api/po_status":
                return self._api_po_status(payload)
            if self.path == "/api/close":
                return self._api_close(payload)
            if self.path == "/api/settings":
                return self._api_settings_save(payload)
            if self.path == "/api/mail_sync":
                return self._api_mail_sync(payload)
            if self.path == "/api/verify":
                return self._api_verify(payload)
            if self.path == "/api/notify":
                return self._api_notify(payload)
        except ValueError as exc:
            return self._error(400, str(exc))
        except RuntimeError as exc:
            return self._error(502, str(exc))
        except Exception as exc:  # 兜底：不向前端暴露堆栈
            return self._error(500, "服务内部错误: %s" % exc)
        return self._error(404, "Not Found")

    # ---------- 页面（唯一静态文件，固定路径，无目录遍历风险）----------
    def _send_index(self):
        try:
            with open(INDEX_FILE, "rb") as f:
                body = f.read()
        except OSError:
            return self._error(500, "index.html 缺失")
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(body)

    # ---------- API ----------
    def _api_query(self, payload):
        po_list = parse_po_text(str(payload.get("po_text", "")))
        items, _ = judged_with_verification(po_list)
        self._send_json({"ok": True, "source": data_source.get_source().name,
                         "items": items, "summary": matching.summarize(items)})

    def _api_po_status(self, payload):
        """PO 级收货状态（账页主表）：含行项目明细供下钻，及未查到的 PO 清单。"""
        po_list = parse_po_text(str(payload.get("po_text", "")))
        items, _ = judged_with_verification(po_list)
        pos = matching.aggregate_po(items)
        marks = storage.close_mark_map()
        for p in pos:
            p["CLOSE_MARKED"] = "X" if p["EBELN"] in marks else ""
        found = {p["EBELN"] for p in pos}
        missing = [p for p in po_list if p not in found]
        full = sum(1 for p in pos if p["PO_STATUS"] == "FULL")
        self._send_json({
            "ok": True, "source": data_source.get_source().name,
            "pos": pos, "missing": missing,
            "summary": {"total": len(po_list), "full": full,
                        "lack": len(po_list) - full, "missing": len(missing)},
        })

    def _api_close(self, payload):
        """标记关闭选中的 PO（记录到 SQLite）。

        说明：这里只做「标记 + 留痕」，不写 SAP；真实关单（置 ELIKZ）走
        BAPI_PO_CHANGE，落地步骤见 rfc/README.md 第 4 节。
        """
        raw = payload.get("pos", [])
        if not isinstance(raw, list):
            raise ValueError("pos 须为数组")
        pos = []
        for p in raw:
            t = str(p).strip()
            if not t.isdigit():
                raise ValueError("无效 PO 号: %s（应为纯数字）" % t[:20])
            pos.append(t)
        if not pos:
            raise ValueError("未选择任何 PO")
        if len(pos) > config.MAX_PO_PER_QUERY:
            raise ValueError("单次最多 %d 个 PO" % config.MAX_PO_PER_QUERY)
        n = storage.save_close_marks(pos)
        self._send_json({"ok": True, "closed": n})

    def _api_settings_get(self):
        self._send_json({
            "ok": True,
            "schedule_times": ",".join(config.SCHEDULE_TIMES),
            "notify_emails": ",".join(config.NOTIFY_EMAILS),
            "mode": "internal",
        })

    def _api_settings_save(self, payload):
        times = _parse_times(str(payload.get("schedule_times", "")))
        emails = _parse_emails(str(payload.get("notify_emails", "")))
        storage.save_settings({"SCHEDULE_TIMES": ",".join(times),
                               "NOTIFY_EMAILS": ",".join(emails)})
        config.SCHEDULE_TIMES = times          # 调度线程每 20 秒读取，即时生效
        config.NOTIFY_EMAILS = emails          # 通知记录时读取，即时生效
        self._send_json({"ok": True, "schedule_times": ",".join(times),
                         "notify_emails": ",".join(emails)})

    def _api_mail_sync(self, payload):
        """手动触发邮件抓取（内网 Exchange → CSV）。脚本自行加载 invoice/exchange.env。"""
        script = os.path.join(config.BASE_DIR, "invoice", "exchange_invoice_sync.py")
        if not os.path.isfile(script):
            raise RuntimeError("抓取脚本不存在: %s" % script)
        try:
            proc = subprocess.run([sys.executable, script],
                                  capture_output=True, text=True, timeout=600)
        except subprocess.TimeoutExpired:
            raise RuntimeError("抓取超时（600 秒）")
        out = ((proc.stdout or "") + (proc.stderr or "")).strip()
        ok = proc.returncode == 0
        storage.save_notify("手动查收邮件", out[-800:], "mail_sync",
                            "OK" if ok else "FAIL", out[-300:])
        self._send_json({"ok": ok, "output": out[-500:]})

    def _api_verify(self, payload):
        ebeln = str(payload.get("ebeln", "")).strip()
        ebelp = str(payload.get("ebelp", "")).strip()
        verdict = str(payload.get("verdict", "")).strip().upper()
        note = str(payload.get("note", ""))
        verifier = str(payload.get("verifier", ""))
        if not (ebeln.isdigit() and ebelp):
            raise ValueError("参数不完整：缺少有效的 EBELN/EBELP")
        if verdict not in ("PASS", "FAIL"):
            raise ValueError("verdict 须为 PASS 或 FAIL")
        rec = storage.save_verification(ebeln, ebelp, verdict, note, verifier)
        self._send_json({"ok": True, "record": rec})

    def _api_notify(self, payload):
        # 以服务端数据为准重新取数判定，不信任前端传来的结果
        po_list = parse_po_text(str(payload.get("po_text", "")))
        items, ver = judged_with_verification(po_list)
        title, content = notifier.build_report(items, ver)
        result = notifier.send(title, content)
        self._send_json({"ok": result["status"] != "ERROR",
                         "title": title, "content": content, "result": result})


def run_verification(trigger="schedule"):
    """读取 invoice 目录清单 -> 连接 SAP（按数据源）取数判定 -> 结果落库 last_run。"""
    rows, files = invoices.load_invoices()
    if not rows:
        print("[verify] 发票目录无清单，跳过: %s" % config.INVOICE_DIR)
        storage.save_last_run({"ran_at": datetime.now().isoformat(timespec="seconds"),
                               "trigger": trigger, "ok": True,
                               "note": "发票目录无清单", "pos": [], "missing": [],
                               "log": "[verify] 发票目录无清单，跳过: %s" % config.INVOICE_DIR,
                               "summary": {"total": 0, "full": 0, "lack": 0, "missing": 0}})
        return None
    po_list = sorted({r["EBELN"] for r in rows if r["EBELN"]})   # 跳过无 PO 号的发票行
    items, ver = judged_with_verification(po_list)
    pos = matching.aggregate_po(items)
    marks = storage.close_mark_map()
    for p in pos:
        p["CLOSE_MARKED"] = "X" if p["EBELN"] in marks else ""
    found = {p["EBELN"] for p in pos}
    missing = [p for p in po_list if p not in found]
    full = sum(1 for p in pos if p["PO_STATUS"] == "FULL")
    payload = {
        "ran_at": datetime.now().isoformat(timespec="seconds"),
        "ok": True,
        "trigger": trigger, "source": data_source.get_source().name, "files": files,
        "summary": {"total": len(po_list), "full": full,
                    "lack": len(po_list) - full, "missing": len(missing)},
        "pos": pos, "missing": missing,
    }
    payload["log"] = ("[verify] %s 核查完成: %d 个 PO, 完整收货 %d（数据源 %s）"
                      % (payload["ran_at"], len(po_list), full, payload["source"]))
    storage.save_last_run(payload)
    print(payload["log"])
    if config.SCHEDULE_NOTIFY:
        title, content = notifier.build_report(items, ver)
        result = notifier.send(title, content)
        print("[verify] 自动通知: %s - %s" % (result["status"], result["detail"]))
    return payload


def _schedule_loop():
    """定点定时核查：每 20 秒检查一次，到达 SCHEDULE_TIMES 中的时刻即执行。"""
    last_fired = ""
    while True:
        now = time.strftime("%H:%M")
        stamp = time.strftime("%Y-%m-%d ") + now
        if now in config.SCHEDULE_TIMES and last_fired != stamp:
            last_fired = stamp
            try:
                run_verification("schedule")
            except Exception as exc:
                print("[schedule] 执行异常: %s" % exc)
                try:
                    storage.save_last_run({"ran_at": datetime.now().isoformat(timespec="seconds"),
                                           "trigger": "schedule", "ok": False,
                                           "error": str(exc)[:300]})
                except Exception:
                    pass
        time.sleep(20)


def main():
    storage.init()
    apply_settings(storage.get_settings())
    threading.Thread(target=_schedule_loop, daemon=True).start()
    print("[schedule] 定时核查: %s ｜ 发票目录 %s ｜ 自动通知=%s（页面「设置」可改）"
          % (" / ".join(config.SCHEDULE_TIMES) or "已关闭", config.INVOICE_DIR,
             "开" if config.SCHEDULE_NOTIFY else "关"))
    httpd = ThreadingHTTPServer((config.HOST, config.PORT), Handler)
    print("PO-Closing 已启动: http://%s:%d  (数据源=%s)"
          % (config.HOST, config.PORT, data_source.get_source().name))
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
