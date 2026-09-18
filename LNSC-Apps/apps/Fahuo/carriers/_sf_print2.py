#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""子母件云打印诊断：母单号云打印返回的 files[] 有几条？是否已含全部件？
   只读查询，无副作用。"""
import json
import os
import sys

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BASE)
ENV_FILE = os.path.join(BASE, "carriers.env")
if os.path.isfile(ENV_FILE):
    for line in open(ENV_FILE, encoding="utf-8"):
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip())

from carriers import sf_express  # noqa: E402

for wb in ("SF5151245050835", "SF2085471115273"):
    print("=== cloud_print", wb, "===")
    try:
        data = sf_express.cloud_print(wb)
        s = json.dumps(data, ensure_ascii=False)
        print("top keys:", list(data.keys()) if isinstance(data, dict) else type(data))
        from carriers import find_label_files
        files = find_label_files(data)
        print("files[] count:", len(files))
        for f in files:
            print("  waybillNo:", f.get("waybillNo"), "url head:", f.get("url", "")[:70])
        print("raw head:", s[:400])
    except Exception as e:
        print("EXC:", str(e)[:300])
