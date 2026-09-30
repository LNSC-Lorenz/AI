#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""回签单面单逐页全文提取 + 回单运单轨迹流向核查（2026-09-29 用户指正：
   官方回单逻辑=自动带一张回单返回运单，单号取原单回单号、地址反向、运费到付。
   此前探针 label_text 只打印前 600 字符，2 页联单第 2 页可能被截断漏看。）"""
import json
import os
import sys
import urllib.request

BASE = "/var/www/lnsc-apps/apps/fahuo"
sys.path.insert(0, BASE)
ENV_FILE = os.path.join(BASE, "carriers.env")
if os.path.isfile(ENV_FILE):
    for line in open(ENV_FILE, encoding="utf-8"):
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip())

from carriers import base, sf_express  # noqa: E402

cfg = base.get_cfg("SF")


def pages_text(wb):
    d = sf_express.cloud_print(wb, cfg)
    files = (d.get("obj") or {}).get("files") or []
    out = ["files=%d" % len(files)]
    from pypdf import PdfReader
    for i, f in enumerate(files):
        req = urllib.request.Request(f["url"], headers={"X-Auth-Token": f["token"]})
        raw = urllib.request.urlopen(req, timeout=30).read()
        p = "/tmp/_lbl_%s_%d.pdf" % (wb[-6:], i)
        open(p, "wb").write(raw)
        r = PdfReader(p)
        out.append("== file%d %d bytes pages=%d ==" % (i, len(raw), len(r.pages)))
        for j, pg in enumerate(r.pages):
            out.append("---- page %d ----" % (j + 1))
            out.append(pg.extract_text() or "(no text)")
    return "\n".join(out)


def route_full(wb):
    try:
        r = sf_express._real_query_route(wb, cfg)
        return json.dumps(r.get("detail") or [], ensure_ascii=False, indent=1)
    except Exception as e:
        return "(route err: %r)" % e


sb = sys.argv[1]
main = sys.argv[2] if len(sys.argv) > 2 else ""
print("######## 回单面单逐页全文:", sb)
print(pages_text(sb))
print("\n######## 回单运单轨迹（流向核查）:", sb)
print(route_full(sb))
if main:
    print("\n######## 主单轨迹对照:", main)
    print(route_full(main))
