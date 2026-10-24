#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
order_mat_check.py — 工单物料批量查询（pyrfc → Z_OA_GET_ORDERMAT_ORDERNR，OA 侧交付）

运行环境 : 独立 Ubuntu 设备（已部署 SAP NW RFC SDK，SAPNWRFC_HOME 已设置）
依赖     : pip install pyrfc==3.3.1   # 在设备上执行；Linux 为源码构建，依赖 SDK
用法     : python3 order_mat_check.py orders.csv result.csv [--json result.json]
输入     : CSV 第 1 列为工单号（自动跳过表头/空行/非数字行）
输出     : UTF-8-SIG CSV（Excel 可直接打开）；--json 供 Web API 消费（server.js）

连接参数 : 优先读环境变量 SAP_ASHOST / SAP_SYSNR / SAP_CLIENT / SAP_RFC_USER / SAP_RFC_PASS
退出码   : 0=全部查询成功  1=参数/输入错误  2=RFC 连接失败（已查到的结果仍落盘）
           （单个工单失败不中断，记入该行 ERROR 列）

接口签名（2026-10 实测，经 FUPARAREF 元数据确认，RFC_FUNCTION_DESCRIBE 在本系统被禁）：
  导入 I_ORDERNO（ZZORDERNR，单工单号，无前导零）→ 导出 E_ORDER（ZTS_STRUCT_ORDER）：
  AUFNR 工单号 / PLNBEZ 物料号 / MAKTX 物料描述 / BMEINS 基本单位 / GAMNG 工单数量 /
  EBELN+EBELP 采购订单+行项目 / BANFN 采购申请 / LIFNR+NAME1 供应商 / TXZ01 短文本
  （GAMNG 为 2026-10-16 OA 侧应要求新增；生产订单采购类字段为空属正常；查无此单时 E_ORDER 全空）
"""
import argparse
import csv
import json
import os
import sys
import time

from pyrfc import Connection  # noqa: F401  仅设备端需要，本机开发不安装


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


if "SAP_ASHOST" not in os.environ:   # 直接运行时自动加载主配置 ../.env（systemd 注入则跳过）
    _load_env_file(os.path.join(os.path.dirname(os.path.abspath(__file__)), os.pardir, ".env"))

SAP_CONN = {
    "ashost": os.getenv("SAP_ASHOST", "sap.example.com"),
    "sysnr": os.getenv("SAP_SYSNR", "00"),
    "client": os.getenv("SAP_CLIENT", "100"),
    "user": os.getenv("SAP_RFC_USER", "RFC_QUERY"),
    "passwd": os.getenv("SAP_RFC_PASS", "CHANGE_ME"),
    "lang": os.getenv("SAP_LANG", "ZH"),   # 目标系统未装中文语言包时报语言错误，改 SAP_LANG=EN
}

RETRY = 3              # 单工单失败重试次数
RETRY_WAIT = 5         # 重试间隔秒
THROTTLE = 0.1         # 单工单间隔秒（接口为单条查询，温和节流）

FIELDS = [
    "AUFNR", "PLNBEZ", "MAKTX", "BMEINS", "GAMNG",
    "EBELN", "EBELP", "BANFN", "LIFNR", "NAME1", "TXZ01",
    "FOUND", "ERROR",
]

FM_NAME = os.getenv("SAP_FM_ORDER", "Z_OA_GET_ORDERMAT_ORDERNR")
IN_PARAM = os.getenv("SAP_ORDER_PARAM", "I_ORDERNO")   # 导入参数名（实测确认）


def _strip0(s):
    """纯数字物料号去前导零（SAP 显示惯例）；含字母的保持原样。"""
    s = str(s or "").strip()
    if s.isdigit():
        return s.lstrip("0") or "0"
    return s


def load_orders(path):
    """读取工单清单：第 1 列，跳过表头与非法行，去重保序。"""
    seen, orders = set(), []
    with open(path, newline="", encoding="utf-8-sig") as f:
        for row in csv.reader(f):
            if not row:
                continue
            no = row[0].strip()
            if no.isdigit() and no not in seen:
                seen.add(no)
                orders.append(no)
    return orders

def call_with_retry(conn, order_no):
    """调用 RFC 查单个工单，失败重试 RETRY 次；最终失败抛异常由上层处理。"""
    last_err = None
    for attempt in range(1, RETRY + 1):
        try:
            return conn.call(FM_NAME, **{IN_PARAM: order_no})
        except Exception as err:  # pyrfc.CommunicationError / ABAPApplicationError 等
            last_err = err
            print(f"  [retry {attempt}/{RETRY}] {err}", file=sys.stderr)
            time.sleep(RETRY_WAIT)
    raise last_err


def map_row(order_no, res):
    """E_ORDER 结构 → 输出行；AUFNR 为空 = 查无此单。"""
    e = res.get("E_ORDER") or {}
    aufnr = str(e.get("AUFNR") or "").strip()
    return {
        "AUFNR": aufnr or order_no,
        "PLNBEZ": _strip0(e.get("PLNBEZ")),
        "MAKTX": str(e.get("MAKTX") or "").strip(),
        "BMEINS": str(e.get("BMEINS") or "").strip(),
        "GAMNG": float(e.get("GAMNG") or 0),   # QUAN→Decimal，必须转 float 才能 json 序列化
        "EBELN": str(e.get("EBELN") or "").strip().lstrip("0"),
        "EBELP": str(e.get("EBELP") or "").strip(),
        "BANFN": str(e.get("BANFN") or "").strip(),
        "LIFNR": str(e.get("LIFNR") or "").strip().lstrip("0"),
        "NAME1": str(e.get("NAME1") or "").strip(),
        "TXZ01": str(e.get("TXZ01") or "").strip(),
        "FOUND": "X" if aufnr else "",
        "ERROR": "",
    }


def main():
    ap = argparse.ArgumentParser(description="工单物料批量查询（RFC → Z_OA_GET_ORDERMAT_ORDERNR）")
    ap.add_argument("infile", help="工单清单 CSV（第 1 列为工单号）")
    ap.add_argument("outfile", help="结果输出 CSV")
    ap.add_argument("--json", dest="jsonfile", default="",
                    help="可选：同时输出 JSON（供 Web API 消费）")
    args = ap.parse_args()

    if not os.path.isfile(args.infile):
        print(f"输入文件不存在: {args.infile}", file=sys.stderr)
        sys.exit(1)

    orders = load_orders(args.infile)
    if not orders:
        print("未读到有效工单号", file=sys.stderr)
        sys.exit(1)
    print(f"共 {len(orders)} 个工单")

    results = []
    conn = Connection(**SAP_CONN)
    try:
        for idx, no in enumerate(orders, 1):
            print(f"[{idx}/{len(orders)}] 工单 {no} ...")
            try:
                res = call_with_retry(conn, no)
                results.append(map_row(no, res))
            except Exception as err:   # 单工单失败不中断，记录后继续
                print(f"  工单 {no} 查询失败: {err}", file=sys.stderr)
                results.append({"AUFNR": no, "FOUND": "", "ERROR": str(err)[:200]})
            time.sleep(THROTTLE)
    except KeyboardInterrupt:
        print("中断，落盘已查结果", file=sys.stderr)
    finally:
        conn.close()

    _write_csv(args.outfile, results)
    if args.jsonfile:
        with open(args.jsonfile, "w", encoding="utf-8") as f:
            json.dump(results, f, ensure_ascii=False)

    found = sum(1 for r in results if r["FOUND"] == "X")
    failed = sum(1 for r in results if r["ERROR"])
    print(f"完成：{len(results)} 行 → {args.outfile}（查到 {found}，查无 {len(results) - found - failed}，失败 {failed}）")


def _write_csv(path, rows):
    with open(path, "w", newline="", encoding="utf-8-sig") as f:
        w = csv.DictWriter(f, fieldnames=FIELDS, extrasaction="ignore")
        w.writeheader()
        w.writerows(rows)


if __name__ == "__main__":
    main()
