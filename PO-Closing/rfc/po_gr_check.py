#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
po_gr_check.py — PO 收货状态批量查询（pyrfc → Z_OA_GET_POGR_STATUS，OA 侧交付）

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
    "user": os.getenv("SAP_RFC_USER", "RFC_PO_QUERY"),
    "passwd": os.getenv("SAP_RFC_PASS", "CHANGE_ME"),
    "lang": os.getenv("SAP_LANG", "ZH"),   # 目标系统未装中文语言包时报语言错误，改 SAP_LANG=EN
}

BATCH_SIZE = 5000      # 与函数设计约定：每批 <= 5000
RETRY = 3              # 单批失败重试次数
RETRY_WAIT = 5         # 重试间隔秒

FIELDS = [
    "EBELN", "EBELP", "MATNR", "WERKS", "RETPO",
    "ORDER_QTY", "MEINS", "NET_GR_QTY", "DIFF_QTY",
    "UNTTO", "UEBTO", "ELIKZ", "EREKZ", "LOEKZ",
    "CAN_CLOSE", "SUGGEST",
    "GR_STATUS", "GR_STATUS_TEXT", "GR_DOCS",
]

# 实际交付的函数（OA 侧业务接口，2026-08）：Z_OA_GET_POGR_STATUS
# 输入 IT_EBELN（EBELN 清单）；输出 EV_STATUS(S/W/E) + EV_MESSAGE + 明细表
FM_NAME = os.getenv("SAP_FM", "Z_OA_GET_POGR_STATUS")


def _strip0(s):
    """纯数字物料号去前导零（SAP 显示惯例）；含字母的保持原样。"""
    s = str(s or "").strip()
    if s.isdigit():
        return s.lstrip("0") or "0"
    return s


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
            return conn.call(FM_NAME, IT_EBELN=payload)
        except Exception as err:  # pyrfc.CommunicationError / ABAPApplicationError 等
            last_err = err
            print(f"  [retry {attempt}/{RETRY}] {err}", file=sys.stderr)
            time.sleep(RETRY_WAIT)
    raise last_err


def extract_result(res):
    """从返回 dict 提取 状态/消息/明细表（明细表名未在文档中给出，自动识别唯一的 list 参数）。"""
    table = []
    for _, v in res.items():
        if isinstance(v, list):
            table = v
            break
    return (str(res.get("EV_STATUS") or "S"),
            str(res.get("EV_MESSAGE") or ""), table)


GR2SUGGEST = {"0": "NO_GR", "1": "PARTIAL_GR", "2": "CLOSABLE"}   # SAP 口径：0未收/1部分/2完成


def map_rows(raw_rows):
    """明细（订单行 × 物料凭证行）→ 订单行粒度。

    头部字段（PO_MENGE/GR_MENGE/GR_STATUS）在各凭证行重复，取首行（绝不 sum，否则数量翻倍）；
    凭证明细收进 GR_DOCS（JSON）供前端下钻；GR_STATUS 透传，判定以 SAP 口径为准。"""
    lines, order = {}, []
    for r in raw_rows:
        ebeln = str(r.get("EBELN") or "").strip().lstrip("0") or "0"   # 前导零归一
        ebelp = str(r.get("EBELP") or "").strip()
        key = (ebeln, ebelp)
        if key not in lines:
            order.append(key)
            lines[key] = {
                "EBELN": ebeln, "EBELP": ebelp,
                "MATNR": _strip0(r.get("MATNR")),
                "WERKS": "", "RETPO": "",
                "ORDER_QTY": float(r.get("PO_MENGE") or 0),
                "MEINS": str(r.get("MEINS") or "").strip(),
                "NET_GR_QTY": float(r.get("GR_MENGE") or 0),
                "DIFF_QTY": "", "UNTTO": "0", "UEBTO": "",
                "ELIKZ": "", "EREKZ": "", "LOEKZ": "",
                "CAN_CLOSE": "", "SUGGEST": GR2SUGGEST.get(str(r.get("GR_STATUS") or "").strip(), "NO_GR"),
                "GR_STATUS": str(r.get("GR_STATUS") or "").strip(),
                "GR_STATUS_TEXT": str(r.get("GR_STATUS_TEXT") or "").strip(),
                "_docs": [],
            }
        if r.get("MBLNR"):
            lines[key]["_docs"].append({
                "MBLNR": str(r.get("MBLNR") or ""), "MJAHR": str(r.get("MJAHR") or ""),
                "ZEILE": str(r.get("ZEILE") or ""),
                "DOC_MENGE": float(r.get("DOC_MENGE") or 0),
                "BLDAT": str(r.get("BLDAT") or ""), "BUDAT": str(r.get("BUDAT") or ""),
            })
    out = []
    for key in order:
        ln = lines[key]
        ln["GR_DOCS"] = json.dumps(ln.pop("_docs"), ensure_ascii=False, separators=(",", ":"))
        out.append(ln)
    return out


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

    results = []
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
            status, message, table = extract_result(res)
            if status == "E":   # 输入或处理失败（如空清单）
                print(f"接口返回错误: {message}", file=sys.stderr)
                _write_csv(args.outfile, results)
                sys.exit(2)
            if message:
                print(f"  [{status}] {message}", file=sys.stderr)
            results.extend(map_rows(table))
            time.sleep(0.2)  # 温和节流，避免连续压 RFC
    finally:
        conn.close()

    _write_csv(args.outfile, results)

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
