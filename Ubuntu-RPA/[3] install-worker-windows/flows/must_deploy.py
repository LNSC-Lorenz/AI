"""
Deploy all flows to Prefect Server.
Run this from the Windows Agent after setup to register deployments.

Usage:
    python must_deploy.py
"""

from pathlib import Path

from prefect.flows import Flow


WORK_POOL = "windows-rpa-pool"
CRON_DISABLED = None  # Set cron string to enable schedule, e.g. "0 8 * * *"

# Flow 代码所在目录（Worker 执行时从这里加载代码）
FLOWS_DIR = Path(__file__).parent.resolve()


def deploy_flow(entrypoint: str, name: str, tags: list, cron: str = None):
    """Deploy a flow from local source (required for process work pools)."""
    Flow.from_source(
        source=str(FLOWS_DIR),
        entrypoint=entrypoint,
    ).deploy(
        name=name,
        work_pool_name=WORK_POOL,
        cron=cron,
        tags=tags,
    )


def deploy_all():
    """Register all flow deployments with Prefect Server.

    在下方为每个正式业务 Flow 添加一条 deploy_flow() 调用。
    entrypoint 格式: "文件名.py:flow函数名"（文件需与本脚本同目录）。

    示例（参考 [5] try-on 下的示例 flow 代码）:
        deploy_flow(
            "sap_flow.py:sap_transaction_flow",
            name="sap-transaction",
            tags=["sap", "production"],
            cron=CRON_DISABLED,  # 或 "0 8 * * *" 启用定时
        )
    """

    # TODO: 在这里注册正式业务 Flows

    print("All flows deployed successfully.")
    print(f"Work pool: {WORK_POOL}")


if __name__ == "__main__":
    deploy_all()
