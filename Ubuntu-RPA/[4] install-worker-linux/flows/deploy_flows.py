"""
Deploy all flows to Prefect Server.
Run this from the Linux Agent after setup to register deployments.

Usage:
    python deploy_flows.py
"""

from web_flow import web_automation_flow
from python_flow import python_etl_flow


WORK_POOL = "linux-rpa-pool"
CRON_DISABLED = None  # Set cron string to enable schedule, e.g. "0 8 * * *"


def deploy_all():
    """Register all flow deployments with Prefect Server."""

    # Web Flows
    web_automation_flow.deploy(
        name="web-automation-linux",
        work_pool_name=WORK_POOL,
        cron=CRON_DISABLED,
        tags=["web", "linux"],
    )

    # Python ETL Flows
    python_etl_flow.deploy(
        name="python-etl-linux",
        work_pool_name=WORK_POOL,
        cron=CRON_DISABLED,
        tags=["python", "etl", "linux"],
    )

    print("All flows deployed successfully.")
    print(f"Work pool: {WORK_POOL}")
    print("Deployments:")
    print("  - web-automation-linux")
    print("  - python-etl-linux")


if __name__ == "__main__":
    deploy_all()
