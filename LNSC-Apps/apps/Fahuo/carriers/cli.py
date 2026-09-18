#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""承运商命令行入口：Node server.js 以子进程调用（与生产 server.py 内嵌同一 carriers 包）
用法：
  python3 carriers/cli.py order '<order JSON>'      下单（JSON 含 carrier/oid/so 等）
  python3 carriers/cli.py route '<carrier>' '<no>'  轨迹查询
  python3 carriers/cli.py label '<carrier>' '<no>'  官方面单（输出 {"pdf": "<base64>"}）
  python3 carriers/cli.py cancel '<carrier>' '<order_id>' '<waybill_no>' ['<logistic_id>']  取消下单
输出：成功=结果 JSON；失败={"error": ...} 且退出码 1"""
import json
import os
import sys

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))   # server/
sys.path.insert(0, BASE)

ENV_FILE = os.path.join(BASE, "carriers.env")
if os.path.isfile(ENV_FILE):
    for line in open(ENV_FILE, encoding="utf-8"):
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip())

from carriers import place_order, query_route, print_label, cancel_order, find_pdf_b64, find_label_files  # noqa: E402
from carriers.base import fetch_url_pdf_b64  # noqa: E402


def main():
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    if cmd == "order":
        d = json.loads(sys.argv[2])
        carrier = d.pop("carrier", "")
        return place_order(carrier, d)
    if cmd == "route":
        return query_route(sys.argv[2], sys.argv[3])
    if cmd == "cancel":
        return cancel_order(sys.argv[2], sys.argv[3], sys.argv[4],
                            sys.argv[5] if len(sys.argv) > 5 else "")
    if cmd == "label":
        data = print_label(sys.argv[2], sys.argv[3])
        pdf = find_pdf_b64(data)                          # 形态1：响应内嵌 base64
        if not pdf:
            files = find_label_files(data)                # 形态2：url+token（顺丰 v2.0）
            if files:
                pdf = fetch_url_pdf_b64(files[0]["url"], files[0]["token"])
        return {"pdf": pdf, "raw": None if pdf else data}
    return {"error": "未知命令：" + cmd}


try:
    print(json.dumps(main(), ensure_ascii=False))
except Exception as e:
    print(json.dumps({"error": str(e)}, ensure_ascii=False))
    sys.exit(1)
