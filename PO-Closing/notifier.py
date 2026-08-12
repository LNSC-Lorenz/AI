# -*- coding: utf-8 -*-
"""通知模块（仅内部）：汇总报告 → 写入 SQLite 通知日志 + 服务端控制台。

零外部通信：无 Webhook、无 SMTP，一切通知动作都发生在本机内部。
"""
from datetime import datetime

import config
import storage

_VERDICT_FLAG = {"PASS": "[已核对]", "FAIL": "[不通过]"}


def build_report(items, ver_map):
    """生成 Markdown 格式报告，返回 (title, content)。"""
    now = datetime.now().strftime("%Y-%m-%d %H:%M")
    closable = [i for i in items if i["SUGGEST"] == "CLOSABLE"]
    cnt = {s: 0 for s in ("CLOSABLE", "ALREADY_CLOSED", "PARTIAL_GR", "NO_GR", "DELETED")}
    for i in items:
        cnt[i["SUGGEST"]] = cnt.get(i["SUGGEST"], 0) + 1
    unverified = [i for i in closable
                  if not ver_map.get(i["EBELN"] + "|" + i["EBELP"])]

    title = "PO 关单核对提醒（%s）" % now
    lines = [
        "## PO 关单核对提醒",
        "> 时间：%s" % now,
        "",
        "- 行项目总数：%d" % len(items),
        "- **可关单：%d（其中未核对 %d）**" % (len(closable), len(unverified)),
        "- 已关闭 %d / 部分收货 %d / 未收货 %d / 已删除 %d"
        % (cnt["ALREADY_CLOSED"], cnt["PARTIAL_GR"], cnt["NO_GR"], cnt["DELETED"]),
        "",
        "### 可关单明细（前 20 条）",
    ]
    for i in closable[:20]:
        v = ver_map.get(i["EBELN"] + "|" + i["EBELP"])
        flag = _VERDICT_FLAG.get(v["verdict"], "[未核对]") if v else "[未核对]"
        lines.append("- `%s/%s` %s 订单 %g %s，已收 %g %s %s"
                     % (i["EBELN"], i["EBELP"], i.get("MATNR", ""),
                        i["ORDER_QTY"], i.get("MEINS", ""),
                        i["NET_GR_QTY"], i.get("MEINS", ""), flag))
    if len(closable) > 20:
        lines.append("- ……其余 %d 条略，详见平台" % (len(closable) - 20))
    if not closable:
        lines.append("- 暂无可关单行项目")
    lines += ["", "请登录 PO-Closing 平台核对处理。"]
    return title, "\n".join(lines)


def send(title, content):
    """内部通知：写入通知日志 + 服务端控制台输出。返回 {status, detail}。"""
    detail = "已写入内部通知日志"
    if config.NOTIFY_EMAILS:
        detail += "；登记接收人: %s" % ", ".join(config.NOTIFY_EMAILS)
    print("[notify] %s\n%s" % (title, content))
    storage.save_notify(title, content, "internal", "LOGGED", detail)
    return {"status": "LOGGED", "detail": detail}
