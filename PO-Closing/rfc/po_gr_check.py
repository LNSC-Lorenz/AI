#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
po_gr_check.py — PO 收货状态批量查询（pyrfc → Z_RFC_PO_GR_STATUS）

运行环境 : 独立 Ubuntu 设备（已部署 SAP NW RFC SDK，SAPNWRFC_HOME 已设置）
依赖     : pip install pyrfc        # 在设备上执行；Linux 为源码构建，依赖 SDK
用法     : python3 po_gr_check.py po_list.csv result.csv
输入     : CSV 第 1 列为 PO 号（自动跳过表头/空行/非数字行）
输出     : UTF-8-SIG CSV（Excel 可直接打开），含 CAN_CLOSE 判定与 SUGGEST 建议

连接参数 : 优先读环境变量 SAP_ASHOST / SAP_SYSNR / SAP_CLIENT / SAP_RFC_USER / SAP_RFC_PASS
退出码   : 0=成功  1=参数/输入错误  2=RFC 调用失败（已处理批次已落盘）
"""
import argparse
import csv
import os
import sys
import time

from pyrfc import Connection  # noqa: F401  仅设备端需要，本机开发不安装

SAP_CONN = {
    "ashost": os.getenv("SAP_ASHOST", "sap.example.com"),
    "sysnr": os.getenv("SAP_SYSNR", "00"),
    "client": os.getenv("SAP_CLIENT", "100"),
    "user": os.getenv("SAP_RFC_USER", "RFC_PO_QUERY"),
    "passwd": os.getenv("SAP_RFC_PASS", "CHANGE_ME"),
    "lang": "ZH",
}

BATCH_SIZE = 5000      # 与函数设计约定：每批 <= 5000
RETRY = 3              # 单批失败重试次数
RETRY_WAIT = 5         # 重试间隔秒

FIELDS = [
    "EBELN", "EBELP", "MATNR", "WERKS", "RETPO",
    "ORDER_QTY", "MEINS", "NET_GR_QTY", "DIFF_QTY",
    "UNTTO", "UEBTO", "ELIKZ", "EREKZ", "LOEKZ",
    "CAN_CLOSE", "SUGGEST",
]


def load_pos(path):
    """读取 PO 清单：第 1 列，跳过表头与非法行，去重保序。"""
    seen, pos = set(), []
    with open(path, newline="", encoding="utf-8-sig") as f:
        for row in csv.reader(f):
            if not row:
                continue
            po = row[0].strip()
            if po.isdigit() and po not in seen:
                seen.add(po)
                pos.append(po)
    return pos


def batched(seq, size):
    for i in range(0, len(seq), size):
        yield seq[i:i + size]


def call_with_retry(conn, chunk):
    """调用 RFC，失败重试 RETRY 次；最终失败抛异常由上层处理。"""
    payload = [{"EBELN": p} for p in chunk]
    last_err = None
    for attempt in range(1, RETRY + 1):
        try:
            return conn.call("Z_RFC_PO_GR_STATUS", IT_EBELN=payload)
        except Exception as err:  # pyrfc.CommunicationError / ABAPApplicationError 等
            last_err = err
            print(f"  [retry {attempt}/{RETRY}] {err}", file=sys.stderr)
            time.sleep(RETRY_WAIT)
    raise last_err


def main():
    ap = argparse.ArgumentParser(description="PO 收货状态批量查询（RFC）")
    ap.add_argument("infile", help="PO 清单 CSV（第 1 列为 PO 号）")
    ap.add_argument("outfile", help="结果输出 CSV")
    args = ap.parse_args()

    if not os.path.isfile(args.infile):
        print(f"输入文件不存在: {args.infile}", file=sys.stderr)
        sys.exit(1)

    pos = load_pos(args.infile)
    if not pos:
        print("未读到有效 PO 号", file=sys.stderr)
        sys.exit(1)
    print(f"共 {len(pos)} 个 PO，分 {(len(pos) + BATCH_SIZE - 1) // BATCH_SIZE} 批")

    results, warnings = [], []
    conn = Connection(**SAP_CONN)
    try:
        for idx, chunk in enumerate(batched(pos, BATCH_SIZE), 1):
            print(f"批次 {idx}: {len(chunk)} 个 PO ...")
            try:
                res = call_with_retry(conn, chunk)
            except Exception as err:
                print(f"批次 {idx} 最终失败: {err}", file=sys.stderr)
                _write_csv(args.outfile, results)
                print(f"已落盘 {len(results)} 行（断点结果），退出码 2", file=sys.stderr)
                sys.exit(2)
            results.extend(res.get("ET_RESULT", []))
            warnings.extend(res.get("ET_RETURN", []))
            time.sleep(0.2)  # 温和节流，避免连续压 RFC
    finally:
        conn.close()

    _write_csv(args.outfile, results)

    for m in warnings:
        print(f"[{m.get('TYPE')}] {m.get('MESSAGE')}", file=sys.stderr)

    # 汇总统计
    stat = {}
    for r in results:
        stat[r["SUGGEST"]] = stat.get(r["SUGGEST"], 0) + 1
    print(f"完成：{len(results)} 行项目 → {args.outfile}")
    for k in ("CLOSABLE", "ALREADY_CLOSED", "PARTIAL_GR", "NO_GR", "DELETED"):
        if stat.get(k):
            print(f"  {k}: {stat[k]}")


def _write_csv(path, rows):
    with open(path, "w", newline="", encoding="utf-8-sig") as f:
        w = csv.DictWriter(f, fieldnames=FIELDS, extrasaction="ignore")
        w.writeheader()
        w.writerows(rows)


if __name__ == "__main__":
    main()
