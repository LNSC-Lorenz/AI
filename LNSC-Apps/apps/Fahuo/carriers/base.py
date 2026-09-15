# -*- coding: utf-8 -*-
"""承运商对接公共件：HTTP 封装 / 签名工具 / 密钥配置读取 / 统一异常
零依赖（Python 标准库）；密钥经 systemd EnvironmentFile 注入进程环境，永不入库。"""
import base64
import hashlib
import hmac
import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request


class CarrierError(Exception):
    """承运商调用失败（含未配置密钥）：message 可直接回给前端展示"""


def get_cfg(prefix):
    """读取某承运商配置（前缀 SF/DB/KY，均为生产环境）；缺省时各值为空串"""
    return {
        "app_key": os.environ.get(prefix + "_APP_KEY", ""),
        "app_secret": os.environ.get(prefix + "_APP_SECRET", ""),
        "cust_code": os.environ.get(prefix + "_CUST_CODE", ""),
    }


def configured(cfg):
    """密钥是否已配置（未配置 → 走演示单号，不影响其他家）"""
    return bool(cfg.get("app_key") and cfg.get("app_secret"))


def http_post_json(url, payload, headers=None, timeout=10):
    """POST JSON → 解析响应 JSON；网络/HTTP 错误统一抛 CarrierError"""
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(url, data=data, method="POST")
    req.add_header("Content-Type", "application/json; charset=utf-8")
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        raise CarrierError("承运商接口 HTTP %s：%s" % (e.code, e.read()[:200]))
    except Exception as e:
        raise CarrierError("承运商接口不可达：%s" % e)


def http_post_form(url, form, timeout=10):
    """POST application/x-www-form-urlencoded → 解析响应 JSON（丰桥表单协议）
    form 的值需先整体序列化为字符串（如 msgData 为 JSON 字符串）"""
    data = urllib.parse.urlencode(form).encode("utf-8")
    req = urllib.request.Request(url, data=data, method="POST")
    req.add_header("Content-Type", "application/x-www-form-urlencoded;charset=UTF-8")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read().decode("utf-8", "replace"))
    except urllib.error.HTTPError as e:
        raise CarrierError("承运商接口 HTTP %s：%s" % (e.code, e.read()[:300]))
    except json.JSONDecodeError as e:
        raise CarrierError("承运商响应非 JSON：%s" % e)
    except Exception as e:
        raise CarrierError("承运商接口不可达：%s" % e)


def md5_b64(text):
    """丰桥签名：MD5(报文+密钥) → Base64"""
    return base64.b64encode(hashlib.md5(text.encode("utf-8")).digest()).decode()


def hmac_sha256_b64(secret, text):
    """通用 HMAC-SHA256 → Base64 签名"""
    return base64.b64encode(
        hmac.new(secret.encode("utf-8"), text.encode("utf-8"), hashlib.sha256).digest()
    ).decode()


def ts_ms():
    """毫秒时间戳（各平台通用请求字段）"""
    return str(int(time.time() * 1000))


def fetch_url_pdf_b64(url, token, timeout=30):
    """下载云打印返回的面单 URL → base64；校验 %PDF 魔数。
    token 非空才加 X-Auth-Token 头（顺丰需要；德邦为 OBS 预签名 URL，免 token）"""
    req = urllib.request.Request(url)
    if token:
        req.add_header("X-Auth-Token", token)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            body = r.read()
    except Exception as e:
        raise CarrierError("面单 PDF 下载失败：%s" % e)
    if not body.startswith(b"%PDF"):
        raise CarrierError("面单下载返回非 PDF（%d 字节）" % len(body))
    return base64.b64encode(body).decode("ascii")
