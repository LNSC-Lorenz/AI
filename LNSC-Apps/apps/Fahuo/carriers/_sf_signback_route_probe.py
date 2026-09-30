#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""顺丰回签单落地探针（2026-09-23 用户报障：面单印了回签单号，收方快递员终端却无回单任务）
   在服务器上跑（stdin 管道 + systemd 同款 carriers.env）：
   ① 回单运单（type=3，SF1064 号段）自身轨迹查询——有节点=回单流程真实存在；
   ② EXP_RECE_SEARCH_ORDER_RESP 按运单号回显——看顺丰登记的增值服务/isSignBack 痕迹。
   Get-Content 本文件 -Raw | ssh <host> "sudo bash -c 'set -a; . <app>/carriers.env; cd <app>; python3 -'" """
import json
import sys

sys.path.insert(0, "/var/www/lnsc-apps/apps/fahuo")
from carriers import base, sf_express  # noqa: E402

cfg = base.get_cfg("SF")
# 服务器 carriers.env 为 CRLF，source 后值可能带 \r → 统一清洗，防签名/权限误判
cfg = {k: str(v).strip() for k, v in cfg.items()}
print("configured:", base.configured(cfg))

# 已签收主单对应的回单运单（订单517/511）+ 在途（订单540）
print("== ① 回单运单轨迹 ==")
for wb in ("SF5153232271309",      # 对照组：主运单（已签收）——平台路由刷新即此接口，应成功
           "SF1064992503878", "SF1064991693068", "SF1064996199611"):
    try:
        r = sf_express.query_route(wb, cfg)
        det = r.get("detail") or []
        print(" ", wb, "→", r.get("route_status"), "| 节点:",
              [(d.get("acceptTime"), d.get("remark") or d.get("acceptAddress")) for d in det])
    except Exception as e:
        print(" ", wb, "ERR", str(e)[:200])

print("== ② 订单回显（主运单号查询）==")
for wb in ("SF5153232271309", "SF1221675024412"):
    for key in ("trackingNumber", "waybillNo"):
        try:
            r = sf_express._call(cfg, "EXP_RECE_SEARCH_ORDER_RESP", {"searchType": "2", key: wb})
            s = json.dumps(r, ensure_ascii=False)
            print(" ", wb, "via", key, "→", s[:1000])
            break
        except Exception as e:
            print(" ", wb, "via", key, "ERR", str(e)[:150])
