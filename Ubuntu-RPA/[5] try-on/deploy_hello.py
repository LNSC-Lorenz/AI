"""
注册 hello-flow 到 Prefect Server。

Usage (在 Worker 机器上执行, 需已配置 PREFECT_API_URL):
    Windows: C:\RPA-Agent\.venv\Scripts\python.exe deploy_hello.py
    Linux:   /opt/rpa-agent/.venv/bin/python deploy_hello.py

注册成功后:
    Prefect UI (http://10.86.180.120:4200) → Deployments → hello-flow/hello → Run
"""

import platform

from hello_flow import hello_flow

# 根据 Worker 操作系统自动选择 Work Pool
WORK_POOL = "windows-rpa-pool" if platform.system() == "Windows" else "linux-rpa-pool"


def deploy():
    hello_flow.deploy(
        name="hello",
        work_pool_name=WORK_POOL,
        tags=["try-on", "test"],
    )
    print("Deployed: hello-flow/hello")
    print(f"Work pool: {WORK_POOL}")
    print("Trigger it from Prefect UI -> Deployments -> hello -> Run")


if __name__ == "__main__":
    deploy()
