r"""
RPACN01_07 质量下载图纸 — Prefect Job 包装（不修改原脚本）

将 RPACN01_07_downloadfile.py 的 main() 流程拆成 Prefect 任务编排：
  1. prepare        清理进程 + 读取 Config_download.xlsx + 初始化日志
  2. fetch_polist   Exchange 收取当天 po_list 附件
  3. process_excel  清洗 po_list（14/30 天窗口、剔除 X/L/S 等）
  4. sap_download   SAP GUI 批量下载图纸 + 更新汇总表 + Z01P 邮件
  5. notify_done    发送完成通知邮件

Usage (复制整个 RPA01_07 目录到 Worker 后执行一次注册):
    C:\RPA-Agent\.venv\Scripts\python.exe RPACN01_07_downloadfile_flow.py

注册成功后:
    Prefect UI (http://10.86.180.120:4200) → Deployments → rpacn01-07-downloadfile/rpacn01-07 → Run

前提（重要）:
    - 必须跑在 GUI 模式的 Windows Worker 上（windows-gui-pool，用 convert-to-gui-mode.ps1 切换）
    - 该 Worker 需要交互桌面会话（自动登录 + 计划任务模式，不能是 Session 0 服务模式）：
      SAP GUI Scripting 依赖真实桌面
    - SAP Logon 已安装且开启 Scripting；Chrome 已安装
    - 01_Conf/Config_download.xlsx 配置完整（邮箱、SAP 账号、路径等）
    - 依赖包安装到 Worker venv:
      pip install pywin32 wmi psutil pytz pandas openpyxl exchangelib selenium pycryptodome
"""

import sys
from datetime import datetime
from pathlib import Path

import pythoncom
from prefect import flow, task, get_run_logger
from prefect.concurrency.sync import concurrency
from prefect.flows import Flow

FLOWS_DIR = Path(__file__).parent.resolve()
sys.path.insert(0, str(FLOWS_DIR))

WORK_POOL = "windows-gui-pool"  # GUI 专用池：只有自动登录+不锁屏的 Worker 监听

# 导入原脚本作为模块（仅执行 import，不会触发业务逻辑）
import RPACN01_07_downloadfile as job


@task(name="prepare")
def prepare():
    """清理残留进程 + 加载配置 + 初始化文件日志。"""
    # Prefect 任务跑在工作线程里，WMI/win32com 需要先初始化 COM
    pythoncom.CoInitialize()
    logger = get_run_logger()
    logger.info(f"基础路径: {job.get_base_path()}")
    job.ensure_working_dir()
    job.kill_excel_processes()
    job.kill_sap()
    job.config()
    job.logging_info()
    logger.info("配置加载完成: Config_download.xlsx")


@task(name="fetch-polist", retries=1, retry_delay_seconds=60)
def fetch_polist():
    """从 Exchange 收件箱下载当天的 po_list 附件。"""
    logger = get_run_logger()
    job.download_file(job.Config['Password'], job.Config['Email_name'], job.Config['Email_server'])
    logger.info("po_list 附件下载完成")


@task(name="process-excel")
def process_excel():
    """清洗 po_list Excel（日期窗口筛选、剔除已完成/删除标记等）。"""
    logger = get_run_logger()
    job.excel_change()
    logger.info("po_list 清洗完成")


@task(name="sap-download", timeout_seconds=4 * 3600)
def sap_download():
    """SAP GUI 批量下载图纸（核心步骤，需交互桌面会话）。"""
    pythoncom.CoInitialize()
    logger = get_run_logger()
    # 全局锁 sap-gui（容量 1）: 3 台 Worker 上所有 SAP job 互斥，
    # 拿不到锁就在此阻塞等待；非 SAP job 不受影响。
    # 锁需先创建: prefect global-concurrency-limit create sap-gui --limit 1
    logger.info("等待 SAP 全局锁 (sap-gui)...")
    with concurrency("sap-gui", occupy=1):
        logger.info("已获得 SAP 锁，开始下载")
        try:
            job.read_excel()
            logger.info("SAP 图纸下载流程完成")
        finally:
            # 无论成败都清理 SAP 进程，避免残留影响下次运行
            try:
                job.kill_sap()
            except Exception as e:
                logger.warning(f"清理 SAP 进程失败: {e}")


@task(name="notify-done")
def notify_done():
    """发送运行完成通知邮件。"""
    logger = get_run_logger()
    job.send_email(
        subject='RPACN01_07' + str(datetime.now()) + '质量下载图纸运行完成',
        body=job.Config['Body_name_end'],
        to_email=job.receiver(),
        username=job.Config['Email_name'],
        password=job.Config['Password'],
        exchange_server=job.Config['Email_server'],
        email_address=job.Config['Email_name'],
        attachment_path='',
    )
    logger.info("完成通知邮件已发送")


def _run_name() -> str:
    return f"rpacn01-07-{datetime.now():%m%d-%H%M%S}"


@flow(name="rpacn01-07-downloadfile", flow_run_name=_run_name, log_prints=True)
def rpacn01_07_flow():
    """RPACN01_07 质量下载图纸完整流程。"""
    prepare()
    fetch_polist()
    process_excel()
    sap_download()
    notify_done()
    return "completed"


def deploy():
    Flow.from_source(
        source=str(FLOWS_DIR),
        entrypoint="RPACN01_07_downloadfile_flow.py:rpacn01_07_flow",
    ).deploy(
        name="rpacn01-07",
        work_pool_name=WORK_POOL,
        tags=["rpa", "sap", "quality", "drawing"],
    )
    print("Deployed: rpacn01-07-downloadfile/rpacn01-07")
    print(f"Work pool: {WORK_POOL}")
    print(f"Code path: {FLOWS_DIR}")
    print("Trigger it from Prefect UI -> Deployments -> rpacn01-07 -> Run")


if __name__ == "__main__":
    deploy()
