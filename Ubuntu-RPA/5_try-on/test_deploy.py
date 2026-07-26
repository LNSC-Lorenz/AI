r"""
首次部署验证（单文件）：hello-flow 定义 + 注册到 Prefect Server。

Usage (复制本文件到 Worker 的 flows 目录后执行):
    Windows: cd C:\RPA-Agent\flows
             C:\RPA-Agent\.venv\Scripts\python.exe test_deploy.py
    Linux:   cd /opt/rpa-agent/flows
             /opt/rpa-agent/.venv/bin/python test_deploy.py

注册成功后:
    Prefect UI (http://10.86.180.120:4200) → Deployments → hello-flow/hello → Run
"""

import platform
import socket
from datetime import datetime
from pathlib import Path

from prefect import flow, task, get_run_logger
from prefect.flows import Flow

# 根据 Worker 操作系统自动选择 Work Pool
WORK_POOL = "windows-rpa-pool" if platform.system() == "Windows" else "linux-rpa-pool"

# Flow 代码所在目录（即本文件所在目录，Worker 执行时从这里加载代码）
FLOWS_DIR = Path(__file__).parent.resolve()

# 落地证据文件：任务真正在 Worker 上跑过的本地痕迹
PROOF_FILE = (
    Path(r"C:\Temp\hello-flow-proof.txt")
    if platform.system() == "Windows"
    else Path("/tmp/hello-flow-proof.txt")
)


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


@task
def write_proof_file(info: dict, result: int) -> str:
    """在 Worker 本地写入证据文件，确认任务确实在这台机器上执行了。"""
    logger = get_run_logger()
    PROOF_FILE.parent.mkdir(parents=True, exist_ok=True)
    line = (
        f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] "
        f"hello-flow ran on {info['hostname']} ({info['os']}), result = {result}\n"
    )
    # 追加模式：每次运行加一行，可看到历史记录
    with open(PROOF_FILE, "a", encoding="utf-8") as f:
        f.write(line)
    logger.info(f"Proof file written: {PROOF_FILE}")
    return str(PROOF_FILE)


def _run_name() -> str:
    """自定义 Flow Run 名（默认是随机的“形容词-动物”）。"""
    return f"hello-{datetime.now():%m%d-%H%M%S}"


@flow(name="hello-flow", flow_run_name=_run_name, log_prints=True)
def hello_flow(a: int = 1, b: int = 2):
    """首次部署验证 Flow：主机信息 + 加法 + 本地证据文件。"""
    info = collect_host_info()
    result = add_numbers(a, b)
    proof = write_proof_file(info, result)
    print(f"Hello from {info['hostname']} ({info['os']}), {a} + {b} = {result}")
    print(f"Proof file: {proof}")
    return {"host": info, "result": result, "proof": proof}


def deploy():
    # process 类型 Work Pool 必须用 from_source 指定代码位置
    # （直接 flow.deploy 会要求 Docker 镜像或远程存储）
    Flow.from_source(
        source=str(FLOWS_DIR),
        entrypoint="test_deploy.py:hello_flow",
    ).deploy(
        name="hello",
        work_pool_name=WORK_POOL,
        tags=["try-on", "test"],
    )
    print("Deployed: hello-flow/hello")
    print(f"Work pool: {WORK_POOL}")
    print(f"Code path: {FLOWS_DIR}")
    print("Trigger it from Prefect UI -> Deployments -> hello -> Run")
    print(f"After the run, check proof file on the worker: {PROOF_FILE}")


if __name__ == "__main__":
    deploy()
