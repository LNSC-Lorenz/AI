#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""rfc_fm_params.py — 查询 SAP 函数的真实参数签名（RFC_FUNCTION_DESCRIBE 被禁时的替代方案）。

原理：函数参数元数据存在透明表 FUPARAREF，用 RFC_READ_TABLE 读取；
RFC_READ_TABLE 也不通则按常见命名候选逐个试调（rc=20 field not found = 名字不对）。

用法（服务器上）：
  sudo venv/bin/python rfc/rfc_fm_params.py Z_OA_GET_ORDERMAT_ORDERNR
"""
import os
import sys

from pyrfc import Connection


def _load_env_file(path):
    """直接解析 KEY=VALUE（不经 shell：密码含 $ ` 空格 等字符也不会被转义/展开；
    可选的首尾引号自动剥除）。"""
    try:
        with open(path, encoding="utf-8-sig") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, _, v = line.partition("=")
                v = v.strip()
                if len(v) >= 2 and v[0] == v[-1] and v[0] in "\"'":
                    v = v[1:-1]
                os.environ.setdefault(k.strip(), v)
    except OSError:
        pass


if "SAP_ASHOST" not in os.environ:   # 直接运行时自动加载主配置 ../.env
    _load_env_file(os.path.join(os.path.dirname(os.path.abspath(__file__)), os.pardir, ".env"))


def connect():
    return Connection(
        ashost=os.environ["SAP_ASHOST"],
        sysnr=os.getenv("SAP_SYSNR", "00"),
        client=os.getenv("SAP_CLIENT", "100"),
        user=os.environ["SAP_RFC_USER"],
        passwd=os.environ["SAP_RFC_PASS"],
        lang=os.getenv("SAP_LANG", "ZH"),
    )


PARAMTYPE = {"I": "导入", "E": "导出", "C": "双向", "T": "表"}


def params_via_fupararef(conn, fm):
    """RFC_READ_TABLE 读 FUPARAREF 拿参数清单。"""
    res = conn.call("RFC_READ_TABLE",
                    QUERY_TABLE="FUPARAREF",
                    DELIMITER="|",
                    FIELDS=[{"FIELDNAME": f} for f in
                            ("PARAMETER", "PARAMTYPE", "STRUCTURE", "DEFAULTVAL")],
                    OPTIONS=[{"TEXT": "FUNCNAME = '%s'" % fm.upper()}])
    rows = []
    for line in res.get("DATA", []):
        parts = line["WA"].split("|")
        rows.append(tuple(p.strip() for p in parts))
    return rows


CANDIDATES = [
    "I_AUFNR", "IV_AUFNR", "IM_AUFNR", "P_AUFNR", "AUFNR", "PA_AUFNR",
    "I_ORDER", "IV_ORDER", "I_ORDERNR", "IV_ORDERNR", "I_ORDER_NO",
    "IS_AUFK", "I_AUFK", "IT_AUFNR", "IT_ORDER", "IT_ORDERNR",
    "I_MATNR", "IV_MATNR", "I_EBELN", "IV_EBELN",
]


def probe(conn, fm):
    """逐个候选名试调；rc=20 field not found = 该名不存在，其余说明名字命中。"""
    hits = []
    for name in CANDIDATES:
        try:
            conn.call(fm, **{name: "1352095" if "AUFNR" in name or "ORDER" in name else ""})
            hits.append((name, "OK（调用成功，参数名命中）"))
        except Exception as exc:
            msg = str(exc)
            if "not found" in msg and name in msg:
                continue
            hits.append((name, "命中（报错已不再是参数名问题）: %s" % msg[:120]))
    return hits


def main():
    fm = (sys.argv[1] if len(sys.argv) > 1 else "Z_OA_GET_ORDERMAT_ORDERNR").upper()
    conn = connect()
    print("[ok] RFC 连接成功，查询 %s 的参数签名 ..." % fm)

    try:
        rows = params_via_fupararef(conn, fm)
        if rows:
            print("[ok] FUPARAREF 元数据：")
            for name, ptype, struct, default in rows:
                print("  %-20s %-4s 参考:%s %s" % (name, PARAMTYPE.get(ptype, ptype),
                                                    struct, ("默认:" + default) if default else ""))
            return
        print("[warn] FUPARAREF 无记录（函数名大小写？）")
    except Exception as exc:
        print("[warn] RFC_READ_TABLE 不可用: %s" % str(exc)[:150])

    print("[..] 退化为候选名试调 ...")
    hits = probe(conn, fm)
    if hits:
        for name, note in hits:
            print("  %-20s %s" % (name, note))
    else:
        print("  候选名全部不中，请找 Basis/OA 索取接口文档或用 SE37 查看签名")


if __name__ == "__main__":
    main()
