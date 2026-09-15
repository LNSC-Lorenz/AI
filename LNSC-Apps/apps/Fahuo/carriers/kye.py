# -*- coding: utf-8 -*-
"""跨越速运开放平台
真实对接步骤同顺丰：申请密钥 → 填 carriers.env 的 KY_* → 完成 _real_* 字段映射。
未配置密钥前自动返回演示数据。"""
from . import base

NAME = "跨越"
_PREFIX = "KY"
_ENDPOINT = "https://open.ky-express.com"   # TODO: 跨越生产地址（以开放平台文档为准）


def place_order(order, cfg=None):
    cfg = cfg or base.get_cfg("KY")
    if not base.configured(cfg):
        raise base.CarrierError("跨越未配置密钥：请在 carriers.env 配置 KY_APP_KEY/KY_APP_SECRET")
    return _real_place_order(order, cfg)


def query_route(waybill_no, cfg=None):
    cfg = cfg or base.get_cfg("KY")
    if not base.configured(cfg):
        raise base.CarrierError("跨越未配置密钥，无法查询轨迹")
    return _real_query_route(waybill_no, cfg)


def _real_place_order(order, cfg):
    # TODO(跨越)：按其下单接口文档组报文并签名
    raise base.CarrierError("跨越真实下单未启用：请先在 carriers/ky.py 完成字段映射")


def _real_query_route(waybill_no, cfg):
    # TODO(跨越)：按其轨迹查询接口实现
    raise base.CarrierError("跨越轨迹查询未启用：请先在 carriers/ky.py 完成字段映射")
