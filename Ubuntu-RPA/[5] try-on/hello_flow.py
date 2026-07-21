"""
Hello Flow - 首次部署验证用
最简单的 Prefect Flow：输出主机信息 + 简单计算，验证 Server/Worker 链路是否打通。

Usage (在 Worker 机器上执行):
    python hello_flow.py            # 本地直接运行测试
    python deploy_hello.py          # 注册到 Prefect Server
"""

import platform
import socket
from datetime import datetime

from prefect import flow, task, get_run_logger


@task
def collect_host_info() -> dict:
    """收集当前 Worker 主机信息，验证任务在哪台机器执行。"""
    logger = get_run_logger()
    info = {
        "hostname": socket.gethostname(),
        "os": platform.system(),
        "os_version": platform.version(),
        "python": platform.python_version(),
        "time": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
    }
    logger.info(f"Host info: {info}")
    return info


@task
def add_numbers(a: int, b: int) -> int:
    """简单计算任务，验证参数传递。"""
    logger = get_run_logger()
    result = a + b
    logger.info(f"{a} + {b} = {result}")
    return result


@flow(name="hello-flow", log_prints=True)
def hello_flow(a: int = 1, b: int = 2):
    """首次部署验证 Flow：主机信息 + 加法。"""
    info = collect_host_info()
    result = add_numbers(a, b)
    print(f"Hello from {info['hostname']} ({info['os']}), {a} + {b} = {result}")
    return {"host": info, "result": result}


if __name__ == "__main__":
    # 本地直接运行测试（不经过 Server）
    hello_flow()
