"""
Deploy all flows to Prefect Server.
Run this from the Windows Agent after setup to register deployments.

Usage:
    python deploy_flows.py
"""

from prefect import flow
from prefect.deployments import Deployment

from sap_flow import sap_transaction_flow
from web_flow import web_automation_flow
from python_flow import python_etl_flow


WORK_POOL = "windows-rpa-pool"
CRON_DISABLED = None  # Set cron string to enable schedule, e.g. "0 8 * * *"


def deploy_all():
    """Register all flow deployments with Prefect Server."""

    # SAP Flows
    sap_transaction_flow.deploy(
        name="sap-transaction",
        work_pool_name=WORK_POOL,
        cron=CRON_DISABLED,
        tags=["sap", "production"],
    )

    # Web Flows
    web_automation_flow.deploy(
        name="web-automation",
        work_pool_name=WORK_POOL,
        cron=CRON_DISABLED,
        tags=["web", "production"],
    )

    # Python ETL Flows
    python_etl_flow.deploy(
        name="python-etl",
        work_pool_name=WORK_POOL,
        cron=CRON_DISABLED,
        tags=["python", "etl"],
    )

    print("All flows deployed successfully.")
    print(f"Work pool: {WORK_POOL}")
    print("Deployments:")
    print("  - sap-transaction")
    print("  - web-automation")
    print("  - python-etl")


if __name__ == "__main__":
    deploy_all()
