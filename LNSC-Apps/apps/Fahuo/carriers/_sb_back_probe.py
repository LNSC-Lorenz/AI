#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""签回单（回单联）云打印报文形态探针（2026-10-08 官方文档 + 顺丰客服确认）。

背景：官方《打印》文档与顺丰客服确认——`documents[]` 三个单号字段按单据类型**择一**：
    masterWaybillNo  母运单（主面单）
    branchWaybillNo  子运单（子件面单）
    backWaybillNo    签回单 —— **打印签回单时 masterWaybillNo 和 branchWaybillNo 必须为空**
此前本平台把 SF106 回单号塞进 `masterWaybillNo`，恒得 1 页**正向**"POD标快"签收联
（寄=莱克勒/收=客户/寄付月结），不是用户要的反向回签单 → 追加出纸已撤回（2026-09-30）。

本探针同单对照三种报文形态（**只读**：不下单、不改单、不耗运单、不产生费用）：
    A) documents=[{masterWaybillNo: 回单号}]                       ← 旧形态（基线）
    B) documents=[{backWaybillNo:   回单号}]                       ← 文档口径：签回单
    C) documents=[{masterWaybillNo: 主单号}, {backWaybillNo: 回单号}]  ← 文档"报文2"示例：一次出两联
逐页提取 PDF 文本，按特征判定：
    反向回签单 → 收件人=莱克勒/德城路99号、寄件人=客户、运费到付、票面回链原主单号
    正向 POD 联 → 寄件人=莱克勒、收件人=客户、寄付月结（与主面单同收件人、不同单号）

用法（服务器，在 /var/www/lnsc-apps/apps/fahuo 或任意目录均可）：
    python3 _sb_back_probe.py                 # 自动取库里最新一单含回单号的订单
    python3 _sb_back_probe.py <主单号> <回单号>
"""
import json
import os
import sqlite3
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
PAGE_CHARS = 1500   # 每页文本打印上限（2026-09-29 教训：600 字符会截断第 2 页关键行）


def pick_from_db():
    """库里找最新一单含 order_resp.sign_back_no 的订单 → (主单号, 回单号)"""
    c = sqlite3.connect(os.path.join(BASE, "fahuo.db"))
    c.row_factory = sqlite3.Row
    for r in c.execute("select id, waybill_no, order_resp from orders"
                       " order by id desc limit 500"):
        try:
            d = json.loads(r["order_resp"] or "{}")
        except Exception:
            continue
        if d.get("sign_back_no"):
            return r["id"], r["waybill_no"], d["sign_back_no"]
    raise SystemExit("库中未找到含 order_resp.sign_back_no 的订单，请显式传 <主单号> <回单号>")


def submit(docs, tag):
    """按给定 documents 数组调云打印 → (files, raw)；失败返回 ([], {err})。
    A/B 用例直接走**生产函数**（cloud_print / cloud_print_back），确保探针即生产报文；
    C 用例是文档"报文2"示例（生产不采用），保留裸 _call 构造。"""
    try:
        if tag == "A":
            d = sf_express.cloud_print(docs[0]["masterWaybillNo"], cfg)
        elif tag == "B":
            d = sf_express.cloud_print_back(docs[0]["backWaybillNo"], cfg)
        else:
            d = sf_express._call(cfg, sf_express.SERVICE_PRINT, {
                "templateCode": sf_express._TEMPLATE,   # fm_76130_standard_LKLPZA6VYES4
                "version": "2.0",
                "fileType": "pdf",
                "sync": True,
                "documents": docs,
            }, timeout=30)
    except Exception as e:
        return [], {"err": "%r" % e}
    files = (d.get("obj") or {}).get("files") or []
    return files, d


def dump(files, tag):
    """下载每个 file 的 PDF → 逐页文本 + 关键特征行"""
    from pypdf import PdfReader
    if not files:
        print("  (无 files 返回)")
        return
    for i, f in enumerate(files):
        try:
            req = urllib.request.Request(f["url"], headers={"X-Auth-Token": f.get("token") or ""})
            raw = urllib.request.urlopen(req, timeout=30).read()
        except Exception as e:
            print("  file%d 下载失败：%r" % (i, e))
            continue
        p = "/tmp/_sbback_%s_%d.pdf" % (tag, i)
        open(p, "wb").write(raw)
        r = PdfReader(p)
        print("  file%d waybillNo=%s bytes=%d pages=%d → %s"
              % (i, f.get("waybillNo") or f.get("waybillNo_") or "-", len(raw), len(r.pages), p))
        for j, pg in enumerate(r.pages):
            t = (pg.extract_text() or "").strip()
            print("    ---- page %d (%d chars) ----" % (j + 1, len(t)))
            print("    " + t[:PAGE_CHARS].replace("\n", "\n    "))
            # 流向判定：反向回签单 = 票面出现莱克勒本部到方地址；正向 POD 联 = 出现在寄件人侧
            mark = []
            if "德城路99号" in t:
                mark.append("含『德城路99号』")
            if "范蓓蓓" in t:
                mark.append("含『范蓓蓓』")
            if "到付" in t:
                mark.append("含『到付』")
            if mark:
                print("    >> 特征：" + "、".join(mark))


def main():
    if len(sys.argv) >= 3:
        main_no, sb_no = sys.argv[1], sys.argv[2]
        oid = "-"
    else:
        oid, main_no, sb_no = pick_from_db()
    print("=" * 74)
    print("order#%s 主单=%s 回单(SF106)=%s  template=%s" % (oid, main_no, sb_no, sf_express._TEMPLATE))
    print("=" * 74)

    cases = [
        ("A 旧形态 masterWaybillNo=回单号（生产 cloud_print）", "A", [{"masterWaybillNo": sb_no}]),
        ("B 文档口径 backWaybillNo=回单号（生产 cloud_print_back）", "B", [{"backWaybillNo": sb_no}]),
    ]
    if main_no:
        cases.append(("C 文档报文2示例 主单+回单（裸报文对照）", "C",
                      [{"masterWaybillNo": main_no}, {"backWaybillNo": sb_no}]))
    for title, tag, docs in cases:
        print("\n######## %s" % title)
        print("  documents=%s" % json.dumps(docs, ensure_ascii=False))
        files, raw = submit(docs, tag)
        if not files:
            print("  !! 无 files，raw=%s" % json.dumps(raw, ensure_ascii=False)[:600])
            continue
        dump(files, tag)


if __name__ == "__main__":
    main()