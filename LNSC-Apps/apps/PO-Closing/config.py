# -*- coding: utf-8 -*-
"""集中配置：全部可用环境变量覆盖，默认值适合本机演示（mock 数据源 + 通知演练）。"""
import os

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

# ---- 服务 ----
HOST = os.getenv("POCLOSE_HOST", "127.0.0.1")      # 默认仅本机；经 nginx 反代对外，勿直接改 0.0.0.0
PORT = int(os.getenv("POCLOSE_PORT", "8088"))
MAX_BODY_BYTES = int(os.getenv("POCLOSE_MAX_BODY", str(1024 * 1024)))   # POST 请求体上限 1MB
MAX_PO_PER_QUERY = int(os.getenv("POCLOSE_MAX_PO", "20000"))            # 单次 PO 数量上限

# ---- 数据源：mock（内置演示）/ csv（读取 RFC 结果文件）/ rfc（设备上直连 SAP）----
DATA_SOURCE = os.getenv("POCLOSE_DATA_SOURCE", "mock")
CSV_PATH = os.getenv("POCLOSE_CSV", os.path.join(BASE_DIR, "result.csv"))
RFC_SCRIPT = os.getenv("POCLOSE_RFC_SCRIPT",
                       os.path.normpath(os.path.join(BASE_DIR, "rfc", "po_gr_check.py")))

# ---- 存储 ----
DB_PATH = os.getenv("POCLOSE_DB", os.path.join(BASE_DIR, "poclose.db"))

# ---- 通知（仅内部：写入 SQLite 通知日志 + 服务端控制台，零外部通信）----
NOTIFY_EMAILS = []   # 接收人仅作登记展示，由页面「设置」维护（存 SQLite，重启保持）

# ---- 发票清单目录（Web 页面与定时核查的输入来源，读取其中全部 *.csv 合并）----
INVOICE_DIR = os.getenv("POCLOSE_INVOICE_DIR",
                        os.path.normpath(os.path.join(BASE_DIR, "invoice")))

# ---- 定时核查（默认每天 03:33 与 12:33 定点执行；逗号分隔多个 HH:MM，置空关闭）----
SCHEDULE_TIMES = [t.strip() for t in os.getenv("POCLOSE_SCHEDULE_TIMES", "03:33,12:33").split(",") if t.strip()]
SCHEDULE_NOTIFY = os.getenv("POCLOSE_SCHEDULE_NOTIFY", "0") == "1"   # 定时核查后是否自动推送通知
