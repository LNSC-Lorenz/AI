"""
Deploy all flows to Prefect Server.
Run this from the Linux Agent after setup to register deployments.

Usage:
    python must_deploy.py
"""

from pathlib import Path

from prefect.flows import Flow


WORK_POOL = "linux-rpa-pool"
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
    """Register all flow deployments with Prefect Server."""

    # Web Flows
    deploy_flow(
        "web_flow.py:web_automation_flow",
        name="web-automation-linux",
        tags=["web", "linux"],
        cron=CRON_DISABLED,
    )

    # Python ETL Flows
    deploy_flow(
        "python_flow.py:python_etl_flow",
        name="python-etl-linux",
        tags=["python", "etl", "linux"],
        cron=CRON_DISABLED,
    )

    print("All flows deployed successfully.")
    print(f"Work pool: {WORK_POOL}")
    print("Deployments:")
    print("  - web-automation-linux")
    print("  - python-etl-linux")


if __name__ == "__main__":
    deploy_all()
