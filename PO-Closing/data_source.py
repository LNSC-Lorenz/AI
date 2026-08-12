# -*- coding: utf-8 -*-
"""数据源适配层：统一输出 EKPO/EKBE 行项目原始字段，判定交给 matching.py。

mock : 内置演示数据（默认，零依赖，开箱即用，PO 号相同则结果恒定）
csv  : 读取 rfc/po_gr_check.py 产出的结果 CSV（路径由 POCLOSE_CSV 指定）
rfc  : 在已部署 SAP NW RFC SDK + pyrfc 的设备上，调用 rfc/po_gr_check.py 实时取数
"""
import csv
import hashlib
import os
import random
import subprocess
import sys
import tempfile

import config

RAW_FIELDS = ["EBELN", "EBELP", "MATNR", "WERKS", "ORDER_QTY", "MEINS",
              "NET_GR_QTY", "UNTTO", "ELIKZ", "EREKZ", "LOEKZ"]


def _read_csv(path, wanted):
    rows = []
    with open(path, newline="", encoding="utf-8-sig") as f:
        for row in csv.DictReader(f):
            if not wanted or row.get("EBELN", "").strip() in wanted:
                rows.append({k: row.get(k, "") for k in RAW_FIELDS})
    return rows


class MockSource:
    name = "mock"

    def fetch(self, po_list):
        rows = []
        for po in po_list:
            rng = random.Random(int(hashlib.md5(str(po).encode("utf-8")).hexdigest(), 16))
            for seq in range(1, rng.randint(1, 3) + 1):
                rows.append(self._item(po, seq * 10, rng))
        return rows

    @staticmethod
    def _item(po, ebelp, rng):
        qty = float(rng.choice([10, 20, 50, 100]))
        row = {
            "EBELN": str(po), "EBELP": "%05d" % ebelp,
            "MATNR": "MAT-%06d" % rng.randint(1, 999999),
            "WERKS": rng.choice(["1000", "1100", "2000"]),
            "ORDER_QTY": qty, "MEINS": "EA",
            "UNTTO": float(rng.choice([0, 5, 10])),
            "ELIKZ": "", "EREKZ": "", "LOEKZ": "",
        }
        roll = rng.random()
        if roll < 0.10:                       # 已删除
            row["LOEKZ"] = "L"
            row["NET_GR_QTY"] = 0.0
        elif roll < 0.30:                     # 已关闭
            row.update(NET_GR_QTY=qty, ELIKZ="X", EREKZ="X")
        elif roll < 0.60:                     # 可关单（收满未关）
            row["NET_GR_QTY"] = qty
        elif roll < 0.80:                     # 部分收货
            row["NET_GR_QTY"] = round(qty * rng.uniform(0.2, 0.7), 3)
        else:                                 # 未收货
            row["NET_GR_QTY"] = 0.0
        return row


class CsvSource:
    name = "csv"

    def fetch(self, po_list):
        if not os.path.isfile(config.CSV_PATH):
            raise RuntimeError("CSV 数据文件不存在: %s（先在设备上运行 rfc/po_gr_check.py 生成）"
                               % config.CSV_PATH)
        return _read_csv(config.CSV_PATH, set(po_list))


class RfcSource:
    name = "rfc"

    def fetch(self, po_list):
        if not os.path.isfile(config.RFC_SCRIPT):
            raise RuntimeError("RFC 脚本不存在: %s" % config.RFC_SCRIPT)
        with tempfile.TemporaryDirectory() as tmp:
            infile = os.path.join(tmp, "po_in.csv")
            outfile = os.path.join(tmp, "po_out.csv")
            with open(infile, "w", encoding="utf-8") as f:
                f.write("\n".join(str(p) for p in po_list))
            proc = subprocess.run([sys.executable, config.RFC_SCRIPT, infile, outfile],
                                  capture_output=True, text=True, timeout=600)
            if proc.returncode != 0 or not os.path.isfile(outfile):
                tail = (proc.stderr or proc.stdout or "")[-400:]
                raise RuntimeError("RFC 调用失败(exit=%s): %s" % (proc.returncode, tail))
            return _read_csv(outfile, set(po_list))


_SOURCES = {"mock": MockSource, "csv": CsvSource, "rfc": RfcSource}
_instance = None


def get_source():
    global _instance
    if _instance is None:
        cls = _SOURCES.get(config.DATA_SOURCE.lower())
        if cls is None:
            raise RuntimeError("未知数据源 POCLOSE_DATA_SOURCE=%s（可选 mock/csv/rfc）"
                               % config.DATA_SOURCE)
        _instance = cls()
    return _instance


def fetch_items(po_list):
    return get_source().fetch(po_list)
