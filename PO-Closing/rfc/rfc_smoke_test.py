#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""rfc_smoke_test.py — RFC 连通性冒烟测试（不依赖业务函数）。

用途：SAP 侧自定义函数还没建好时，先用已有函数验证 网络/账号/权限 链路。

用法（服务器 po-closing 目录下）：
  sudo bash -c 'set -a; . ./.env; set +a; venv/bin/python rfc/rfc_smoke_test.py'
      默认调 Z_OA_GET_MATDATA I_MATNR=945120
  自定义：... rfc/rfc_smoke_test.py <函数名> <参数=值> ...
      例：... rfc/rfc_smoke_test.py Z_OA_GET_MATDATA I_MATNR=000000000000945120
参数名不确定时随便填一个，调用失败后脚本会自动打印函数的真实参数签名。
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


def show_interface(conn, fm):
    """打印函数的参数签名（导入/导出/表），用于修正参数名。"""
    try:
        desc = conn.call("RFC_FUNCTION_DESCRIBE", FUNCNAME=fm.upper())
    except Exception as exc:
        print("[warn] 无法获取函数签名: %s" % exc)
        return
    kind = {"I": "导入", "E": "导出", "C": "双向", "T": "表"}
    print("[info] %s 参数签名：" % fm.upper())
    for p in desc.get("PARAMETERS", []):
        print("  %-24s %-4s 参考:%s" % (p.get("PARAMETER", ""),
              kind.get(p.get("PARAMTYPE", ""), p.get("PARAMTYPE", "")),
              p.get("TABNAME", "") or p.get("TYP", "")))


def main():
    fm = sys.argv[1] if len(sys.argv) > 1 else "Z_OA_GET_MATDATA"
    params = {}
    for kv in sys.argv[2:]:
        k, _, v = kv.partition("=")
        params[k.strip().upper()] = v
    if not params and fm == "Z_OA_GET_MATDATA":
        params = {"I_MATNR": "945120"}

    conn = connect()
    print("[ok] RFC 连接成功: %s sysnr=%s client=%s user=%s lang=%s"
          % (os.environ["SAP_ASHOST"], os.getenv("SAP_SYSNR", "00"),
             os.getenv("SAP_CLIENT", "100"), os.environ["SAP_RFC_USER"],
             os.getenv("SAP_LANG", "ZH")))
    print("[..] 调用 %s %s" % (fm.upper(), params))
    try:
        res = conn.call(fm, **params)
    except Exception as exc:
        print("[fail] 调用失败: %s" % exc)
        show_interface(conn, fm)
        sys.exit(2)
    print("[ok] 调用成功，返回：")
    for key, val in res.items():
        if isinstance(val, list):
            print("  %s: 表，%d 行" % (key, len(val)))
            for row in val[:3]:
                print("    %s" % row)
        else:
            print("  %s: %s" % (key, val))
    if not any(res.values()):
        print("  （返回为空——物料号可能需要 18 位前导零：000000000000945120）")


if __name__ == "__main__":
    main()
