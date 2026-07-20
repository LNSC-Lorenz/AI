"""
SAP GUI Automation Flow
Runs on Windows RPA Agent via Prefect Worker.
Uses SAP Scripting API through win32com.
"""

from prefect import flow, task, get_run_logger
from prefect.tasks import task_input_hash
from datetime import timedelta
import subprocess
import sys

# Windows-only imports (will fail on Linux — flows run on Windows Agent)
if sys.platform == "win32":
    import win32com.client


@task(retries=2, retry_delay_seconds=10)
def connect_sap(
    server: str = "PRD",
    client: str = "800",
    user: str = "",
    password: str = "",
) -> object:
    """Connect to SAP GUI and return session object."""
    logger = get_run_logger()
    logger.info(f"Connecting to SAP system: {server}, client: {client}")

    sap_gui = win32com.client.GetObject("SAPGUI")
    application = sap_gui.GetScriptingEngine
    connection = application.OpenConnection(server, True)
    session = connection.Children(0)

    # Login
    session.findById("wnd[0]/usr/txtRSYST-MANDT").text = client
    session.findById("wnd[0]/usr/txtRSYST-BNAME").text = user
    session.findById("wnd[0]/usr/pwdRSYST-BCODE").text = password
    session.findById("wnd[0]").sendVKey(0)

    logger.info("SAP login successful")
    return session


@task(retries=1)
def run_transaction(session: object, tcode: str, **params) -> dict:
    """Execute a SAP transaction."""
    logger = get_run_logger()
    logger.info(f"Running transaction: {tcode}")

    session.findById("wnd[0]/tbar[0]/okcd").text = f"/n{tcode}"
    session.findById("wnd[0]").sendVKey(0)

    # Transaction-specific logic should be implemented per use case
    # This is a skeleton — extend based on actual SAP transactions needed
    result = {
        "tcode": tcode,
        "status": "executed",
    }

    logger.info(f"Transaction {tcode} completed")
    return result


@task
def disconnect_sap(session: object):
    """Close SAP connection."""
    logger = get_run_logger()
    try:
        session.findById("wnd[0]/tbar[0]/okcd").text = "/nex"
        session.findById("wnd[0]").sendVKey(0)
    except Exception:
        pass
    logger.info("SAP session closed")


@flow(name="sap-transaction-flow", log_prints=True)
def sap_transaction_flow(
    server: str = "PRD",
    client: str = "800",
    user: str = "",
    password: str = "",
    tcode: str = "SE16",
):
    """Main SAP automation flow."""
    session = connect_sap(server=server, client=client, user=user, password=password)
    try:
        result = run_transaction(session, tcode)
        print(f"Result: {result}")
    finally:
        disconnect_sap(session)
    return result


if __name__ == "__main__":
    sap_transaction_flow()
